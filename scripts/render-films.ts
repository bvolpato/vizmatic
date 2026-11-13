/**
 * Render the film catalog to the website's media folder: one MP4 and one poster
 * per film. MP4s are built in CI and ignored by git. Posters are committed.
 *
 *   tsx scripts/render-films.ts
 *   tsx scripts/render-films.ts --film lorenz,attention --quality high
 *   tsx scripts/render-films.ts --posters
 *   tsx scripts/render-films.ts --no-posters --cache-dir .cache/films
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
const BROWSER_ONLY_STAGE_FILES = new Set(['browser.ts', 'player.ts', 'bloom-canvas.ts'])

export async function readCatalog(): Promise<CatalogEntry[]> {
    return JSON.parse(await readFile('examples/films/catalog.json', 'utf8')) as CatalogEntry[]
}

function flag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
}

async function listFilesSorted(dir: string, skipDir?: (name: string) => boolean): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
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

/** Hash the Node film rendering engine and bundled fonts so engine edits invalidate cached MP4s. */
export async function computeFilmEngineHash(rootDir = process.cwd()): Promise<string> {
    const hash = createHash('sha256').update('vizmatic-film-cache-v1\n')
    const pkg = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
    }
    hash.update(`resvg:${pkg.dependencies?.['@resvg/resvg-js'] ?? ''}\n`)
    hash.update(`mathjax:${pkg.dependencies?.['mathjax-full'] ?? ''}\n`)

    const stageFiles = (await listFilesSorted(join(rootDir, 'src', 'stage'), (name) => name === 'preview'))
        .filter((file) => !BROWSER_ONLY_STAGE_FILES.has(relative(join(rootDir, 'src', 'stage'), file)))
    const extraEngineFiles = [join(rootDir, 'src', 'video.ts'), join(rootDir, 'src', 'math.ts')]
    const fontFiles = await listFilesSorted(join(rootDir, 'assets', 'fonts'))

    for (const file of [...stageFiles, ...extraEngineFiles, ...fontFiles]) {
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

async function collectFilmFiles(entryFile: string): Promise<string[]> {
    const visited = new Set<string>()
    const queue = [resolve(entryFile)]
    while (queue.length > 0) {
        const current = queue.shift()!
        if (visited.has(current)) continue
        visited.add(current)
        if (!/\.(?:[cm]?[jt]sx?)$/.test(current)) continue
        const source = await readFile(current, 'utf8').catch(() => '')
        for (const match of source.matchAll(/(?:from|import)\s*\(?['"](\.[^'"]+)['"]\)?/g)) {
            const resolved = await resolveRelativeImport(current, match[1]!)
            if (resolved && !visited.has(resolved)) queue.push(resolved)
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
    hash.update(`engine:${engineHash}\nid:${entry.id}\nlook:${entry.look}\nquality:${quality}\n`)
    const entryFile = join(filmsDir, `${entry.id}.ts`)
    const files = await collectFilmFiles(entryFile)
    const companionDir = await listFilesSorted(join(filmsDir, entry.id))
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
    const [savedKey, info] = await Promise.all([
        readFile(cachedKeyPath, 'utf8').then((text) => text.trim(), () => null),
        stat(cachedMp4).catch(() => null),
    ])
    if (savedKey !== expectedKey || !info || info.size <= 0) return null
    await copyFile(cachedMp4, outputMp4)
    return info.size
}

export async function saveCachedFilm(cacheDir: string, id: string, key: string, renderedMp4: string): Promise<void> {
    await mkdir(cacheDir, { recursive: true })
    await copyFile(renderedMp4, join(cacheDir, `${id}.mp4`))
    await writeFile(join(cacheDir, `${id}.sha256`), `${key}\n`)
}

async function main(): Promise<void> {
    const pick = flag('film')?.split(',')
    const quality = (flag('quality') ?? 'standard') as Quality
    const workers = Number(flag('workers') ?? 4)
    const cacheDir = flag('cache-dir') ?? process.env['VIZMATIC_FILM_CACHE_DIR']
    const postersOnly = process.argv.includes('--posters')
    // Posters are committed. The Pages workflow builds only the MP4s, which git ignores.
    const videosOnly = process.argv.includes('--no-posters')
    const catalog = (await readCatalog()).filter((entry) => !pick || pick.includes(entry.id))
    if (pick && catalog.length !== pick.length) throw new Error(`Unknown film in --film ${pick.join(',')}`)
    await mkdir(OUT, { recursive: true })
    const engineHash = cacheDir && !postersOnly ? await computeFilmEngineHash() : ''

    for (const entry of catalog) {
        const outputMp4 = join(OUT, `${entry.id}.mp4`)
        const cacheKey = cacheDir && !postersOnly ? await computeFilmCacheKey(entry, quality, engineHash) : ''
        if (videosOnly && cacheDir && !postersOnly) {
            const cachedBytes = await tryRestoreCachedFilm(cacheDir, entry.id, cacheKey, outputMp4)
            if (cachedBytes !== null) {
                console.log(`video ${entry.id} cached ${(cachedBytes / 1e6).toFixed(1)} MB`)
                continue
            }
        }
        const module = await import(pathToFileURL(resolve('examples/films', `${entry.id}.ts`)).href) as { default: unknown }
        if (!isFilm(module.default)) throw new Error(`${entry.id} must export a film as its default export.`)
        const film = await compileFilm(module.default, { look: entry.look })
        if (!videosOnly) {
            const poster = await renderFilmFrame(film, entry.posterTime, join(OUT, `${entry.id}.png`), { workers: 1 })
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
        const video = await renderFilmVideo(film, outputMp4, { quality, workers })
        if (cacheDir) await saveCachedFilm(cacheDir, entry.id, cacheKey, outputMp4)
        const seconds = (performance.now() - started) / 1000
        console.log(`video ${entry.id} ${video.frameCount} frames ${(video.bytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(0)}s (${(video.frameCount / seconds).toFixed(0)} fps)`)
    }
    await writeFile(join(OUT, 'catalog.json'), `${JSON.stringify(await readCatalog(), null, 2)}\n`)
}

if (process.argv[1]?.endsWith('render-films.ts')) await main()
