/**
 * Render a small poster for each film in both site themes. WebP keeps the films
 * wall light: a poster here is about a tenth of the size of a full PNG. Existing
 * posters stay in place, so the site build does not need a browser. Run it by hand
 * with --force after a film changes.
 *
 *   npx tsx scripts/build-film-posters.ts --force
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { compileFilm, isFilm, type FilmDefinition } from '../src/stage/index'
import { renderFilmFrame } from '../src/stage/export'
import { loadFilmCatalog } from './site-content'

export const POSTER_DIR = 'docs/assets/site/posters'
const THEMES = [
    { name: 'dark', look: 'midnight', background: '#0c0b09' },
    { name: 'light', look: 'paper', background: '#f7f3ea' },
] as const

const exists = (path: string) => access(path).then(() => true, () => false)

export async function buildFilmPosters(force = false): Promise<number> {
    await mkdir(POSTER_DIR, { recursive: true })
    const scratch = await mkdtemp(join(tmpdir(), 'vizmatic-posters-'))
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    let written = 0
    try {
        for (const film of await loadFilmCatalog()) {
            const pending = []
            for (const theme of THEMES) {
                const target = join(POSTER_DIR, `${film.id}_${theme.name}.webp`)
                if (force || !(await exists(target))) pending.push({ ...theme, target })
            }
            if (pending.length === 0) continue
            const module = await import(resolve('examples/films', `${film.id}.ts`)) as { default?: FilmDefinition }
            if (!isFilm(module.default)) continue
            for (const theme of pending) {
                // A film with its own art direction keeps it, and only the ground follows the page.
                const look = film.look && film.look !== 'midnight' ? film.look as 'paper' : theme.look
                const compiled = await compileFilm(module.default, { look, background: theme.background })
                const png = join(scratch, `${film.id}-${theme.name}.png`)
                await renderFilmFrame(compiled, film.posterTime ?? compiled.duration * 0.66, png, { width: 1440 })
                const webp = await page.evaluate(async (source) => {
                    const image = new Image()
                    image.src = source
                    await image.decode()
                    const canvas = document.createElement('canvas')
                    canvas.width = image.naturalWidth
                    canvas.height = image.naturalHeight
                    canvas.getContext('2d')!.drawImage(image, 0, 0)
                    return canvas.toDataURL('image/webp', 0.86).split(',')[1]!
                }, `data:image/png;base64,${(await readFile(png)).toString('base64')}`)
                await writeFile(theme.target, Buffer.from(webp, 'base64'))
                written++
            }
        }
    } finally {
        await browser.close()
        await rm(scratch, { recursive: true, force: true })
    }
    return written
}

if (process.argv[1]?.endsWith('build-film-posters.ts')) {
    const written = await buildFilmPosters(process.argv.includes('--force'))
    console.log(`Wrote ${written} poster(s) to ${POSTER_DIR}`)
}
