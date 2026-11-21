import { spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { decode } from 'fast-png'
import { afterEach, expect, it } from 'vitest'
import { encodeFilmPoster } from '../scripts/build-film-posters'
import { computeFilmCacheKey, computeFilmEngineHash, parseShard, saveCachedFilm, shardCatalog, tryRestoreCachedFilm } from '../scripts/render-films'
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

it('keeps Canvas and GPU edits out of CPU cache keys while retaining shared rendering inputs', async () => {
    const root = await tempDirectory()
    const files: Record<string, string> = {
        'package.json': '{"dependencies":{"@resvg/resvg-js":"1"}}',
        'pnpm-lock.yaml': 'resolved dependencies v1',
        'src/stage/index.ts': "export * from './display'\n",
        'src/stage/display.ts': "export { paintFrame } from './display-canvas'\nexport const svg = 'v1'\n",
        'src/stage/display-canvas.ts': "export const paintFrame = 'canvas-v1'\n",
        'src/stage/export.ts': "export const gpu = () => import('./gpu-raster')\n",
        'src/stage/gpu-raster.ts': "export * from './gpu-wire'\n",
        'src/stage/gpu-wire.ts': "export const encode = 'v1'\n",
        'src/stage/gpu-runtime.ts': "export const gpuRuntime = 'v1'\n",
        'src/stage/bloom-canvas.ts': "export const canvasBloom = 'v1'\n",
        'src/stage/bloom-webgl.ts': "export const webglBloom = 'v1'\n",
        'src/stage/bloom-kernel.mjs': 'export const bloom = 1\n',
        'src/video.ts': "import './render'\n",
        'src/render.ts': "export const render = 'v1'\n",
        'src/math.ts': 'export const math = 1\n',
        'src/chemistry-elements.ts': 'export const elements = 1\n',
        'assets/fonts/font.ttf': 'font v1',
        'assets/emoji.json.br': 'emoji v1',
        'examples/films/sample.ts': "import '../../src/stage/index'\nexport default 1\n",
    }
    for (const [path, content] of Object.entries(files)) {
        const target = join(root, path)
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, content)
    }
    const films = join(root, 'examples/films')
    const key = async () => computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'standard', await computeFilmEngineHash(root), films)
    const original = await key()
    for (const path of ['display-canvas.ts', 'gpu-raster.ts', 'gpu-wire.ts', 'gpu-runtime.ts', 'bloom-canvas.ts', 'bloom-webgl.ts']) {
        await writeFile(join(root, 'src/stage', path), "export const changed = 'v2'\n")
        expect(await key(), path).toBe(original)
    }
    for (const path of ['src/stage/display.ts', 'src/stage/bloom-kernel.mjs', 'src/render.ts', 'src/math.ts', 'src/video.ts', 'assets/fonts/font.ttf', 'assets/emoji.json.br', 'pnpm-lock.yaml']) {
        await writeFile(join(root, path), files[path] + '\nchanged')
        expect(await key(), path).not.toBe(original)
        await writeFile(join(root, path), files[path])
    }
})

it('rejects truncated or mismatched cached video bytes even when their input key matches', async () => {
    const directory = await tempDirectory()
    const rendered = join(directory, 'rendered.mp4'), restored = join(directory, 'restored.mp4')
    await writeFile(rendered, 'complete video')
    await saveCachedFilm(directory, 'sample', 'key', rendered)
    await writeFile(join(directory, 'sample.mp4'), 'complete videX')
    expect(await tryRestoreCachedFilm(directory, 'sample', 'key', restored)).toBeNull()
    await writeFile(join(directory, 'sample.mp4'), 'short')
    expect(await tryRestoreCachedFilm(directory, 'sample', 'key', restored)).toBeNull()
    await saveCachedFilm(directory, 'sample', 'key', rendered)
    expect(await tryRestoreCachedFilm(directory, 'sample', 'key', restored)).toBe(14)
    expect(await readFile(restored, 'utf8')).toBe('complete video')
})

