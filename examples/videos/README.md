# Video examples

These TSX modules define finite videos with `createAnimation(theme)`. Each is a
generic example that depends on the published Vizmatic package.

- [`request-lifecycle.tsx`](request-lifecycle.tsx) is a short starter. It moves
  one request through receive, process, and return stages.
- [`signal-to-story.tsx`](signal-to-story.tsx) is a longer example. It adds
  observations to a chart, traces a fitted line, and holds the result on screen.

Use Node.js 20 or newer. In a project that contains the downloaded or copied
TSX file, install Vizmatic and React:

```bash
npm install --save-dev vizmatic@0.4.0 react
npx vizmatic video ./request-lifecycle.tsx --out ./dist/videos --theme dark --fps 30
```

Install [FFmpeg](https://ffmpeg.org/download.html) separately and confirm it
includes the `libx264` encoder. To add a narration track, use
`--audio ./narration.wav`; the FFmpeg build must also include AAC. Vizmatic pads
or trims audio to the animation duration. Keep `.vtt` or `.srt` captions as
sidecar files and align their cues to the final timeline.

The CLI writes `request-lifecycle_dark.mp4` and `video-manifest.json` under the
output directory. Pass `--theme dark,light` to render both theme variants. Video
rendering runs in Node.js and requires an opaque background. Canvas width and
height after scaling must be even numbers.
