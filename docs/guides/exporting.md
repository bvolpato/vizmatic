---
title: Exporting
nav: Exporting
section: Ship
order: 2
description: Export MP4, WebM, GIF, PNG, and SVG from the command line or from code. Frames rasterize on worker threads and encode in order.
---

## From the command line

```bash
npx vizmatic film my-film.ts --out ./out
npx vizmatic film my-film.ts --format mp4,webm,gif --quality high
npx vizmatic film my-film.ts --look midnight,paper --width 3840
```

MP4 export needs FFmpeg with `libx264`. WebM also needs `libvpx-vp9`. The CLI writes a manifest with sizes and timings beside the files.

## Quality

| Quality | Use | H.264 CRF | Motion blur |
|---|---|---|---|
| `draft` | Checking timing. | 26 | off |
| `standard` | The default. | 18 | off |
| `high` | Publishing. | 15 | 4 samples |
| `master` | Archiving and re-encoding. | 11 | 8 samples |

Motion blur evaluates every sampled time and averages real sub-frames across the shutter. `--motion-blur` and `--shutter` set these directly.

MP4 files stay at H.264 level 4.2 at 1080p60, so they play in QuickTime, Quick Look, and on Apple devices. To join another clip to a film without encoding it again, encode the clip with `filmEncoderSettings(quality)` from `vizmatic/stage/export`. QuickTime reads one set of decoder settings from the start of a file, and it stops at a clip that uses different ones.

## Resolution

A film is authored in stage units, so `--width` changes only the pixel count. MP4 and WebM need even dimensions, so the export rounds an odd width or height up to the next even number.

## Stills

`--frame` writes PNG files at the given times. `--poster` also writes the fullest moment at rest, or the time you set with `film({ poster: 12 })`.

```bash
npx vizmatic film my-film.ts --frame 2.5,7 --width 1280
```

`--every` samples the film at an interval, in place of a list of times. `--sheet` joins the stills into one PNG, a contact sheet, with the time under each tile. With `--sheet`, `--width` is the width of one tile and defaults to 480. A sheet has up to 6 rows, and a longer list of times continues on the next sheet.

```bash
npx vizmatic film my-film.ts --every 5 --sheet --columns 4
npx vizmatic film my-film.ts --range 30:60 --every 1 --sheet
```

In code, `renderFilmSheet(film, times, path, { width, columns })` from `vizmatic/stage/export` writes one sheet.

## SVG

A frame is a list of vector paths, so it exports as standalone SVG with no fonts needed.

```bash
npx vizmatic film my-film.ts --format svg --frame 7
```

## Part of a film

`--range` renders part of the timeline, which helps while you adjust one section.

```bash
npx vizmatic film my-film.ts --range 12:18 --quality draft
```

## Sound

`--audio` adds a track. The audio is padded or trimmed to the film's length. An MP4 gets stereo AAC at 48 kHz and 384 kbit/s, which is what YouTube asks for in an upload. FFmpeg must include AAC.

```bash
npx vizmatic film my-film.ts --audio narration.wav
```

Captions from `s.caption` export as a WebVTT file beside the video.

## From code

```ts
import { compileFilm, film, text, write } from 'vizmatic/stage'
import { renderFilmFrame, renderFilmVideo } from 'vizmatic/stage/export'

const intro = film((s) => {
    s.play(write(s.add(text('Hello', { font: 'text-serif', size: 200 }))))
})

export async function render(): Promise<void> {
    const compiled = await compileFilm(intro, { look: 'paper' })
    await renderFilmVideo(compiled, 'out/intro.mp4', { quality: 'high' })
    await renderFilmFrame(compiled, compiled.duration, 'out/intro.png', { width: 1280 })
}
```

## Bloom

Bloom is part of a look, and export applies it after rasterizing. Pass `bloom` on the film to change it. Set it to `0` for line art that needs exact colors.

## Speed

Each frame compiles to SVG on the main thread and rasterizes on a worker. The exporter chooses the thread count from your CPU count and frame size. Use `--workers` to change it. See the [benchmarks](../benchmarks.html) for measured numbers from the component renderer.

Each worker can reuse its last completed RGBA result when every SVG sample, dimension, bloom setting, and background value is identical. This applies to generated frames with prepared, embedded image assets. Raw SVG jobs and unresolved image references always rasterize again. Updaters and every shutter sample still run before this comparison.

The worker retains one private result, capped at 64 MiB of pixels and an 8 MiB serialized-key allowance. Returned buffers are separate copies. Render planning includes this retained memory when choosing workers.