it('hashes inherited tsconfig settings and follows aliases to the CPU engine and film dependencies', async () => {
    const root = await tempDirectory()
    const files: Record<string, string> = {
        'package.json': '{"type":"module"}',
        'pnpm-lock.yaml': 'fixture dependencies',
        'tsconfig.json': '{ "extends": "./config/base.json" }',
        'config/base.json': '{ "extends": "./paths.json", "compilerOptions": { "jsx": "react-jsx" } }',
        // JSONC and paths relative to the config that declares them, without baseUrl.
        'config/paths.json': '{ // inherited aliases\n "compilerOptions": { "paths": { "@engine/*": ["../shared/*"], "@film/*": ["../models/*"] }, }, }',
        'src/stage/index.ts': "export { color } from '@engine/palette'\n",
        'src/video.ts': 'export {}',
        'src/math.ts': 'export {}',
        'src/chemistry-elements.ts': 'export {}',
        'shared/palette.js': "export const color = 'red'\n",
        'shared/palette.d.ts': 'export const color: string\n',
        'models/data.ts': 'export const value = 1\n',
        'examples/films/sample.ts': "import { value } from '@film/data'\nexport default value\n",
    }
    for (const [path, content] of Object.entries(files)) {
        const target = join(root, path)
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, content)
    }
    const engine = () => computeFilmEngineHash(root)
    const key = () => computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'standard', 'fixed-engine', join(root, 'examples/films'))
    const initialEngine = await engine(), initialKey = await key()
    for (const path of ['tsconfig.json', 'config/base.json', 'config/paths.json']) {
        await writeFile(join(root, path), files[path] + '\n// changed compiler configuration')
        expect(await engine(), path).not.toBe(initialEngine)
        expect(await key(), path).not.toBe(initialKey)
        await writeFile(join(root, path), files[path])
    }
    await writeFile(join(root, 'shared/palette.js'), "export const color = 'blue'\n")
    expect(await engine()).not.toBe(initialEngine)
    expect(await key()).toBe(initialKey)
    await writeFile(join(root, 'shared/palette.js'), files['shared/palette.js'])
    await writeFile(join(root, 'models/data.ts'), 'export const value = 2\n')
    expect(await engine()).toBe(initialEngine)
    expect(await key()).not.toBe(initialKey)
    await rm(join(root, 'models/data.ts'))
    await expect(key()).rejects.toThrow('Cannot hash dependency @film/data')
    await rm(join(root, 'config/paths.json'))
    await expect(engine()).rejects.toThrow('paths.json')
})

it('assigns every film once and balances CPU estimates independently of catalog order', () => {
    const catalog = Array.from({ length: 8 }, (_, i) => ({ id: `film-${i}`, duration: i + 1 }))
    const shards = shardCatalog(catalog, 4, {})
    expect(shards.flat().map(({ id }) => id).sort()).toEqual(catalog.map(({ id }) => id).sort())
    expect(shards.map((entries) => entries.reduce((sum, entry) => sum + entry.duration, 0))).toEqual([9, 9, 9, 9])
    expect(shardCatalog([...catalog].reverse(), 4, {})).toEqual(shards)
    // Measured CPU time takes precedence over duration.
    expect(shardCatalog(catalog, 4, { 'film-0': 100 })[0]).toEqual([catalog[0]])
    expect(shardCatalog(catalog.slice(0, 2), 4, {}).map((entries) => entries.length)).toEqual([1, 1, 0, 0])
    expect(() => shardCatalog([catalog[0]!, catalog[0]!], 4)).toThrow('duplicate film ID')
    expect(parseShard('4/4')).toEqual({ index: 4, count: 4 })
    for (const value of ['0/4', '5/4', '1/0', '1.5/4', '1', '-1/4']) expect(() => parseShard(value)).toThrow('--shard')
})

it('tracks imported data, module-relative assets and companion assets in a film key', async () => {
    const directory = await tempDirectory()
    await mkdir(join(directory, '_sample'))
    const files = {
        'sample.ts': "import './shared'\nexport const asset = new URL('./picture.svg', import.meta.url)\n",
        'shared.ts': "export { default } from './data.json'\n",
        'data.json': '{"value":1}',
        'picture.svg': '<svg/>',
        '_sample/texture.bin': 'texture',
    }
    for (const [path, content] of Object.entries(files)) await writeFile(join(directory, path), content)
    const key = () => computeFilmCacheKey({ id: 'sample', look: 'midnight' }, 'standard', 'engine', directory)
    const initial = await key()
    for (const path of ['data.json', 'picture.svg', '_sample/texture.bin'] as const) {
        await writeFile(join(directory, path), files[path] + ' changed')
        expect(await key()).not.toBe(initial)
        await writeFile(join(directory, path), files[path])
    }
    await rm(join(directory, 'data.json'))
    await expect(key()).rejects.toThrow('Cannot hash dependency ./data.json')
})

