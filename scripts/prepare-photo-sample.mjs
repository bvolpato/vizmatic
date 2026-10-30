#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = 'https://raw.githubusercontent.com/scikit-image/scikit-image/e8a42ba85aaf5fd9322ef9ca51bc21063b22fcae/skimage/data/coffee.png'
const sourceSha256 = 'cc02f8ca188b167c775a7101b5d767d1e71792cf762c33d6fa15a4599b5a8de7'
const preparedSha256 = '7ce98fef02b2bb5d6a073502c70e7ca5203187a4133973f8729e2d2be3ff7ba4'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const directory = await mkdtemp(join(tmpdir(), 'vizmatic-coffee-'))
try {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Photo download failed: HTTP ${response.status}`)
    const original = Buffer.from(await response.arrayBuffer())
    if (hash(original) !== sourceSha256) throw new Error('The source photo differs from the reviewed sample')
    const input = join(directory, 'source.png'), output = join(directory, 'prepared.png')
    await writeFile(input, original)
    execFileSync('ffmpeg', [
        '-v', 'error', '-i', input,
        '-vf', 'scale=384:256:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:reserve_transparent=0[p];[b][p]paletteuse=dither=sierra2_4a',
        '-frames:v', '1', '-compression_level', '9', output, '-y',
    ], { stdio: 'inherit' })
    const prepared = await readFile(output)
    if (hash(prepared) !== preparedSha256) {
        throw new Error('FFmpeg produced different photo bytes; review the image before updating its pinned digest')
    }
    const target = fileURLToPath(new URL('../examples/catalog-photo-blur.tsx', import.meta.url))
    const text = await readFile(target, 'utf8')
    const start = '// PHOTO_SAMPLE_START', end = '// PHOTO_SAMPLE_END'
    if (!text.includes(start) || !text.includes(end)) throw new Error('Photo sample markers are missing')
    const block = `${start}\n// Rachel Michetti, CC0, via scikit-image. Sharp 384 × 256 palette PNG, no blur.\n// Source SHA-256: ${sourceSha256}\n// Prepared SHA-256: ${preparedSha256}\nexport const photoPngDataUri = 'data:image/png;base64,${prepared.toString('base64')}'\n${end}`
    await writeFile(target, text.slice(0, text.indexOf(start)) + block + text.slice(text.indexOf(end) + end.length))
    console.log(JSON.stringify({ source, sourceSha256, preparedSha256, width: 384, height: 256, bytes: prepared.length, target }))
} finally {
    await rm(directory, { recursive: true, force: true })
}
