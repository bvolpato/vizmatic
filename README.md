<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/"><img src="https://bvolpato.github.io/vizmatic/assets/logo.svg" alt="Vizmatic" width="360" /></a>
</p>

<p align="center">
  <strong>Explain mechanisms in motion and in print, from TypeScript.</strong><br/>
  Vector films with relational layout, TeX, and local narration that play live in the browser and export frame-exact to MP4.<br/>
  Dense dark and light technical figures from TSX.
</p>

<p align="center">
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/vizmatic"><img src="https://img.shields.io/npm/v/vizmatic?color=%2334d058" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-43853d" alt="Node >= 20" />
  <a href="https://github.com/bvolpato/vizmatic/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/films.html"><img src="https://bvolpato.github.io/vizmatic/assets/films/fourier-epicycles.png" alt="A still from a Vizmatic film: rotating Fourier epicycles trace a curve" width="840" /></a>
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/films.html">Films</a> ·
  <a href="https://bvolpato.github.io/vizmatic/docs/">Docs</a> ·
  <a href="https://bvolpato.github.io/vizmatic/studio.html">Studio</a> ·
  <a href="https://bvolpato.github.io/vizmatic/playground.html">Playground</a> ·
  <a href="https://bvolpato.github.io/vizmatic/components.html">Components</a> ·
  <a href="https://bvolpato.github.io/vizmatic/examples.html">Examples</a> ·
  <a href="https://bvolpato.github.io/vizmatic/agents.html">For agents</a>
</p>

## Quick start: a film in 19 lines