it.skipIf(process.platform === 'win32')('assembles four CPU shards from verified caches and refuses an incomplete assembly', async () => {
    const directory = await tempDirectory()
    const films = join(directory, 'examples/films'), bin = join(directory, 'bin')
    await mkdir(films, { recursive: true })
    await mkdir(bin)
    await mkdir(join(directory, 'src/stage'), { recursive: true })
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(join(directory, 'pnpm-lock.yaml'), 'fixture dependencies')
    for (const name of ['video', 'math', 'chemistry-elements']) await writeFile(join(directory, 'src', `${name}.ts`), 'export {}')
    const catalog = Array.from({ length: 4 }, (_, i) => ({ id: `sample-${i}`, look: 'midnight', duration: 1, posterTime: 0 }))
    await writeFile(join(films, 'catalog.json'), JSON.stringify(catalog))
    for (const { id } of catalog) await writeFile(join(films, `${id}.ts`), `
import { film } from ${JSON.stringify(pathToFileURL(resolve('src/stage/index.ts')).href)}
export default film({ width: 16, height: 16, fps: 1 }, (stage) => stage.wait(1))
`)
    // This encoder records CPU selection and preserves bytes for cache integrity checks.
    await writeFile(join(bin, 'ffmpeg'), '#!/bin/sh\nif [ "$1" = "-version" ]; then echo fixture-ffmpeg; exit 0; fi\nif [ "$1" = "-h" ]; then exit 0; fi\nprintf \'%s\\n\' "$@" >> "$ENCODER_LOG"\nfor last; do :; done\nexec cat > "$last"\n', { mode: 0o755 })
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ENCODER_LOG: join(directory, 'encoder.log'), VIZMATIC_DISABLE_NETWORK: '1' }
    delete env['NODE_OPTIONS']
    delete env['VIZMATIC_FILM_CACHE_DIR']
    for (const key of Object.keys(env)) if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    const run = (...args: string[]) => spawnSync(process.execPath, [
        '--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
        resolve('scripts/render-films.ts'), '--workers', '1', '--no-posters', ...args,
    ], { cwd: directory, encoding: 'utf8', env })
    const output = join(directory, 'docs/assets/films'), assembled = join(directory, 'assembled')
    await mkdir(assembled)
    for (let shard = 1; shard <= 4; shard++) {
        const cache = join(directory, `cache-${shard}`)
        const result = run('--shard', `${shard}/4`, '--cache-dir', cache)
        expect(result.status, result.stderr).toBe(0)
        expect((await readdir(output)).filter((name) => name.endsWith('.mp4'))).toHaveLength(1)
        expect(await readdir(output)).not.toContain('catalog.json')
        for (const name of await readdir(cache)) await copyFile(join(cache, name), join(assembled, name))
        await rm(output, { recursive: true })
    }
    expect((await readdir(assembled)).filter((name) => name.endsWith('.mp4')).sort()).toEqual(catalog.map(({ id }) => `${id}.mp4`))
    const before = await readFile(env.ENCODER_LOG!, 'utf8')
    expect(before.match(/libx264/g)).toHaveLength(4)
    const result = run('--cache-dir', assembled, '--require-cache')
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8'))).toEqual(catalog)
    expect(await readFile(env.ENCODER_LOG!, 'utf8')).toBe(before)
    await rm(join(assembled, 'sample-0.mp4'))
    const incomplete = run('--cache-dir', assembled, '--require-cache')
    expect(incomplete.status).not.toBe(0)
    expect(incomplete.stderr).toContain('Missing or invalid cached film: sample-0')
    expect(await readFile(env.ENCODER_LOG!, 'utf8')).toBe(before)
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
    expect(frames.subarray(0, 4).toString('ascii')).toBe('DKIF')
    expect(frames.readUInt32LE(32)).toBe(pixels.data.length)
    expect(frames.subarray(44, 44 + pixels.data.length)).toEqual(Buffer.from(pixels.data))
    const argsFile = (await readdir(output)).find((name) => name.endsWith('.args'))!
    const args = (await readFile(join(output, argsFile), 'utf8')).split('\n')
    expect(args[args.indexOf('-x264-params') + 1]).toBe('aq-strength=1.0:subme=6:trellis=0')
})
