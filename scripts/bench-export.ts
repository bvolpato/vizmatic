/**
 * Measure the movie export of one film: frames per second, and where the time goes.
 * Use a short range, so that a run takes seconds. Compare two runs only at a similar load.
 * A film that imports `vizmatic/stage` uses the built package, so run `pnpm build` first.
 *
 *   tsx scripts/bench-export.ts examples/films/lorenz.ts --look midnight --from 5 --to 15
 *   tsx scripts/bench-export.ts ../film/film.ts --look midnight --from 300 --to 320 --quality high --workers 6,12 --repeat 3
 *
 * Options:
 *   --from, --to   The range in seconds. Defaults to the first 10 seconds.
 *   --quality      draft, standard, high or master. Defaults to standard.
 *   --workers      One count, or several with commas. Each count is one run. Defaults to the count of the export.
 *   --repeat       Runs for each worker count. The summary line gives the fastest. Defaults to 1.
 *   --look         The look of the film. Light looks have no bloom.
 *   --width        Output width in pixels.
 *   --keep         A folder that keeps the MP4 of each run. By default each MP4 is deleted.
 *   --ffmpeg       The FFmpeg program. A script that reads its input and drops it shows the speed with no encoder.
 */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { loadavg, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadFilmDefinition } from '../src/film-cli'
import { renderFilmVideo, type Quality } from '../src/stage/export'
import type { LookName } from '../src/stage/look'
import { onExportStats, type ExportStats } from '../src/stage/raster'

function option(name: string): string | undefined {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? process.argv[index + 1] : undefined
}

function numberOption(name: string): number | undefined {
    const value = option(name)
    if (value === undefined) return undefined
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, but received ${value}.`)
    return parsed
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`
const each = (ms: number, count: number) => count > 0 ? `${(ms / count).toFixed(1)} ms` : 'none'

async function main(): Promise<void> {
    const file = process.argv[2]
    if (!file || file.startsWith('--')) throw new Error('Give a film file: tsx scripts/bench-export.ts <film.ts> [--from 0 --to 10 --quality standard --workers 6,12 --repeat 3]')
    const quality = (option('quality') ?? 'standard') as Quality
    const repeat = Math.max(1, Math.floor(numberOption('repeat') ?? 1))
    const workerCounts: (number | undefined)[] = option('workers')?.split(',').map((value) => {
        const count = Number(value)
        if (!Number.isInteger(count) || count < 1) throw new Error(`--workers must be whole numbers of at least 1, but received ${value}.`)
        return count
    }) ?? [undefined]
    const keep = option('keep')
    const ffmpegPath = option('ffmpeg')

    const definition = await loadFilmDefinition(resolve(file), (path) => import(pathToFileURL(path).href))
    const look = option('look') as LookName | undefined
    // The film compiles itself, so a film from another folder uses the engine that it imports.
    const film = await definition.compile(look ? { look } : {})
    const from = numberOption('from') ?? 0
    const to = Math.min(film.duration, numberOption('to') ?? from + 10)
    const width = numberOption('width')

    const directory = keep ? resolve(keep) : await mkdtemp(join(tmpdir(), 'vizmatic-bench-'))
    await mkdir(directory, { recursive: true })
    let stats: ExportStats | undefined
    onExportStats((value) => { stats = value })
    try {
        console.log(`${film.title || file}: ${from} s to ${to} s at ${film.fps} fps, quality ${quality}, look ${film.look.name}`)
        for (const workers of workerCounts) {
            let best: { fps: number; workers: number } | undefined
            for (let run = 1; run <= repeat; run++) {
                stats = undefined
                const load = loadavg()[0]!
                const started = performance.now()
                const video = await renderFilmVideo(film, join(directory, `bench-${workers ?? 'default'}-${run}.mp4`), { quality, workers, from, to, width, ffmpegPath })
                const elapsed = performance.now() - started
                const fps = video.frameCount / (elapsed / 1000)
                if (!best || fps > best.fps) best = { fps, workers: video.workers }
                console.log(`\nrun ${run} of ${repeat}: ${video.workers} workers, ${video.width}x${video.height}, motion blur ${video.motionBlur}, load ${load.toFixed(1)}`)
                console.log(`  ${fps.toFixed(1)} frames per second: ${video.frameCount} frames in ${seconds(elapsed)}`)
                if (!stats) continue
                const s: ExportStats = stats
                const worked = s.computed
                console.log(`  frames: ${s.computed} computed, ${s.reused} reused from the frame before`)
                console.log(`  main thread: ${seconds(s.mainMs)} (${each(s.mainMs, video.frameCount)} a frame)`)
                console.log(`  workers, added over ${s.workers}: raster ${seconds(s.rasterMs)} (${each(s.rasterMs, worked)} a computed frame), motion blur average ${seconds(s.averageMs)} (${each(s.averageMs, worked)}), bloom ${seconds(s.bloomMs)} (${each(s.bloomMs, worked)})`)
                console.log(`  export loop: waits for frames ${seconds(s.frameWaitMs)}, waits for the encoder ${seconds(s.encoderWaitMs)}, encoder finish ${seconds(s.encoderFinishMs)}`)
            }
            if (best && repeat > 1) console.log(`\nbest of ${repeat} with ${best.workers} workers: ${best.fps.toFixed(1)} frames per second`)
        }
    } finally {
        onExportStats(undefined)
        if (!keep) await rm(directory, { recursive: true, force: true })
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
})
