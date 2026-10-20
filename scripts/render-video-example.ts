import { copyFile, mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { pathToFileURL } from 'url'
import { renderAnimationVideo, renderToPng } from '../src/index'
import { create, createAnimation, width, height, slope } from '../examples/videos/signal-to-story'

export async function renderVideoExample(encodeVideo = true): Promise<void> {
    const directory = 'docs/assets/video'
    await mkdir(directory, { recursive: true })

    for (const theme of ['dark', 'light'] as const) {
        await renderToPng(create(theme), {
            width, height, scale: 1, crop: false, theme,
            outputPath: `${directory}/signal-to-story_${theme}.png`,
        })
    }

    await copyFile('examples/videos/signal-to-story.tsx', `${directory}/signal-to-story.tsx`)
    await writeFile(`${directory}/signal-to-story.vtt`, `WEBVTT

00:00.000 --> 00:02.000
From noise to signal. Make the invisible click.

00:02.000 --> 00:05.000
Twelve synthetic observations arrive one by one.

00:05.000 --> 00:09.400
A least-squares line is revealed, with a marker following its path.

00:09.400 --> 00:13.200
The trend increases by ${slope.toFixed(1)} units per observation, approximately.
The original observations remain visible.

00:13.200 --> 00:18.000
From code to clarity. Give your ideas a little motion.
Editable TSX, typed timelines, your next film.
`)

    if (encodeVideo) {
        const result = await renderAnimationVideo(createAnimation('dark'), {
            width, height, fps: 30, scale: 1, theme: 'dark', crf: 18, preset: 'medium',
            outputPath: `${directory}/signal-to-story.mp4`,
            onProgress: ({ index, count }) => {
                if (index % 90 === 0) console.log(`video ${index}/${count} frames`)
            },
        })

        console.log(`rendered ${result.frameCount} frames, ${result.width}×${result.height}, ${result.fps} fps, ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`)
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    await renderVideoExample(!process.argv.includes('--posters-only'))
}
