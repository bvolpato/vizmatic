import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decode } from 'fast-png'
import { afterEach, expect, it } from 'vitest'
import { encodeFilmPoster } from '../scripts/build-film-posters'
import { computeFilmCacheKey, saveCachedFilm, tryRestoreCachedFilm } from '../scripts/render-films'
import { circle, film } from '../src/stage/index'
import { renderFilmFrame } from '../src/stage/export'

const tempDirs: string[] = []
const hasWebp = spawnSync('ffmpeg', ['-hide_banner', '-h', 'encoder=libwebp'], { encoding: 'utf8' }).stdout?.includes('Supported pixel formats:')

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-catalog-quality-'))
    tempDirs.push(directory)
    return directory
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

it.skipIf(!hasWebp)('preserves every dithered poster pixel through WebP encoding', async () => {
    const directory = await tempDirectory()
    const png = join(directory, 'poster.png'), webp = join(directory, 'poster.webp')
    const definition = film({ width: 160, height: 90, bloom: 0.6 }, (stage) => {
        stage.add(circle(20, { stroke: 'yellow', width: 2 }))
        stage.wait(1)
    })
    await renderFilmFrame(definition, 0, png, { workers: 1 })
    const expected = decode(await readFile(png))
    await renderFilmFrame(definition, 0, join(directory, 'plain.png'), { workers: 1, dither: false })
    expect(Buffer.from(expected.data)).not.toEqual(Buffer.from(decode(await readFile(join(directory, 'plain.png'))).data))
    await encodeFilmPoster(png, webp)
    const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', webp, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    expect(decoded.status, decoded.stderr.toString()).toBe(0)
    expect(decoded.stdout).toEqual(Buffer.from(expected.data))
})

it('rejects catalog MP4 cache entries created before dither was enabled', async () => {
    const directory = await tempDirectory()
    await writeFile(join(directory, 'sample.ts'), 'export default 1\n')
    const rendered = join(directory, 'rendered.mp4'), restored = join(directory, 'restored.mp4')
    await writeFile(rendered, 'old video')
    // The old key for this source, midnight, standard, and engine-1.
    const oldKey = '9dac1ddffbdffceccbd924d1142af9d62c91479becadc69a2c7d47d70d0401f9'
    await saveCachedFilm(directory, 'sample', oldKey, rendered)
    const key = await computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'standard', 'engine-1', directory)
    expect(await tryRestoreCachedFilm(directory, 'sample', key, restored)).toBeNull()
    await saveCachedFilm(directory, 'sample', key, rendered)
    expect(await tryRestoreCachedFilm(directory, 'sample', key, restored)).toBe(9)
})

it.skipIf(process.platform === 'win32')('publishes standard catalog videos with dithered frames and grain settings', async () => {
    const directory = await tempDirectory()
    const films = join(directory, 'examples', 'films'), bin = join(directory, 'bin')
    await mkdir(films, { recursive: true })
    await mkdir(bin)
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(join(films, 'catalog.json'), JSON.stringify([{ id: 'sample', look: 'midnight', posterTime: 0 }]))
    await writeFile(join(films, 'sample.ts'), `
import { film, circle } from ${JSON.stringify(pathToFileURL(resolve('src/stage/index.ts')).href)}
export default film({ width: 160, height: 90, fps: 2, bloom: 0.6 }, (stage) => {
    stage.add(circle(20, { stroke: 'yellow', width: 2 }))
    stage.wait(1)
})
`)
    // Keep encoder input and options, so lossy H.264 cannot hide missing dither.
    await writeFile(join(bin, 'ffmpeg'), '#!/bin/sh\ncase "$1" in -h) exit 0;; esac\nfor last; do :; done\nprintf \'%s\\n\' "$@" > "$last.args"\nexec cat > "$last"\n', { mode: 0o755 })
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env['NODE_OPTIONS']
    delete env['VIZMATIC_FILM_CACHE_DIR']
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    const result = spawnSync(process.execPath, [
        '--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
        resolve('scripts/render-films.ts'), '--workers', '1',
    ], { cwd: directory, encoding: 'utf8', env })
    expect(result.status, result.stderr).toBe(0)
    const output = join(directory, 'docs', 'assets', 'films')
    const pixels = decode(await readFile(join(output, 'sample.png')))
    const frames = await readFile(join(output, 'sample.mp4'))
    expect(frames.subarray(0, pixels.data.length)).toEqual(Buffer.from(pixels.data))
    const argsFile = (await readdir(output)).find((name) => name.endsWith('.args'))!
    const args = (await readFile(join(output, argsFile), 'utf8')).split('\n')
    expect(args[args.indexOf('-x264-params') + 1]).toBe('aq-strength=1.0:subme=6:trellis=0')
})
