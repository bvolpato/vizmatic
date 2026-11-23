/**
 * Render a poster for each film in both site themes. Lossless WebP preserves the
 * bloom's dither. Existing posters stay in place, so the site build does not need
 * FFmpeg. Run it by hand with --force after a film changes.
 *
 *   npx tsx scripts/build-film-posters.ts --force
 */
import { execFile, spawnSync } from 'node:child_process'
import { access, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { compileFilm, isFilm, resolveLook, type CompileOverrides, type FilmDefinition } from '../src/stage/index'
import { renderFilmFrame } from '../src/stage/export'
import { defaultPoolSize, RasterPool } from '../src/stage/raster'
import { HOME_SHOWCASE_SPECS, loadFilmCatalog } from './site-content'

export const POSTER_DIR = 'docs/assets/site/posters'
const POSTER_WIDTH = 960
const THEMES = [
    { name: 'dark', look: 'midnight', background: '#0c0b09' },
    { name: 'light', look: 'paper', background: '#f7f3ea' },
] as const

const exists = (path: string) => access(path).then(() => true, () => false)
const execFileAsync = promisify(execFile)
let webpEncoder: 'ffmpeg' | 'cwebp' | null = null

function pickWebpEncoder(): 'ffmpeg' | 'cwebp' {
    if (webpEncoder) return webpEncoder
    const probe = spawnSync('ffmpeg', ['-hide_banner', '-h', 'encoder=libwebp'], { encoding: 'utf8' })
    webpEncoder = probe.stdout?.includes('Supported pixel formats:') ? 'ffmpeg' : 'cwebp'
    return webpEncoder
}

export async function encodeFilmPoster(png: string, webp: string): Promise<void> {
    if (pickWebpEncoder() === 'ffmpeg') {
        await execFileAsync('ffmpeg', [
            '-v', 'error', '-nostdin', '-y', '-i', png, '-frames:v', '1',
            '-c:v', 'libwebp', '-lossless', '1', '-compression_level', '6', '-pix_fmt', 'bgra', webp,
        ])
    } else {
        await execFileAsync('cwebp', ['-quiet', '-lossless', '-z', '6', png, '-o', webp])
    }
}

export async function buildFilmPosters(force = false, onlyIds?: ReadonlySet<string>): Promise<number> {
    await mkdir(POSTER_DIR, { recursive: true })
    const scratch = await mkdtemp(join(tmpdir(), 'vizmatic-posters-'))
    const pool = new RasterPool(Math.min(4, defaultPoolSize()))
    let written = 0
    const showcaseById = new Map(HOME_SHOWCASE_SPECS.map((spec) => [spec.id, spec]))
    try {
        for (const film of await loadFilmCatalog()) {
            if (onlyIds && !onlyIds.has(film.id)) continue
            const showcase = showcaseById.get(film.id)
            const variants: Array<{ prefix: string; time: number | undefined }> = [
                { prefix: '', time: film.posterTime },
                ...(showcase ? [{ prefix: 'showcase-', time: showcase.start }] : []),
            ]
            const pending: Array<{ theme: typeof THEMES[number]; target: string; time: number | undefined; variantKey: string }> = []
            for (const variant of variants) {
                for (const theme of THEMES) {
                    const target = join(POSTER_DIR, `${variant.prefix}${film.id}_${theme.name}.webp`)
                    if (force || !(await exists(target))) pending.push({ theme, target, time: variant.time, variantKey: variant.prefix })
                }
            }
            if (pending.length === 0) continue
            const module = await import(resolve('examples/films', `${film.id}.ts`)) as { default?: FilmDefinition }
            if (!isFilm(module.default)) continue
            const fixedLook = Boolean(film.look && film.look !== 'midnight')
            const fixedWebps = new Map<string, string>()
            for (const item of pending) {
                const existingFixed = fixedLook ? fixedWebps.get(item.variantKey) : undefined
                if (existingFixed) {
                    await copyFile(existingFixed, item.target)
                    written++
                    continue
                }
                // Preserve each film's authored palette (blueprint, chalk, paper, neon) so posters
                // match hover previews in both themes; midnight films adopt the active site ground.
                let overrides: CompileOverrides
                if (fixedLook) {
                    overrides = { look: film.look as CompileOverrides['look'] }
                } else {
                    const base = resolveLook(item.theme.look)
                    overrides = {
                        look: { ...base, background: item.theme.background, colors: { ...base.colors, bg: item.theme.background } },
                        background: item.theme.background,
                    }
                }
                const compiled = await compileFilm(module.default, overrides)
                const png = join(scratch, `${item.variantKey}${film.id}-${item.theme.name}.png`)
                await renderFilmFrame(compiled, item.time ?? compiled.duration * 0.66, png, { width: POSTER_WIDTH, pool })
                const webp = join(scratch, `${item.variantKey}${film.id}-${item.theme.name}.webp`)
                await encodeFilmPoster(png, webp)
                if (fixedLook) fixedWebps.set(item.variantKey, webp)
                await copyFile(webp, item.target)
                written++
            }
        }
    } finally {
        await pool.close()
        await rm(scratch, { recursive: true, force: true })
    }
    return written
}

if (process.argv[1]?.endsWith('build-film-posters.ts')) {
    const filmIndex = process.argv.indexOf('--film')
    const only = filmIndex >= 0 && process.argv[filmIndex + 1]
        ? new Set(process.argv[filmIndex + 1]!.split(',').filter(Boolean))
        : undefined
    const written = await buildFilmPosters(process.argv.includes('--force'), only)
    console.log(`Wrote ${written} poster(s) to ${POSTER_DIR}`)
}
