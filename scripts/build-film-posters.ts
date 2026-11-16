/**
 * Render a poster for each film in both site themes. Lossless WebP preserves the
 * bloom's dither. Existing posters stay in place, so the site build does not need
 * FFmpeg. Run it by hand with --force after a film changes.
 *
 *   npx tsx scripts/build-film-posters.ts --force
 */
import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { compileFilm, isFilm, resolveLook, type FilmDefinition } from '../src/stage/index'
import { renderFilmFrame } from '../src/stage/export'
import { loadFilmCatalog } from './site-content'

export const POSTER_DIR = 'docs/assets/site/posters'
const THEMES = [
    { name: 'dark', look: 'midnight', background: '#0c0b09' },
    { name: 'light', look: 'paper', background: '#f7f3ea' },
] as const

const exists = (path: string) => access(path).then(() => true, () => false)
const execFileAsync = promisify(execFile)

export async function encodeFilmPoster(png: string, webp: string): Promise<void> {
    await execFileAsync('ffmpeg', [
        '-v', 'error', '-nostdin', '-y', '-i', png, '-frames:v', '1',
        '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-pix_fmt', 'bgra', webp,
    ])
}

export async function buildFilmPosters(force = false): Promise<number> {
    await mkdir(POSTER_DIR, { recursive: true })
    const scratch = await mkdtemp(join(tmpdir(), 'vizmatic-posters-'))
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
                // Gallery previews share the page palette; film pages retain their authored looks.
                const base = resolveLook(theme.look)
                const compiled = await compileFilm(
                    module.default,
                    {
                        look: { ...base, background: theme.background, colors: { ...base.colors, bg: theme.background } },
                        background: theme.background,
                    },
                )
                const png = join(scratch, `${film.id}-${theme.name}.png`)
                await renderFilmFrame(compiled, film.posterTime ?? compiled.duration * 0.66, png, { width: 1440 })
                const webp = join(scratch, `${film.id}-${theme.name}.webp`)
                await encodeFilmPoster(png, webp)
                await copyFile(webp, theme.target)
                written++
            }
        }
    } finally {
        await rm(scratch, { recursive: true, force: true })
    }
    return written
}

if (process.argv[1]?.endsWith('build-film-posters.ts')) {
    const written = await buildFilmPosters(process.argv.includes('--force'))
    console.log(`Wrote ${written} poster(s) to ${POSTER_DIR}`)
}
