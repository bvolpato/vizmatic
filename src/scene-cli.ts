#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { renderSceneFrame, renderSceneVideo } from './scene-renderer'
import { SCENE_LIMITS, type SceneFrameRequest } from './scene-contract'

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
        process.stdout.write('Usage: vizmatic-scene --input request.json --output scene.png|scene.mp4\nAll request time values are in seconds. Source is bare TSX, never a Node module.\n')
        return
    }
    if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output') {
        throw new Error('Usage: vizmatic-scene --input request.json --output scene.png|scene.mp4')
    }
    const input = args[1], outputPath = args[3]
    const extension = extname(outputPath).toLowerCase()
    if (extension !== '.png' && extension !== '.mp4') throw new Error('Scene output must be a PNG or MP4 file.')
    if ((await stat(input)).size > SCENE_LIMITS.sourceBytes * 6 + 32_768) throw new Error('Scene request file exceeds its size limit.')
    const request: unknown = JSON.parse(await readFile(input, 'utf8'))
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Scene request must be a JSON object.')
    const allowed = new Set(['source', 'width', 'height', 'duration', 'time', 'fps', 'theme', 'cues', 'seed'])
    if (Object.keys(request).some((name) => !allowed.has(name))) throw new Error('Scene request contains an unsupported field.')
    const options = { ...request as SceneFrameRequest, outputPath }
    const metadata = extension === '.png' ? await renderSceneFrame(options) : await renderSceneVideo(options)
    process.stdout.write(`${JSON.stringify(metadata)}\n`)
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Scene rendering failed.'}\n`.slice(0, 4_096))
    process.exitCode = 1
})
