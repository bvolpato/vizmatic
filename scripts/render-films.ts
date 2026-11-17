/**
 * Render the film catalog to the website's media folder: one MP4 and one poster
 * per film. MP4s are built in CI and ignored by git. Posters are committed.
 *
 *   tsx scripts/render-films.ts
 *   tsx scripts/render-films.ts --film lorenz,attention --quality high
 *   tsx scripts/render-films.ts --posters
 *   tsx scripts/render-films.ts --no-posters --cache-dir .cache/films
 *   tsx scripts/render-films.ts --shard 1/4 --no-posters --cache-dir .cache/films
 *   tsx scripts/render-films.ts --no-posters --cache-dir .cache/films --require-cache
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { compileFilm, isFilm } from '../src/stage/index'
import { renderFilmFrame, renderFilmVideo, type Quality } from '../src/stage/export'

export interface CatalogEntry {
    id: string
    title: string
    summary: string
    topic: string
    duration: number
    posterTime: number
    featured: boolean
    look: 'midnight' | 'paper' | 'blueprint' | 'chalk' | 'neon'
}

const OUT = 'docs/assets/films'
const CATALOG_DITHER = true
// Pages checks this declaration before installing or executing a renderer from a requested ref.
export const CATALOG_PROTOCOL = 'cpu-shards-v1'
// These implementations are used only by browser/Canvas or explicitly selected GPU rendering.
// Shared SVG, geometry, image, and bloom-kernel code stays in the CPU dependency closure.
const NON_CPU_STAGE_FILES = new Set([
    'browser.ts', 'player.ts', 'display-canvas.ts', 'bloom-canvas.ts', 'bloom-webgl.ts',
    'gpu-raster.ts', 'gpu-runtime.ts', 'gpu-wire.ts', 'gpu-browser.ts', 'gpu-source.ts', 'gpu-selection.ts',
])

// CPU seconds from Pages run 43973116878 (standard quality, four raster workers).
// New films fall back to their duration. These affect scheduling, never cache validity.
const CPU_SECONDS: Readonly<Record<string, number>> = {
    'vizmatic-title': 64, 'gradient-descent': 187, lorenz: 262, 'central-limit': 97,
    'planetary-orbits': 300, maxwell: 269, 'reaction-diffusion': 137, 'gravitational-waves': 147,
    'stationary-action': 122, 'quantum-tunneling': 65, 'heat-equation': 130, catalysis: 123,
    'boltzmann-entropy': 89, 'flash-attention': 107, 'io-uring': 112, 'svd-3d': 108,
    'fourier-epicycles': 212, 'rag-citations': 44, 'ring-allreduce': 80, 'cache-miss': 111,
    paxos: 151, attention: 72, forecast: 143, 'complex-maps': 140, 'linear-maps': 130,
    'euler-circle': 126, 'beam-search': 72, pythagoras: 58, 'taylor-series': 105,
    'deck-example': 31, pathlines: 65, 'hydrogen-orbitals': 278,
}

/** Longest jobs first, assigning each to the least loaded shard. Ties are deterministic. */
export function shardCatalog<T extends Pick<CatalogEntry, 'id' | 'duration'>>(
    catalog: readonly T[], count: number, estimates = CPU_SECONDS,
): T[][] {
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('Shard count must be a positive integer')
    const ids = new Set<string>()
    for (const entry of catalog) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate film ID: ${entry.id}`)
        ids.add(entry.id)
    }
    const cost = (entry: T): number => estimates[entry.id] ?? (Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : 120)
    const shards: T[][] = Array.from({ length: count }, () => [])
    const loads = Array<number>(count).fill(0)
    const ordered = [...catalog].sort((a, b) => cost(b) - cost(a) || a.id.localeCompare(b.id, 'en'))
    for (const entry of ordered) {
        const index = loads.indexOf(Math.min(...loads))
        shards[index]!.push(entry)
        loads[index]! += cost(entry)
    }
    return shards
}

export function parseShard(value: string): { index: number; count: number } {
    const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value)
    const index = Number(match?.[1]), count = Number(match?.[2])
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) throw new Error('--shard must be INDEX/COUNT, with 1 <= INDEX <= COUNT')
    return { index, count }
}

export async function readCatalog(): Promise<CatalogEntry[]> {
    return JSON.parse(await readFile('examples/films/catalog.json', 'utf8')) as CatalogEntry[]
}

function flag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    if (index < 0) return undefined
    const value = process.argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`)
    return value
}

