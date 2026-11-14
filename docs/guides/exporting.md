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

| Quality | Use | H.264 CRF | Motion blur | Bloom dither |
|---|---|---|---|---|
| `draft` | Checking timing. | 26 | off | off |
| `standard` | The default. | 18 | off | off |
| `high` | Publishing. | 15 | 4 samples | on |
| `master` | Archiving and re-encoding. | 11 | 8 samples | on |

Motion blur evaluates every sampled time and averages real sub-frames across the shutter. `--motion-blur` and `--shutter` set these directly.

The bloom dither is for soft light on a dark look. Without it, the halo of a bright mark is cut to whole levels, and it shows faint contour lines. With it, the halo is smooth, with fine grain of one level. `high` and `master` have the dither, because they make the copy that you publish. `draft` and `standard` do not, because they are for work on a film, and the dither costs time. Measured at 1080p on a loaded laptop, with the dither against without:

| | `standard` | `high` |
|---|---|---|
| Frames per second of the export | 8% to 25% fewer | 1% to 11% fewer |
| Size of the MP4 | 7% smaller to 27% larger | 2% to 20% larger |

`--dither` turns the dither on at any quality, and `--no-dither` turns it off. From code, the option is `dither: true` or `dither: false`. A film in a look with no bloom, such as `paper`, has no dither to turn on. [Bloom](#bloom) says what each output format keeps of the grain.

MP4 files stay at H.264 level 4.2 at 1080p60, so they play in QuickTime, Quick Look, and on Apple devices. To join another clip to a film without encoding it again, encode the clip with `filmEncoderSettings(quality)` from `vizmatic/stage/export`. QuickTime reads one set of decoder settings from the start of a file, and it stops at a clip that uses different ones.

### Hardware H.264 on macOS

For standard-quality MP4s, pass `h264Encoder: 'videotoolbox'` to `renderFilmVideo` or `renderRgbaVideo`. The exporter checks that FFmpeg can encode a frame at the requested dimensions and frame rate using Apple hardware. If the check fails, it uses the default software encoder, `libx264`. The result’s `h264Encoder` field records the encoder used. Before publishing a hardware encode, the exporter reads its video packets and checks that every scheduled frame has exactly one presentation timestamp. If the encoder drops a picture or reports an error, the exporter preserves the existing destination file.

The hardware path uses VideoToolbox quality 75 and a maximum interval of 250 frames between keyframes. Different CRF values, custom x264 parameters and tuning other than `animation` use the software encoder. Hardware files can be larger. Rasterization, audio, captions and frame timing still use the same paths.

When joining independently rendered scenes, call `resolveH264Encoder('videotoolbox', ffmpegPath, { width, height, fps })` from `vizmatic` once. Pass its result as `h264Encoder` with `requireH264Encoder: true` to every scene and the intro. This keeps all segments on the same encoder. If the selected hardware becomes unavailable, the export fails before publishing an incompatible segment.

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

Bloom is smooth light over a few of the 256 levels of a channel. Cut to whole levels, it shows contour lines on a dark page. So the export dithers the bloom: a fixed pattern rounds each pixel up or down, and a line becomes fine grain of one level. A pixel that the light does not reach keeps its exact color. A pixel with alpha 0 gets no grain. The pattern depends on the place of a pixel only, so a still picture has the same grain in every frame and on every run. With motion blur, the dither comes once, after the average of the shutter samples.

Each output keeps a different part of the grain:

| Output | How the light is written |
|---|---|
| PNG | Dithered, unless the option turns it off. The file holds each pixel as rendered. |
| MP4 at `high`, `master` | Dithered, unless the option turns it off. The encoder keeps the grain in the flat dark parts, and not every pixel of it. |
| MP4 at `draft`, `standard` | Cut to whole levels, unless the option turns the dither on. |
| WebM | Dithered or not as an MP4 of the same quality. The VP9 encoder keeps part of the grain, less than H.264 does. |
| GIF | Cut to whole levels, with any option. A palette of 256 colors cannot hold the grain. |
| Preview in the browser | Cut to whole levels. |

With the settings of a film alone, the H.264 encoder drops the grain and leaves squares of 16 px in its place. So an MP4 with the dither gets more x264 settings: `subme=6:trellis=0` at `high` and `master`, `aq-strength=1.0:subme=6:trellis=0` at `standard`, and `aq-strength=2.0` at `draft`. They do not change the decoder settings of the file, so a clip with `filmEncoderSettings(quality)` still joins. On a picture with no dither, these settings alone cost 0.6 to 0.7 dB of luma PSNR at `high` and 1.2 to 1.7 dB at `standard`, with the same SSIM. A movie with no dither gets the settings of a film alone.

A PNG still with bloom was about three times as large with the dither. A `draft` with the dither was about half as large again.

## Speed

Each frame compiles to SVG on the main thread and rasterizes on a worker. The exporter chooses the thread count from your CPU count and frame size. Use `--workers` to change it. See the [benchmarks](../benchmarks.html) for measured numbers from the component renderer.

A movie or GIF export compares each frame with the frame before it, on the main thread. A frame that is equal takes the pixels of that frame, and no worker rasterizes it. Two frames are equal when every SVG sample, the dimensions, the bloom and dither settings, and the background value are identical. This applies to generated frames with prepared, embedded image assets. A frame with an unresolved image reference always rasterizes again, because the file can change between two frames. Updaters and every shutter sample still run before this comparison.

With motion blur, shutter samples next to each other with the same SVG share one raster inside a frame. This applies to every frame, with any image, because one frame is one render.

For the comparison, the export keeps the SVG text of one frame and the pixels of one frame in memory. Equal frames share one pixel buffer. A film whose frames alternate between two pictures gets no reuse, because each frame differs from the frame before it.

On macOS, the frames go to FFmpeg through a TCP socket on the loopback address `127.0.0.1`, because the pipe of a child process has 8 KB buffers there. If the export cannot open the socket in 2 seconds, it uses the pipe. Set the environment variable `VIZMATIC_FFMPEG_PIPE=1` to use the pipe at once, for example on a machine whose firewall drops loopback connections.

To measure an export, run the benchmark on a short range of a film:

```bash
pnpm benchmark:export examples/films/lorenz.ts --from 5 --to 15 --quality standard --workers 6,12 --repeat 3
```

It prints the frames per second, the count of frames that a worker computed, the count of frames that took the pixels of the frame before, and the time in each step: the main thread, the raster, the average of the shutter samples, the bloom, and the waits for frames and for the encoder. The load of the machine changes the numbers, so compare two runs only at a similar load.

## Reuse encoded GOPs in an MP4

Use `planAvcSplice` to copy complete groups of pictures from compatible constant-frame-rate AVC MP4s. Each range uses zero-based display frames and an exclusive end. Cuts inside a source must land on IDR pictures. The planner compares the AVC decoder configuration, presentation format and packet clocks. It runs FFmpeg in stream-copy mode and checks each outgoing picture packet against its source. It reads local files with FFprobe and FFmpeg on your PATH. Keep the inputs immutable from planning through muxing.

```ts
import { planAvcSplice } from 'vizmatic'

const { concatScript, frameCount } = await planAvcSplice([
    { path: 'opening.mp4', startFrame: 0, endFrame: 48 },
    { path: 'master.mp4', startFrame: 48, endFrame: 240 },
])
```

Give `concatScript` to FFmpeg as a concat input with `-copyts -f concat -safe 0 -auto_convert 0 -protocol_whitelist file,pipe -i pipe:0`. Map `0:v:0` with `-c:v copy`. For a finished movie, supply the separately approved audio, subtitles, metadata and chapters as explicit mux inputs. Verify those tracks and the final MP4 against the intended timeline. The example uses a 48-frame boundary shared by both sources.

### Reusing a Canvas pixel readback

For a serial RGBA export, `createCanvasReadback(context, readPixels)` can return the previous pixel snapshot when two consecutive drawings issue the same supported commands. Each frame resets the native context and runs the synchronous drawing callback once. Shapes, text and state changes still execute on the native canvas. A state query, gradient, image, pattern or other untracked operation switches the rest of that export to ordinary readback.

Give the helper exclusive ownership of a fixed-size context. Draw through the context supplied to the callback. Register fonts before starting the export and keep them fixed until it finishes. Use a readback function that returns an owned pixel snapshot. Treat the returned pixels as read-only and finish consuming them before requesting the next frame. Use `stats()` to inspect the number of frames, reused snapshots and whether tracking is still active.

```ts
const frames = createCanvasReadback(context, () => canvas.data())
const pixels = frames.frame(ctx => drawLessonFrame(ctx, clock))
```
