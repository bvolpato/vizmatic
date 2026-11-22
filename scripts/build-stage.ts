import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { build, type Plugin } from 'esbuild'
import ts from 'typescript'

const out = 'docs/assets/stage'

function resolveLocalModule(fromFile: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null
    const base = resolve(dirname(fromFile), specifier)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, 'index.ts'), base]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
    return null
}

interface ExportOwner {
    file: string
    name: string
}

/** Map each exported value symbol of `src/stage/index.ts` to its owning submodule and original export name. */
function buildStageExportMap(entryFile: string, visited = new Set<string>()): Map<string, ExportOwner> {
    const abs = resolve(entryFile)
    const map = new Map<string, ExportOwner>()
    if (visited.has(abs)) return map
    visited.add(abs)
    const source = readFileSync(abs, 'utf8')
    const sf = ts.createSourceFile(abs, source, ts.ScriptTarget.Latest, false)
    for (const stmt of sf.statements) {
        if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
            const target = resolveLocalModule(abs, stmt.moduleSpecifier.text)
            if (!target) continue
            const sub = buildStageExportMap(target, new Set(visited))
            if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
                for (const el of stmt.exportClause.elements) {
                    if (el.isTypeOnly) continue
                    const sourceName = el.propertyName ? el.propertyName.text : el.name.text
                    const resolved = sub.get(sourceName)
                    map.set(el.name.text, resolved ?? { file: target, name: sourceName })
                }
            } else if (!stmt.exportClause) {
                for (const [name, owner] of sub) {
                    if (!map.has(name)) map.set(name, owner)
                }
            }
        } else if (ts.canHaveModifiers(stmt) && ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
            if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
                map.set(stmt.name.text, { file: abs, name: stmt.name.text })
            } else if (ts.isVariableStatement(stmt)) {
                for (const decl of stmt.declarationList.declarations) {
                    if (ts.isIdentifier(decl.name)) map.set(decl.name.text, { file: abs, name: decl.name.text })
                }
            }
        }
    }
    return map
}

function splitStageBarrelPlugin(): Plugin {
    const barrel = resolve('src/stage/index.ts')
    const exportMap = buildStageExportMap(barrel)
    return {
        name: 'split-stage-barrel',
        setup(b) {
            b.onLoad({ filter: /\.tsx?$/ }, async (args) => {
                if (args.path.includes('/src/stage/')) return null
                const contents = await readFile(args.path, 'utf8')
                if (!contents.includes('vizmatic/stage')) return null
                const sf = ts.createSourceFile(args.path, contents, ts.ScriptTarget.Latest, false)
                const edits: { start: number; end: number; text: string }[] = []
                for (const stmt of sf.statements) {
                    if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly) continue
                    if (!ts.isStringLiteral(stmt.moduleSpecifier) || stmt.moduleSpecifier.text !== 'vizmatic/stage') continue
                    const bindings = stmt.importClause?.namedBindings
                    if (!bindings || !ts.isNamedImports(bindings) || stmt.importClause?.name) continue
                    const groups = new Map<string, string[]>()
                    for (const el of bindings.elements) {
                        if (el.isTypeOnly) continue
                        const exportedName = el.propertyName ? el.propertyName.text : el.name.text
                        const localName = el.name.text
                        const owner = exportMap.get(exportedName) ?? { file: barrel, name: exportedName }
                        const spec = owner.name === localName ? localName : `${owner.name} as ${localName}`
                        const list = groups.get(owner.file) ?? []
                        list.push(spec)
                        groups.set(owner.file, list)
                    }
                    const rewritten = [...groups.entries()]
                        .map(([owner, specs]) => `import { ${specs.join(', ')} } from ${JSON.stringify(owner)};`)
                        .join('\n')
                    edits.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: rewritten })
                }
                if (edits.length === 0) return null
                let next = contents
                for (let i = edits.length - 1; i >= 0; i--) {
                    const edit = edits[i]!
                    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end)
                }
                return { contents: next, loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts' }
            })
        },
    }
}

