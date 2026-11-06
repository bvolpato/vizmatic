<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/"><img src="https://bvolpato.github.io/vizmatic/assets/logo.svg" alt="Vizmatic" width="360" /></a>
</p>

<p align="center">
  <strong>Explain things in motion, from code.</strong><br/>
  Vector films that play live in a browser and export frame-exact to MP4. Dense technical figures from TSX.
</p>

<p align="center">
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/vizmatic"><img src="https://img.shields.io/npm/v/vizmatic?color=%2334d058" alt="npm version" /></a>
  <a href="https://github.com/bvolpato/vizmatic/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/films.html"><img src="https://bvolpato.github.io/vizmatic/assets/films/fourier-epicycles.png" alt="A still from a Vizmatic film: rotating circles trace a curve" width="820" /></a>
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/films.html">Films</a> ·
  <a href="https://bvolpato.github.io/vizmatic/docs/">Docs</a> ·
  <a href="https://bvolpato.github.io/vizmatic/studio.html">Studio</a> ·
  <a href="https://bvolpato.github.io/vizmatic/components.html">Components</a> ·
  <a href="https://bvolpato.github.io/vizmatic/agents.html">For agents</a>
</p>

## A film in 15 lines

Vizmatic needs Node.js 20 or newer. MP4 export also needs [FFmpeg](https://ffmpeg.org/download.html).

```bash
npm install vizmatic
```

Create `intro.ts`:

```ts
import { axes, draw, fadeIn, film, tex, write } from 'vizmatic/stage'

export default film({ title: 'My first film' }, (s) => {
    const plot = s.add(axes({ x: [-3, 3], y: [-1, 9], grid: true }).at(-240, 40))
    s.play(draw(plot.grid, { lag: 0.02 }), draw(plot.lines), fadeIn(plot.numbers))
    s.play(draw(plot.plot((x) => x * x, { stroke: 'blue', width: 5 })))
    s.play(write(s.add(tex('y = x^2', { size: 72 }).at(600, -200))))
    s.wait(1)
})
```

Then watch it, check it, and export it:

```bash
npx vizmatic preview intro.ts           # live player with a timeline. Reloads when you save.
npx vizmatic check intro.ts             # finds clipped text, overlaps, and strokes through labels
npx vizmatic film intro.ts --out dist   # 1080p60 MP4
```

`npx vizmatic new intro --template architecture` starts from a working film. The templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`.

## What makes it different

**Everything on stage is real geometry.** Lines, glyphs, equations, and grids are all Bezier paths. Any shape can trace itself, morph into any other shape, or bend through a function. Equations use TeX glyphs, and `morphMatching` moves the shared terms from one line of a derivation to the next.

**A film is a pure function of time.** The build function runs once and writes a timeline. Any frame can then be sampled at any time, in any order. Scrubbing is instant, and identical input gives identical frames.

**One film, two destinations.** The same source paints live on a canvas with `<vz-film>`, and renders to MP4, WebM, GIF, PNG, or SVG in Node. Frames rasterize on worker threads, with real motion blur and bloom when you ask for them.

**It looks right by default.** Five looks set the background, ink, pigments, and light. Authors write `color: 'yellow'`, so one film renders in `midnight`, `paper`, `blueprint`, `chalk`, and `neon`.

**Figures pack information.** The TSX components default to the `dense` density: small type, hairlines, and tight gutters, like a figure in a good engineering paper. Set `density="presentation"` to use the same source on a slide.

**Defects come back as data.** `vizmatic check --json` reports problems with their times and bounding boxes, so a coding agent can find and fix them without watching anything.

## Figures

Render a TSX figure in each theme:

```tsx
<Scene title="Checkout, read path">
  <Flow
    stages={[
      { title: "Gateway", subtitle: "Envoy, p99 9 ms", tone: "blue" },
      { title: "Cart", subtitle: "Go, 840 rps", tone: "purple" },
      { title: "Orders DB", subtitle: "Postgres, primary + 3", tone: "green" },
    ]}
  />
</Scene>
```

```bash
npx vizmatic ./frame.tsx --out ./figures --theme dark,light --format both
```

Read [Diagrams and density](https://bvolpato.github.io/vizmatic/docs/diagrams.html) and the [figures reference](https://bvolpato.github.io/vizmatic/docs/figures.html), or browse the [component catalog](https://bvolpato.github.io/vizmatic/components.html).

## Teaching with a checked canvas

`createTeachingCanvas(painter)` composes animated explanations through your host's checked drawing methods. Its components return computed state so labels and geometry follow the same calculation. Bind progress and answer reveals separately to the narration.

| Component | A worked example |
|---|---|
| `vectorAccumulation` | [Retain momentum, add an opposing gradient, then reveal the resultant](examples/_teaching/teaching-weighted-vector.ts) |
| `categoricalSampling` | [Watch a rare category disappear from a supplied finite sample](examples/_teaching/categorical-tail-loss.ts) |
| `routedTransfer` | [Carry a value around visible obstacles](examples/_teaching/teaching-routed-transfer.ts) |
| `byteDifference` | [Locate a changed byte while retaining offsets and escaped control characters](examples/_teaching/teaching-byte-diff.ts) |
| `tokenHistory` | [Drop and rebuild KV while preserving accepted and emitted tokens](examples/_teaching/teaching-token-history.ts) |

Each example supplies its own data and timing. Inspect prediction frames, moving states, and settled results at the delivery resolution. The [canvas guide](https://bvolpato.github.io/vizmatic/docs/tsx-animation.html) describes the painter contract and component limits.

## For coding agents

Install the skill. It teaches the engine, the object catalog, and the check workflow.

```bash
npx skills add bvolpato/vizmatic --skill vizmatic -g -y
```

Agents can also read [`llms.txt`](https://bvolpato.github.io/vizmatic/llms.txt), and `vizmatic objects --json` and `vizmatic looks --json` list what the installed version offers.

## Documentation

| Read this | For |
|---|---|
| [Getting started](https://bvolpato.github.io/vizmatic/docs/) | Your first film, in two minutes |
| [Core concepts](https://bvolpato.github.io/vizmatic/docs/concepts.html) | The stage, the timeline, and why frames are pure |
| [Objects](https://bvolpato.github.io/vizmatic/docs/objects.html) | Axes, planes, charts, graphs, code, and 3D |
| [CLI](https://bvolpato.github.io/vizmatic/docs/cli.html) and [Exporting](https://bvolpato.github.io/vizmatic/docs/exporting.html) | Every command, format, and quality level |
| [Embedding](https://bvolpato.github.io/vizmatic/docs/embedding.html) | A live, seekable film in any page |
| [Editable scenes](https://bvolpato.github.io/vizmatic/docs/editable-scenes.html) | Running untrusted TSX in a bounded sandbox |
| [TSX animation](https://bvolpato.github.io/vizmatic/docs/tsx-animation.html) | Animating an existing figure with typed timelines |
| [Science guide](SCIENCE.md) | Accurate diagrams for math, physics, chemistry, and machine learning |
| [Roadmap](ROADMAP.md) | What shipped and what comes next |
| [Contributing](CONTRIBUTING.md) | Setup, checks, and the release process |

## Package installation

Vizmatic 0.7.0 bundles its tested Satori renderer and uses patched `fflate` 0.7.5. Consumer dependency overrides are no longer required.

For pnpm 11, allow esbuild's install script in the root `pnpm-workspace.yaml`. The CLI uses esbuild to compile films and frames:

```yaml
allowBuilds:
  esbuild: true
```

Then add Vizmatic with your package manager.

## License

MIT. Bundled fonts and other third-party assets keep their own licenses. See [`assets/THIRD_PARTY_LICENSES.md`](assets/THIRD_PARTY_LICENSES.md).
