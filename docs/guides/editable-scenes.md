---
title: Editable scenes
nav: Editable scenes
section: Reference
order: 3
description: Run editable TSX from users or agents in a bounded sandbox, and render it to PNG or MP4 in an application.
---

Use `vizmatic-scene` when an application stores editable TSX from a user or an
agent. The regular `vizmatic` CLI loads trusted Node modules; it is not the entry
point for running editable source inside an application.

```bash
vizmatic-scene --input examples/pressure-mechanism.scene.json --output pressure.mp4
```

The JSON request contains `source`, `width`, `height`, `duration`, optional `fps`
(24 by default), `theme`, `cues`, `seed`, and optional preview `time`. All times
are **seconds**. Output is PNG for an exact preview time or a silent H.264 MP4.
FFmpeg must be on PATH for MP4. Narration, captions and final assembly remain the
calling application's responsibility.

```typescript
import { renderSceneFrame, renderSceneVideo } from 'vizmatic'

const scene = {
    width: 1920, height: 1080, duration: 12, fps: 24, theme: 'dark' as const,
    cues: { reveal: 3.2 }, seed: 0,
    source: `const amount = ease(cue('reveal', 2));
<svg width={width} height={height}>
    <rect width={width} height={height} fill={c.bg}/>
    <circle cx={lerp(300, 1600, amount)} cy={540} r={70} fill={c.info}/>
    <text x={150} y={200} fontSize={64} fill={c.textPrimary}>Follow the mechanism</text>
</svg>`,
}
await renderSceneFrame({ ...scene, time: 4, outputPath: './preview.png' })
await renderSceneVideo({ ...scene, outputPath: './scene.mp4' })
```

For editor previews, add `outputScale: 0.5` to either renderer and
`previewFps: 12` to `renderSceneVideo`. The renderer still evaluates and lays out
the original logical `width`, `height`, `duration`, `fps`, `frame`, and cues; it
only rasterizes fewer pixels and samples fewer video frames. `outputScale` must
be from 0.25 to 1 and produce even integer dimensions. `previewFps` must be an
integer from 1 to the scene's logical fps. These options also work in the
`vizmatic-scene` JSON request (`previewFps` is MP4-only).

Preview metadata reports effective `width`, `height`, `fps`, and `frameCount`,
plus `logicalWidth`, `logicalHeight`, `logicalFps`, `logicalFrameCount`,
`outputScale`, and, for video, `previewFps`. Its input hash binds the effective
output settings. Omitting the options preserves full-quality rendering and its
existing input hash.

Source uses local JavaScript/TypeScript declarations and helper components followed
by one JSX root. Imports, exports and module wrappers are not supported. Vizmatic
JSX primitives are provided automatically. SVG geometry and `<text>`/`<tspan>` use
the bundled fonts through Resvg, including inside HTML layouts. `Scene`, `Board`,
`CanvasItem`, charts and other trusted Vizmatic components use the same rendering
path in previews and video frames. Function-valued props are unsupported; calculate
formatted values and geometry in the source before returning JSX.

| Source value | Meaning |
| --- | --- |
| `width`, `height` | Logical canvas dimensions before optional preview scaling |
| `time` / `t`, `duration` | Current position and narration duration in seconds |
| `progress`, `frame`, `fps` | Normalized progress, zero-based frame and cadence |
| `theme`, `c` | Theme name and frozen Vizmatic theme colors |
| `cues` | Named narration cue positions in seconds |
| `seed`, `Math.random()` | Explicit uint32 seed and deterministic random sequence |
| `clamp(x, min=0, max=1)`, `lerp(a,b,p)` | Clamp and linear interpolation |
| `ease(p)`, `easeInOut(p)`, `easeOut(p)` | Clamped smoothstep and cubic ease-out |
| `cue(name, span=1)` | Progress from a named cue over a span in seconds |

A missing named cue fails preparation rather than inventing a timing. Applications
should resolve production cues against actual narration and label estimated preview
cues as estimates. Source can be evaluated without Node rendering through
`evaluateSceneSource` or `prepareScene` from `vizmatic/scene-runtime`, suitable for
a browser Worker. The same evaluator produces a validated JSON scene graph in both
environments.

### Realtime browser previews