/** Every font the stage engine can ask for. The browser fetches a fallback only when a film needs it. */
export const STAGE_FONTS = [
    'Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'JetBrainsMono-Regular.ttf',
    'InstrumentSerif-Regular.ttf', 'InstrumentSerif-Italic.ttf',
    'SourceSerif4-24pt-Regular.ttf', 'SourceSerif4-24pt-SemiBold.ttf', 'SourceSerif4-24pt-Italic.ttf',
    'NotoSans-Regular.ttf', 'NotoSansMath-Regular.ttf',
]

async function listSources(directory: string): Promise<string[]> {
    const names = await readdir(directory).catch(() => [] as string[])
    return names.filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.startsWith('_'))
}

export interface StageBuildOptions {
    /** Films generated from guide samples, by output name. */
    demos?: Record<string, string>
}

export interface StageBuildResult {
    films: string[]
    /** Return static ESM module paths (relative to `docs/`, e.g. `assets/stage/...`) needed for the given entries. */
    preloadsFor(entries: readonly string[]): string[]
}

/**
 * Bundle the browser engine, every film, the site's own films, and guide demos
 * into one build. They must share one engine module, because that module holds
 * the clock, and splitting gives them the same copy.
 */
export async function buildStageBundle(options: StageBuildOptions = {}): Promise<StageBuildResult> {
    await rm(out, { recursive: true, force: true })
    await mkdir(`${out}/assets/fonts`, { recursive: true })
    const [films, siteFilms, siteRuntime] = await Promise.all([
        listSources('examples/films'),
        listSources('scripts/site-films'),
        listSources('scripts/site-runtime'),
    ])
    const entryPoints: Record<string, string> = { stage: 'src/stage/site-player.ts' }
    for (const name of films) entryPoints[`films/${name.replace(/\.tsx?$/, '')}`] = join('examples/films', name)
    for (const name of siteFilms) entryPoints[`site/${name.replace(/\.tsx?$/, '')}`] = join('scripts/site-films', name)
    for (const name of siteRuntime) entryPoints[`site/${name.replace(/\.tsx?$/, '')}`] = join('scripts/site-runtime', name)
    for (const [name, path] of Object.entries(options.demos ?? {})) entryPoints[`demos/${name}`] = path
    const [result] = await Promise.all([
        build({
            entryPoints,
            bundle: true,
            splitting: true,
            format: 'esm',
            target: 'es2022',
            platform: 'browser',
            outdir: out,
            minify: true,
            metafile: true,
            // Chunks stay beside stage.js, because the engine locates fonts relative to its own module URL.
            chunkNames: '[name]-[hash]',
            alias: { 'vizmatic/stage': './src/stage/index.ts' },
            plugins: [splitStageBarrelPlugin()],
            logLevel: 'warning',
        }),
        Promise.all(STAGE_FONTS.map((font) => copyFile(`assets/fonts/${font}`, `${out}/assets/fonts/${font}`))),
    ])

    const staticImports = new Map<string, string[]>()
    for (const [outputPath, info] of Object.entries(result.metafile?.outputs ?? {})) {
        const normalized = outputPath.replace(/\\/g, '/')
        const deps = info.imports
            .filter((imp) => imp.kind === 'import-statement' && !imp.external)
            .map((imp) => imp.path.replace(/\\/g, '/'))
        staticImports.set(normalized, deps)
    }

    const preloadsFor = (entries: readonly string[]): string[] => {
        const seen = new Set<string>()
        const queue = entries.map((entry) => entry.startsWith('docs/') ? entry : `docs/${entry.replace(/^\/+/, '')}`)
        while (queue.length > 0) {
            const current = queue.shift()!
            if (seen.has(current) || !staticImports.has(current)) continue
            seen.add(current)
            for (const dep of staticImports.get(current) ?? []) {
                if (!seen.has(dep)) queue.push(dep)
            }
        }
        return [...seen].map((file) => file.replace(/^docs\//, ''))
    }

    return { films, preloadsFor }
}

export async function buildStage(options: StageBuildOptions = {}): Promise<string[]> {
    return (await buildStageBundle(options)).films
}

if (process.argv[1]?.endsWith('build-stage.ts')) {
    const films = await buildStage()
    console.log(`Built the stage engine and ${films.length} film(s) into ${out}`)
}
