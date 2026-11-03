/**
 * Render the film catalog to the website's media folder: one MP4 and one poster
 * per film. MP4s are built in CI and ignored by git. Posters are committed.
 *
 *   tsx scripts/render-films.ts
 *   tsx scripts/render-films.ts --film lorenz,attention --quality high
 *   tsx scripts/render-films.ts --posters
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
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

export async function readCatalog(): Promise<CatalogEntry[]> {
    return JSON.parse(await readFile('examples/films/catalog.json', 'utf8')) as CatalogEntry[]
}

function flag(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
}

async function main(): Promise<void> {
    const pick = flag('film')?.split(',')
    const quality = (flag('quality') ?? 'standard') as Quality
    const workers = Number(flag('workers') ?? 4)
    const postersOnly = process.argv.includes('--posters')
    const catalog = (await readCatalog()).filter((entry) => !pick || pick.includes(entry.id))
    if (pick && catalog.length !== pick.length) throw new Error(`Unknown film in --film ${pick.join(',')}`)
    await mkdir(OUT, { recursive: true })
    for (const entry of catalog) {
        const module = await import(pathToFileURL(resolve('examples/films', `${entry.id}.ts`)).href) as { default: unknown }
        if (!isFilm(module.default)) throw new Error(`${entry.id} must export a film as its default export.`)
        const film = await compileFilm(module.default, { look: entry.look })
        const poster = await renderFilmFrame(film, entry.posterTime, join(OUT, `${entry.id}.png`), { workers: 1 })
        console.log(`poster ${entry.id} ${poster.width}x${poster.height}`)
        if (postersOnly) continue
        const started = performance.now()
        const video = await renderFilmVideo(film, join(OUT, `${entry.id}.mp4`), { quality, workers })
        const seconds = (performance.now() - started) / 1000
        console.log(`video ${entry.id} ${video.frameCount} frames ${(video.bytes / 1e6).toFixed(1)} MB in ${seconds.toFixed(0)}s (${(video.frameCount / seconds).toFixed(0)} fps)`)
    }
    await writeFile(join(OUT, 'catalog.json'), `${JSON.stringify(await readCatalog(), null, 2)}\n`)
}

if (process.argv[1]?.endsWith('render-films.ts')) await main()