async function listFilesSorted(dir: string, skipDir?: (name: string) => boolean): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return []
        throw error
    })
    const out: string[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory()) {
            if (skipDir?.(entry.name)) continue
            out.push(...await listFilesSorted(join(dir, entry.name), skipDir))
        } else if (entry.isFile()) {
            out.push(join(dir, entry.name))
        }
    }
    return out
}

function nonCpuFile(file: string, rootDir: string): boolean {
    const stagePath = relative(join(rootDir, 'src/stage'), file).replace(/\\/g, '/')
    return NON_CPU_STAGE_FILES.has(stagePath) || stagePath.startsWith('preview/')
}

/** Hash Node sources, their local dependencies, resolved package versions and bundled assets. */
export async function computeFilmEngineHash(rootDir = process.cwd()): Promise<string> {
    const hash = createHash('sha256').update('vizmatic-film-cache-v2\n')
    const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
    }
    hash.update(JSON.stringify(Object.entries(pkg.dependencies ?? {}).sort()))
    hash.update(await readFile(join(rootDir, 'pnpm-lock.yaml')))

    const stageFiles = (await listFilesSorted(join(rootDir, 'src', 'stage'), (name) => name === 'preview'))
        .filter((file) => !nonCpuFile(file, rootDir))
    const extraEngineFiles = ['video.ts', 'math.ts', 'chemistry-elements.ts'].map((file) => join(rootDir, 'src', file))
    const engineFiles = await collectFilmFiles([...stageFiles, ...extraEngineFiles], rootDir)
    const assetFiles = await listFilesSorted(join(rootDir, 'assets'))

    for (const file of [...engineFiles, ...assetFiles]) {
        const rel = relative(rootDir, file).replace(/\\/g, '/')
        hash.update(`file:${rel}\n`)
        hash.update(await readFile(file))
        hash.update('\n')
    }
    return hash.digest('hex')
}

async function resolveRelativeImport(fromFile: string, specifier: string): Promise<string | null> {
    const base = resolve(dirname(fromFile), specifier)
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, join(base, 'index.ts')]) {
        const info = await stat(candidate).catch(() => null)
        if (info?.isFile()) return candidate
    }
    return null
}