Vizmatic requires Node.js 20 or newer. MP4 and WebM export also require [FFmpeg](https://ffmpeg.org/download.html).

```bash
npm install vizmatic
```

Create `intro.ts`:

```ts
import { axes, column, draw, fadeIn, film, place, sceneKit, tex, write } from 'vizmatic/stage'

export default film({ title: 'A parabola and its equation', font: 'text-serif' }, (s) => {
    const { area, heading, note } = sceneKit()
    const [left, right] = area.columns([2, 1])

    s.add(heading('A parabola and its equation'))
    const plot = place(axes({ x: [-3, 3], y: [-1, 9], width: 1000, height: 640, grid: true, labelSize: 28 }), left)
    const eq = tex('y = x^2', { size: 84 })
    const caption = note('slope doubles with x')
    place(column([eq, caption], { gap: 'normal' }), right)

    s.play(draw(plot.grid, { lag: 0.02 }), draw(plot.lines), fadeIn(plot.numbers))
    s.play(draw(plot.plot((x) => x * x, { stroke: 'blue', width: 5, glow: 6 })))
    s.play(write(eq), fadeIn(caption))
    s.wait(1.5)
})
```

Preview, check, inspect stills, and export:

```bash
npx vizmatic preview intro.ts                              # live browser player with timeline, reloads on save
npx vizmatic check intro.ts --motion                       # static + per-frame collision, blank, and pacing scan
npx vizmatic film intro.ts --every 2 --sheet --out stills  # timestamped contact sheet for visual review
npx vizmatic film intro.ts --look midnight,paper --quality high --out dist
```

Scaffold a working project with `npx vizmatic new intro --template explainer`. Built-in templates are `explainer`, `equation`, `architecture`, `chart`, `deck`, and `narrated`.

<table>
  <tr>
    <td width="50%" align="center">
      <a href="https://bvolpato.github.io/vizmatic/films.html"><img src="https://bvolpato.github.io/vizmatic/assets/films/attention.png" alt="Attention weights computed from real token vectors" /></a><br/>
      <sub><strong>Scaled dot-product attention</strong> · computed weights, TeX, and live readouts</sub>
    </td>
    <td width="50%" align="center">
      <a href="https://bvolpato.github.io/vizmatic/films.html"><img src="https://bvolpato.github.io/vizmatic/assets/films/cache-miss.png" alt="Cache hit and miss latency simulation" /></a><br/>
      <sub><strong>Cache hit vs. database miss</strong> · queueing model, connectors, and system boxes</sub>
    </td>
  </tr>
</table>

## Domain objects on stage

Instead of assembling raw rectangles and coordinates for every explanation, `vizmatic/stage` includes relational layout and domain objects that measure their own labels, animate state transitions, and fail the build with actionable guidance when text does not fit. Run `npx vizmatic objects` to inspect the full catalog:

- **Layout and framing**: `sceneKit`, `sceneArea`, `row`, `column`, `grid`, `place`, `beside`, `between`, `fitted`, `boxOf`, `zone`, `card`, `steps`, `spotlight`, `tagTrack`.
- **Math, plots, and 3D**: `axes` (moving windows, `band`, `marker`), `plane` (`applyMatrix`), `numberLine`, `complexPlane`, `projectionMark`, `vectorField`, `streamLines`, `riemann`, `areaUnder`, `matrix`, `matrixProduct`, `fourier`, `epicycles`, `tex` (`morphMatching`), `scene3d` (`surface`, `parametricSurface`, `curve3d`, `point3d`, `trail3d`).
- **Systems, queues, and code**: `lanes` (actor timelines, child spans, deadlines, outages, boundary crossings), `pipeline` (stage gates, verdicts, counts, eject tray), `requestQueue`, `ringBuffer`, `boundary`, `stateGrid`, `bitField`, `eventLog`, `terminal`, `codeBlock` (including JSON, YAML, TLA+, Dafny, Lean, and SMT), `morphCode`, `connector` (`pulse`, `send`), `infoBox`, `pictogram` (57+ technical icons).
- **Models, data, and prose**: `layerStack`, `tokens`, `attentionMatrix`, `neuralNet`, `heatmap`, `barChart`, `histogram`, `scatter` (cells, hulls, k-NN), `dotChart` (linear or log), `segmentedBar`, `unitChart`, `lineChart`, `pie`, `donut`, `sparkline`, `table`, `passage` (claim marks, source links, diffs, chunking), `quote`, `quotePair`, `dateLine`.

## Narrated lessons and sound

For lessons driven by a voiceover, `--template narrated` creates a self-contained folder with `script.json`, `film.json`, `film.ts`, and `scenes/`. One incremental command synthesizes speech locally, mixes audio, checks layout, and renders the movie:

```bash
npx vizmatic new cache-lesson --template narrated
npx vizmatic narrated build cache-lesson --draft   # local voice, sound mix, layout check, cache-lesson-draft.mp4
npx vizmatic narrated build cache-lesson           # full delivery render with MP4 chapters and captions
```

Scenes lock visual changes directly to spoken phrases through `SceneClock`. If the script changes and a phrase disappears or occurs twice, the build stops with the exact scene and phrase rather than drifting out of sync:

```ts
import { assertEqual, narrated, place, type SceneClock, type Stage } from 'vizmatic/stage'
import timing from './timing.json'
import { claimTag, display, heading, kit, source } from './scenes/kit'

assertEqual(800 / 5, 160, 'speedup matches the spoken claim')

function answer(s: Stage, c: SceneClock) {
    s.add(heading('With a cache in front'), source('Measured on warm hits'))
    claimTag(c, { word: 'MEASURED', note: 'local benchmark' })
    const speedup = place(display('160x faster'), kit.area)
    c.show('one hundred and sixty times', speedup, { after: true })
}

export default narrated({ title: 'Why a cache matters', timing, scenes: { answer } })
```

Verify speech, cues, and sound from the CLI (`npx vizmatic narrated` lists every step):

- `vizmatic narrated beats <folder> --words` prints beat windows and spoken words to pick cues.
- `vizmatic narrated stills <folder>` and `sheet <folder>` render per-beat full-resolution stills and contact sheets.
- `vizmatic narrated transcribe <folder>`, `sync <folder>`, `lag <folder>`, and `probe <folder>` verify TTS pronunciation against `script.json`, measure audio-to-video alignment, and inspect streams, chapters, captions, and file hashes.
- `vizmatic narrated resound <folder>` swaps an updated `narration.wav` into a rendered MP4 without re-rendering frames.
- `vizmatic sounds list`, `vizmatic sounds render <tap|slide|latch|resolve|bell> --out cue.wav`, and `vizmatic sounds bed --voice narration.wav --out bed.wav --palette warm --timing timing.json` generate subtle cues and ducked stereo beds.

Read the [narrated films guide](https://github.com/bvolpato/vizmatic/blob/main/docs/guides/narrated-films.md) for the full workflow.

## Dense figures from TSX

For documentation, papers, architecture reviews, and slides, write TSX with typed components from `vizmatic`. Figures default to the `dense` density (10 to 12 px detail type, hairlines, and tight gutters) and render dark and light PNG and SVG from one source.

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/examples.html">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/data-pipeline-lineage_dark.png" />
      <source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/data-pipeline-lineage_light.png" />
      <img src="https://bvolpato.github.io/vizmatic/assets/examples/data-pipeline-lineage_dark.png" alt="Data pipeline lineage figure rendered from TSX" width="840" />
    </picture>
  </a>
</p>

```tsx
<Scene title="Checkout read path" subtitle="Envoy -> Cart -> Orders replica">
  <Flow
    stages={[
      { title: "Gateway", subtitle: "Envoy, p99 9 ms", tone: "blue" },
      { title: "Cart service", subtitle: "Go, 840 rps", tone: "purple" },
      { title: "Orders DB", subtitle: "Postgres, primary + 3", tone: "green" },
    ]}
  />
</Scene>
```

```bash
npx vizmatic check ./frame.tsx --theme dark,light --json
npx vizmatic render ./frame.tsx --out ./figures --theme dark,light --format both
```

- Omit `width` and `height` while iterating: bare `.tsx` frames start at `960x540` and auto-grow to fit content.
- Outputs are alpha-transparent by default; pass `--background theme` (or `background={c.bg}`) for an opaque canvas, and `preset = "engineering";` with `--theme light` for flat technical paper figures.
- Switch to `density="presentation"` (or `--density presentation`) when placing the same scene on a slide.
- Convert existing Mermaid or D2 diagrams into `GraphDiagram` props with `importMermaid` and `importD2`, or animate existing TSX figures to GIF and MP4 with `defineAnimation` (`vizmatic gif` and `vizmatic video`).

Browse the [component catalog](https://bvolpato.github.io/vizmatic/components.html), [examples gallery](https://bvolpato.github.io/vizmatic/examples.html), and [interactive playground](https://bvolpato.github.io/vizmatic/playground.html).

## What makes Vizmatic different

- **Real geometry on stage.** Lines, glyphs, TeX equations, and grids are Bezier paths. Any path can draw itself, morph into another shape, or bend through a function, and `morphMatching` carries shared terms cleanly across steps of a derivation.
- **Pure function of time.** A film compiles once into a deterministic timeline that can be sampled at any timestamp in any order. Scrubbing is instant, identical frames share buffers automatically, and worker threads rasterize in parallel with optional motion blur and dithered bloom.
- **Five looks and two figure themes.** Films author against semantic tokens (`blue`, `teal`, `yellow`, `ink`, `dim`) and render across `midnight`, `paper`, `blueprint`, `chalk`, and `neon`. TSX figures render coordinated `dark` and `light` palettes.
- **Defects reported as structured data.** `vizmatic check --json` and `vizmatic check --motion --json` return clipped text, edge crowding (`--text-gap`), phone-unreadable type (`--text-size`), empty regions (`--empty-space`), strokes crossing text, brief flashes, and blank gaps with exact timestamps and bounding boxes.
- **Live web playback, visual Studio, and QuickJS sandboxing.** Embed live, seekable films anywhere with `<vz-film>` (including `<vz-film stepped>` for chapter decks), edit visually in [Studio](https://bvolpato.github.io/vizmatic/studio.html), or evaluate untrusted bare TSX inside a deterministic offline QuickJS sandbox via `vizmatic/scene-runtime` and `vizmatic-scene`.

## CLI at a glance

| Command | Purpose |
|---|---|
| `vizmatic new <name> [--template ...]` | Scaffold a film (`explainer`, `equation`, `architecture`, `chart`, `deck`, or `narrated`) |
| `vizmatic preview <file> [--port <n>] [--open]` | Live browser player with timeline scrubbing and hot reload |
| `vizmatic check <file-or-dir...> [--motion] [--json]` | Check films (`--motion`, `--text-gap`, `--text-size`, `--empty-space`, `--stepped`) or TSX frames (`--theme dark,light`) |
| `vizmatic film <file...> [--out <dir>]` | Export MP4, WebM, GIF, PNG stills (`--frame`, `--every`, `--sheet`), SVG, posters, captions, and chapters |
| `vizmatic narrated <step> <folder>` | Build, voice, mix, check, stills, sheet, beats, transcribe, sync, lag, probe, or resound narrated lessons |
| `vizmatic objects [--json]` / `vizmatic looks [--json]` | List stage domain objects and color looks |
| `vizmatic sounds <list\|render\|bed>` | List or synthesize sound effects and ducked stereo ambient beds |
| `vizmatic [render] <file-or-dir...>` | Render TSX figures to dark/light PNG and SVG (`--density`, `--background`, `--format png\|svg\|both`) |
| `vizmatic gif <file...>` / `vizmatic video <file...>` | Render animated TSX timelines (`createAnimation`) to GIF or MP4 |
| `vizmatic-scene --input req.json --output out.png\|out.mp4` | Render untrusted bare TSX inside the bounded QuickJS scene sandbox |

## Checked teaching helpers

For custom hosts and verified mechanism animations, Vizmatic exports pure state calculators (`vizmatic`), audio hold tools (`vizmatic/stage/export`), and `createTeachingCanvas(painter)` methods so displayed numbers and geometry come from one checked calculation:

| Helper / canvas component | Purpose and worked example |
|---|---|
| `weightedVectorState` / `vectorAccumulation` | [Retain momentum, add an opposing gradient, then reveal the resultant](examples/_teaching/teaching-weighted-vector.ts) |
| `categoricalSampling` | [Map supplied uniform draws through a CDF and watch tail loss](examples/_teaching/categorical-tail-loss.ts) |
| `planTeachingRoutedTransfer` / `routedTransfer` | [Route orthogonal value transfers around declared obstacles](examples/_teaching/teaching-routed-transfer.ts) |
| `byteDifferenceState` / `byteDifference` | [Locate changed bytes with stable offsets and escaped control bytes](examples/_teaching/teaching-byte-diff.ts) |
| `tokenHistoryState` / `tokenHistory` | [Drop and rebuild KV cache while preserving accepted and emitted tokens](examples/_teaching/teaching-token-history.ts) |
| `pcmEnvelope` / `waveform`, `renderNarrationHold` | Time-synced PCM waveform envelopes with cursors, plus 48 kHz speech-and-demo audio holds |
| `layoutCellGrid` / `tileTransfer`, `rasterWipe`, `planSampleCopies` | Checked grid addressing, row-staggered tile transfers, raster wipes, and sample-copy trajectories |
| `softmaxTileMass`, `combineSoftmaxMass`, `traceCrossCorrelation2d` | Online/tiled softmax mass summaries and 2D kernel cross-correlation traces |
| `createCueTrack`, `assertCueReveal` | Hold discrete snapshots across cues and verify answers never appear before their spoken phrase |

See the [canvas and TSX animation guide](https://bvolpato.github.io/vizmatic/docs/tsx-animation.html) for the painter contract and scope rules.

## For coding agents

Install the bundled skill for Codex, Claude Code, Gemini CLI, Cursor, or OpenCode. It teaches output selection, relational stage layout, narrated film workflows, TSX figure density, and check loops:

```bash
npx skills add bvolpato/vizmatic --skill vizmatic -g -y
```

Agents can also read [`llms.txt`](https://bvolpato.github.io/vizmatic/llms.txt) and [`PROMPT.md`](PROMPT.md), or query `npx vizmatic objects --json` and `npx vizmatic looks --json` for the exact capabilities of the installed package.

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](https://bvolpato.github.io/vizmatic/docs/) | First film, preview, check, and export in two minutes |
| [Core concepts](https://bvolpato.github.io/vizmatic/docs/concepts.html) | Stage coordinates, pure timelines, and looks |
| [Layout](https://github.com/bvolpato/vizmatic/blob/main/docs/guides/layout.md) | Relational placement with `sceneKit`, `row`, `column`, `grid`, `place`, `beside`, and `fitted` |
| [Objects](https://bvolpato.github.io/vizmatic/docs/objects.html) | Math, plots, systems, queues, code, ML, prose, and 3D objects |
| [Narrated films](https://github.com/bvolpato/vizmatic/blob/main/docs/guides/narrated-films.md) | Script format, local TTS, `SceneClock`, motion checks, and delivery review |
| [Looks](https://bvolpato.github.io/vizmatic/docs/looks.html) | Semantic pigments and rendering across `midnight`, `paper`, `blueprint`, `chalk`, and `neon` |
| [CLI](https://bvolpato.github.io/vizmatic/docs/cli.html) and [Exporting](https://bvolpato.github.io/vizmatic/docs/exporting.html) | Every command, format, quality preset, sheet, and manifest |
| [Embedding](https://bvolpato.github.io/vizmatic/docs/embedding.html) and [Presentations](https://bvolpato.github.io/vizmatic/docs/presentations.html) | Live `<vz-film>` web player and chapter-stepped slide decks |
| [Diagrams and density](https://bvolpato.github.io/vizmatic/docs/diagrams.html) and [Figures](https://bvolpato.github.io/vizmatic/docs/figures.html) | Typed TSX components, themes, and engineering paper figures |
| [Editable scenes](https://bvolpato.github.io/vizmatic/docs/editable-scenes.html) | Evaluating untrusted TSX in a bounded QuickJS sandbox |
| [TSX animation](https://bvolpato.github.io/vizmatic/docs/tsx-animation.html) | Typed TSX timelines and checked teaching canvas hosts |
| [Science guide](SCIENCE.md) | Accurate math, physics, chemistry, and ML diagrams |
| [Roadmap](ROADMAP.md) and [Contributing](https://github.com/bvolpato/vizmatic/blob/main/CONTRIBUTING.md) | Shipped milestones, repository checks, and release workflow |

## Requirements and installation

- **Node.js 20+** is required for all commands. Vizmatic bundles its tested Satori renderer, self-hosted fonts, and Twemoji vector subset with no dependency overrides required.
- **FFmpeg** (`libx264`, `libvpx-vp9`, `aac`) is required on `PATH` for MP4, WebM, and audio muxing. PNG, SVG, and GIF exports run without FFmpeg.
- **`uv`** is required on `PATH` only when running local speech synthesis, transcription, or sound-bed tools (`vizmatic narrated`, `vizmatic sounds`).

For **pnpm 11**, allow esbuild's install script in the root `pnpm-workspace.yaml` so the CLI can compile films and frames:

```yaml
allowBuilds:
  esbuild: true
```

## License

MIT. Bundled fonts and third-party assets retain their own licenses; see [`assets/THIRD_PARTY_LICENSES.md`](assets/THIRD_PARTY_LICENSES.md).