Use `vizmatic/scene-browser` in a dedicated module Worker for local editing,
scrubbing and playback. It uses the same bounded QuickJS evaluator, fonts, trusted
components and Resvg rasterizer as the Node scene renderer. Both native SVG and
Vizmatic layouts are supported. Compile once per source revision and render each
new time locally; a full MP4 or HTTP request is not required for playback.

```typescript
// Inside a dedicated Worker. The application fetches these assets from its own origin.
import { createBrowserSceneRenderer } from 'vizmatic/scene-browser'

const renderer = await createBrowserSceneRenderer({
    quickjsWasm, resvgWasm,
    layoutWasm: () => loadLayoutWasm(),
    fonts: { interRegular, interSemiBold, interBold, jetBrainsMono, notoSans, notoSansMath },
    emoji: () => loadOfflineEmoji(), // Optional, loaded only for an emoji glyph.
})
const prepared = await renderer.prepare(scene, { outputScale: 0.5 })
const frame = await prepared.render(4)
postMessage(frame, [frame.pixels.buffer])
```

The three WASM inputs and six font inputs are `ArrayBuffer`s. `layoutWasm` also
accepts a loader, so native SVG previews never load Satori's chunk or layout WASM.
Their hashes are checked before initialization, and initialization is reused. The
optional emoji loader returns the parsed pinned emoji JSON; it is checked and
cached on first use. Satori's standalone build embeds its HarfBuzz runtime.

At application build time, `getSceneBrowserAssetPaths()` from
`vizmatic/browser-assets` resolves `quickjsWasm`, `layoutWasm`, `resvgWasm`,
`fonts`, and `emojiBrotli` to installed local files. Copy them to your static assets;
decompress the emoji Brotli file at build time if the browser does not support
Brotli streams. The browser entry is prebundled ESM and requires no Node shims or
special file loaders. Keep it out of the initial application bundle and load its
Worker when a preview becomes visible. Keep ESM code splitting enabled in your
application's Worker build to preserve the deferred Satori download.

Frames contain owned, transferable RGBA `pixels`, effective `width` and `height`,
`time`, source and input hashes, runtime version, and `timings` in milliseconds.
Draw them with `ImageData` on a canvas. A single unchanged graph retains one backing
raster while each caller receives an independent pixel buffer. Logical scene
dimensions, fps, cues and frame globals remain unchanged by `outputScale`.

Keep only the latest queued frame, stop playback when hidden, and terminate the
Worker on an application deadline or when its editor closes. QuickJS limits author
execution; the Worker deadline also bounds trusted layout and rasterization. Keep
narration alignment and final export validation in the application's server path.
`pnpm check:scene-browser` checks real Chromium Worker rendering against Node pixels,
isolation, error recovery and playback without network requests.

Editable JavaScript executes inside QuickJS WebAssembly with no host objects,
callbacks, filesystem, network, browser storage or module loader. Each frame gets
a fresh context, a 64 MiB guest memory limit, a 256 KiB stack and a 250 ms evaluation
deadline. Only bounded JSON reaches trusted components. External image references,
resource URLs, event handlers, raw HTML and executable props are rejected. The
renderer uses fingerprinted package fonts and emoji assets, with no environment
overrides, system fonts or network fallback. Local SVG fragment references work.

Limits are 128 KiB of source, 2 MiB of serialized graph, 2,000 JSX elements, 64
levels of nesting, at most 1,920 pixels per edge and 2,073,600 pixels per canvas,
120 seconds per scene, 1–60 fps and 3,600 frames. Nested SVGs also share a per-frame
allocation budget. Run the CLI in a subprocess with a bounded environment, captured
stderr, memory limit and total deadline; the QuickJS deadline governs author code,
while the caller's process deadline also covers trusted layout and FFmpeg.

The CLI writes one JSON metadata line on success. `runtimeVersion`,
`sourceSha256`, `inputSha256`, `assetSha256`, `fontAssetsSha256`, dimensions,
duration, fps, timeline `frameCount`, output byte count and output path identify the
result. `assetSha256` hashes the actual output file. Preview metadata adds `time`;
MP4 adds `encodedDuration`. Cache inputs include the runtime, exact source, cues,
seed, theme, dimensions, duration, cadence, pinned assets, output kind and preview
time. Like the existing video API, MP4 duration rounds to the nearest frame.
Existing output files survive a failed render.