function compilerInputs(rootDir: string): { options: ts.CompilerOptions; files: string[] } {
    const config = join(rootDir, 'tsconfig.json')
    if (!ts.sys.fileExists(config)) return { options: {}, files: [] }
    const files = new Set<string>()
    const fail = (diagnostic: ts.Diagnostic): never => {
        throw new Error(`Cannot hash TypeScript configuration: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
    }
    const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, {
        ...ts.sys,
        getCurrentDirectory: () => rootDir,
        // Only options and their extends chain matter here; dependency traversal selects sources.
        readDirectory: () => [],
        readFile: (path) => {
            const content = ts.sys.readFile(path)
            if (content !== undefined) files.add(resolve(path))
            return content
        },
        onUnRecoverableConfigFileDiagnostic: fail,
    })!
    // This options-only parse deliberately has no inputs, including in minimal cache fixtures.
    for (const diagnostic of parsed.errors) if (![18002, 18003].includes(diagnostic.code)) fail(diagnostic)
    return { options: parsed.options, files: [...files].sort() }
}

function matchesAlias(specifier: string, paths: ts.CompilerOptions['paths']): boolean {
    return Object.keys(paths ?? {}).some((pattern) => {
        const star = pattern.indexOf('*')
        return star < 0 ? pattern === specifier
            : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
    })
}

async function collectFilmFiles(entryFiles: string[], rootDir: string): Promise<string[]> {
    const config = compilerInputs(rootDir)
    const options = { ...config.options, moduleResolution: config.options.moduleResolution ?? ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true }
    const moduleCache = ts.createModuleResolutionCache(rootDir, (path) => path, options)
    const visited = new Set(config.files)
    const queue = entryFiles.map((file) => resolve(file))
    while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current) || nonCpuFile(current, rootDir)) continue
        visited.add(current)
        if (!/\.(?:[cm]?[jt]sx?)$/.test(current)) continue
        const source = await readFile(current, 'utf8')
        const imports = ts.preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName)
        // Assets addressed relative to the module are not import declarations.
        const assets = [...source.matchAll(/new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)].map((match) => match[1]!)
        for (const specifier of [...imports, ...assets]) {
            const relativeImport = specifier.startsWith('.')
            let module = relativeImport ? undefined : ts.resolveModuleName(specifier, current, options, ts.sys, moduleCache).resolvedModule
            // Installed dependencies are covered by the lockfile. Local aliases must follow their actual targets.
            if (module?.isExternalLibraryImport || module?.resolvedFileName.replace(/\\/g, '/').includes('/node_modules/')) continue
            if (module && /\.d\.[cm]?ts$/.test(module.resolvedFileName)) {
                // TypeScript prefers declarations next to JavaScript. Hash the implementation used by tsx.
                module = ts.resolveModuleName(specifier, current, options, {
                    ...ts.sys,
                    fileExists: (file) => !/\.d\.[cm]?ts$/.test(file) && ts.sys.fileExists(file),
                }).resolvedModule ?? module
            }
            const resolved = relativeImport ? await resolveRelativeImport(current, specifier) : module?.resolvedFileName
            if (!resolved) {
                if (relativeImport || matchesAlias(specifier, options.paths)) throw new Error(`Cannot hash dependency ${specifier} from ${current}`)
                continue
            }
            if (!visited.has(resolved)) queue.push(resolved)
        }
    }
    return [...visited].sort()
}

export async function computeFilmCacheKey(
    entry: Pick<CatalogEntry, 'id' | 'look'>,
    quality: Quality,
    engineHash: string,
    filmsDir = resolve('examples/films'),
): Promise<string> {
    const hash = createHash('sha256')
    hash.update(`engine:${engineHash}\nid:${entry.id}\nlook:${entry.look}\nquality:${quality}\ndither:${CATALOG_DITHER}\nbackend:cpu\nencoder:libx264\n`)
    const entryFile = join(filmsDir, `${entry.id}.ts`)
    const files = await collectFilmFiles([entryFile], resolve(filmsDir, '../..'))
    const companionDir = [...await listFilesSorted(join(filmsDir, entry.id)), ...await listFilesSorted(join(filmsDir, `_${entry.id}`))]
    for (const file of [...new Set([...files, ...companionDir])].sort()) {
        hash.update(`source:${relative(filmsDir, file).replace(/\\/g, '/')}\n`)
        hash.update(await readFile(file))
        hash.update('\n')
    }
    return hash.digest('hex')
}

export async function tryRestoreCachedFilm(cacheDir: string, id: string, expectedKey: string, outputMp4: string): Promise<number | null> {
    const cachedMp4 = join(cacheDir, `${id}.mp4`)
    const cachedKeyPath = join(cacheDir, `${id}.sha256`)
    const [savedKey, digest] = (await readFile(cachedKeyPath, 'utf8').catch(() => '')).trim().split('\n')
    if (savedKey !== expectedKey || !digest) return null
    const bytes = await readFile(cachedMp4).catch(() => null)
    if (!bytes?.length || createHash('sha256').update(bytes).digest('hex') !== digest) return null
    await writeFile(outputMp4, bytes)
    return bytes.length
}

export async function saveCachedFilm(cacheDir: string, id: string, key: string, renderedMp4: string): Promise<void> {
    await mkdir(cacheDir, { recursive: true })
    const bytes = await readFile(renderedMp4)
    if (!bytes.length) throw new Error(`Cannot cache empty video: ${id}`)
    const temp = join(cacheDir, `${id}.${randomUUID()}`)
    try {
        await writeFile(`${temp}.mp4`, bytes)
        await writeFile(`${temp}.sha256`, `${key}\n${createHash('sha256').update(bytes).digest('hex')}\n`)
        await rename(`${temp}.mp4`, join(cacheDir, `${id}.mp4`))
        await rename(`${temp}.sha256`, join(cacheDir, `${id}.sha256`))
    } finally {
        await Promise.all([rm(`${temp}.mp4`, { force: true }), rm(`${temp}.sha256`, { force: true })])
    }
}

async function main(): Promise<void> {
    const pick = flag('film')?.split(',')
    const quality = (flag('quality') ?? 'standard') as Quality
    const workers = Number(flag('workers') ?? 4)
    const cacheDir = flag('cache-dir') ?? process.env['VIZMATIC_FILM_CACHE_DIR']
    const postersOnly = process.argv.includes('--posters')
    // Posters are committed. The Pages workflow builds only the MP4s, which git ignores.
    const videosOnly = process.argv.includes('--no-posters')
    const requireCache = process.argv.includes('--require-cache')
    const printCacheKey = process.argv.includes('--print-cache-key')
    const shard = flag('shard')
    if (!['draft', 'standard', 'high', 'master'].includes(quality)) throw new Error(`Unknown quality: ${quality}`)
    if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('--workers must be a positive integer')
    if (videosOnly && postersOnly) throw new Error('--posters and --no-posters cannot be combined')
    if (requireCache && (!videosOnly || !cacheDir)) throw new Error('--require-cache needs --no-posters and --cache-dir')
    if (shard && pick) throw new Error('--shard and --film cannot be combined')
    const fullCatalog = await readCatalog()
    let catalog = fullCatalog.filter((entry) => !pick || pick.includes(entry.id))
    if (pick && catalog.length !== pick.length) throw new Error(`Unknown film in --film ${pick.join(',')}`)
    const { index, count } = shard ? parseShard(shard) : { index: 1, count: 1 }
    const shards = shardCatalog(catalog, count)
    if (shard) catalog = shards[index - 1]!
    // CPU catalog output is tied to the actual encoder build and Node runtime, including across cache restores.
    const engineHash = (cacheDir && !postersOnly) || printCacheKey
        ? `${await computeFilmEngineHash()}\n${process.platform}/${process.arch}/${process.version}\n${execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' })}`
        : ''
    const keys = new Map(await Promise.all(catalog.map(async (entry) => [entry.id, engineHash ? await computeFilmCacheKey(entry, quality, engineHash) : ''] as const)))
    if (printCacheKey) {
        console.log(createHash('sha256').update(JSON.stringify([...keys])).digest('hex'))
        return
    }
    await mkdir(OUT, { recursive: true })
    if (shard) console.log(`shard ${shard}: ${catalog.map((entry) => entry.id).join(', ')} (estimated ${catalog.reduce((sum, entry) => sum + (CPU_SECONDS[entry.id] ?? entry.duration), 0)} CPU seconds)`)

    for (const entry of catalog) {
        const outputMp4 = join(OUT, `${entry.id}.mp4`)
        const cacheKey = keys.get(entry.id)!
        if (videosOnly && cacheDir && !postersOnly) {
            const cachedBytes = await tryRestoreCachedFilm(cacheDir, entry.id, cacheKey, outputMp4)
            if (cachedBytes !== null) {
                console.log(`video ${entry.id} cached ${(cachedBytes / 1e6).toFixed(1)} MB`)
                continue
            }
            if (requireCache) throw new Error(`Missing or invalid cached film: ${entry.id}`)
        }
        const module = await import(pathToFileURL(resolve('examples/films', `${entry.id}.ts`)).href) as { default: unknown }
        if (!isFilm(module.default)) throw new Error(`${entry.id} must export a film as its default export.`)
        const film = await compileFilm(module.default, { look: entry.look })
        if (!videosOnly) {
            const poster = await renderFilmFrame(film, entry.posterTime, join(OUT, `${entry.id}.png`), { workers: 1, backend: 'cpu' })
            console.log(`poster ${entry.id} ${poster.width}x${poster.height}`)
        }
        if (postersOnly) continue
        if (cacheDir) {
            const cachedBytes = await tryRestoreCachedFilm(cacheDir, entry.id, cacheKey, outputMp4)
            if (cachedBytes !== null) {
                console.log(`video ${entry.id} cached ${(cachedBytes / 1e6).toFixed(1)} MB`)
                continue
            }
        }
        const started = performance.now()
        const video = await renderFilmVideo(film, outputMp4, { quality, workers, dither: CATALOG_DITHER, backend: 'cpu', h264Encoder: 'libx264' })
        if (cacheDir) await saveCachedFilm(cacheDir, entry.id, cacheKey, outputMp4)
        const seconds = (performance.now() - started) / 1000
        console.log(`video ${entry.id} ${video.frameCount} frames ${(video.bytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(0)}s (${(video.frameCount / seconds).toFixed(0)} fps)`)
    }
    // Only the complete assembly writes shared catalog metadata.
    if (!shard) await writeFile(join(OUT, 'catalog.json'), `${JSON.stringify(fullCatalog, null, 2)}\n`)
}

if (process.argv[1]?.endsWith('render-films.ts')) await main()
