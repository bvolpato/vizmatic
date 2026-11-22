import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { createSourceFile, isExportDeclaration, isImportDeclaration, isStringLiteral, ScriptTarget } from 'typescript'
import { STAGE_FONTS } from './build-stage'

const out = 'docs/assets/studio'

interface CatalogEntry {
    id?: string
    file?: string
    name?: string
    slug?: string
    title?: string
    description?: string
    summary?: string
    look?: string
}

/** Copy hand-written films so people can open them in the code editor. */
async function copyFilmCatalog(): Promise<number> {
    let raw: string
    try {
        raw = await readFile('examples/films/catalog.json', 'utf8')
    } catch {
        await writeFile(`${out}/films.json`, '[]\n')
        return 0
    }
    const parsed = JSON.parse(raw) as CatalogEntry[] | { films?: CatalogEntry[] }
    const list = Array.isArray(parsed) ? parsed : parsed.films ?? []
    await mkdir(`${out}/films`, { recursive: true })
    const entries = await Promise.all(list.map(async (entry) => {
        const stem = (entry.id ?? entry.slug ?? entry.name ?? entry.file?.replace(/\.tsx?$/, '') ?? '').toString()
        if (!stem) return null
        const file = entry.file ?? `${stem}.ts`
        const source = await readFile(`examples/films/${file}`, 'utf8').catch(() => null)
        // The sandbox only provides vizmatic/stage, so films with other imports stay out of the list.
        if (source === null) return null
        const module = createSourceFile(file, source, ScriptTarget.Latest)
        const imports = module.statements.flatMap((statement) => {
            if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) return []
            const specifier = statement.moduleSpecifier
            return specifier && isStringLiteral(specifier) ? [specifier.text] : []
        })
        const externalImports = imports.filter((name) => name !== 'vizmatic/stage' && !name.startsWith('./') && !name.startsWith('../'))
        if (externalImports.length > 0) return null
        let studioSource = source
        if (imports.some((name) => name.startsWith('./') || name.startsWith('../'))) {
            // Inline local helper modules (e.g. ./_planetary-orbits/model) so science films open live in the Studio sandbox.
            const bundled = await build({
                entryPoints: [`examples/films/${file}`],
                bundle: true,
                write: false,
                format: 'esm',
                target: 'es2022',
                external: ['vizmatic/stage'],
                minify: false,
                logLevel: 'warning',
            })
            studioSource = bundled.outputFiles[0]?.text ?? ''
            if (!studioSource) return null
        }
        const [, poster] = await Promise.all([
            writeFile(`${out}/films/${stem}.tsx`, studioSource),
            // Prefer compact site posters, then fall back to rendered film stills if present.
            access(`docs/assets/site/posters/${stem}_dark.webp`).then(
                () => `assets/site/posters/${stem}_dark.webp`,
                () => access(`docs/assets/films/${stem}.png`).then(() => `assets/films/${stem}.png`, () => undefined),
            ),
        ])
        return {
            id: stem,
            title: entry.title ?? stem,
            description: entry.summary ?? entry.description ?? '',
            file: `${stem}.tsx`,
            ...(entry.look ? { look: entry.look } : {}),
            ...(poster ? { poster } : {}),
        }
    }))
    const films = entries.filter((item): item is NonNullable<typeof item> => item !== null)
    await writeFile(`${out}/films.json`, `${JSON.stringify(films, null, 2)}\n`)
    return films.length
}

/** Bundle the Studio and write its page. The result is static files with no server. */
export async function buildStudio(): Promise<{ films: number }> {
    await rm(out, { recursive: true, force: true })
    await mkdir(`${out}/assets/fonts`, { recursive: true })
    const [, , , films, template] = await Promise.all([
        build({
            entryPoints: { studio: 'src/studio/main.ts' },
            bundle: true,
            splitting: true,
            format: 'esm',
            target: 'es2022',
            platform: 'browser',
            outdir: out,
            minify: true,
            chunkNames: '[name]-[hash]',
            alias: { 'vizmatic/stage': './src/stage/index.ts' },
            logLevel: 'warning',
        }),
        // The sandbox receives this file as text and has no way to load chunks, so it is a single script.
        build({
            entryPoints: { 'sandbox-runtime': 'src/studio/sandbox-runtime.ts' },
            bundle: true,
            format: 'iife',
            target: 'es2022',
            platform: 'browser',
            outdir: out,
            minify: true,
            alias: { 'vizmatic/stage': './src/stage/index.ts' },
            // The asset base is set explicitly at start up, so the module URL is never read here.
            define: { 'import.meta.url': 'undefined' },
            logLevel: 'warning',
        }),
        Promise.all(STAGE_FONTS.map((font) => copyFile(`assets/fonts/${font}`, `${out}/assets/fonts/${font}`))),
        copyFilmCatalog(),
        readFile('docs/studio.template.html', 'utf8'),
    ])
    await writeFile('docs/studio.html', `<!-- Generated from docs/studio.template.html by scripts/build-studio.ts. Edit the template. -->\n${template}`)
    return { films }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
    const { films } = await buildStudio()
    console.log(`Built the Studio into ${out} with ${films} film(s) from the catalog`)
}
