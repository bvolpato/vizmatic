<p align="center">
  <img src="docs/assets/logo.svg" alt="Vizmatic logo" width="460" />
</p>

<p align="center">
  <strong>Theme-aware visuals from structured scenes.</strong><br/>
  Give AI agents typed primitives. Get polished diagrams, figures, dashboards, and slide frames.
</p>

<p align="center">
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/bvolpato/vizmatic/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/vizmatic"><img src="https://img.shields.io/npm/v/vizmatic?color=%2334d058" alt="npm version" /></a>
</p>

<p align="center">
  <img src="docs/assets/examples/agent-pipeline_dark.png" alt="Vizmatic agent visual pipeline" width="760" />
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/">Website</a> ·
  <a href="examples">Examples</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-vizmatic">Why Vizmatic</a> ·
  <a href="#api">API</a>
</p>

---

## Quick Start

```bash
pnpm add vizmatic react
```

Create a frame:

```tsx
import React from "react"
import { defineIllustration, Flow, Scene } from "vizmatic"

export const width = 1040
export const height = 560

const frame = defineIllustration((c) => (
  <Scene c={c} title="Agent visual pipeline">
    <Flow
      c={c}
      stages={[
        { title: "Prompt", subtitle: "intent", tone: "blue" },
        { title: "Scene spec", subtitle: "typed structure", tone: "purple" },
        { title: "PNG / SVG", subtitle: "rendered artifact", tone: "green" },
      ]}
    />
  </Scene>
))

export const create = frame.create
export default frame.default
```

Render it:

```bash
vizmatic render ./frame.tsx --out ./dist/frames --theme dark,light --brand "Acme"
```

Or call the renderer directly:

```ts
import { renderToPng } from "vizmatic"
import { create, width, height } from "./frame"

await renderToPng(create("dark"), {
  width,
  height,
  outputPath: "dist/agent-pipeline.png",
  brand: "Acme",
})
```

## Why Vizmatic

Models can write structure reliably. They are worse at raw SVG path work, fragile coordinate math, and one-off design choices.

Vizmatic gives them a constrained visual language:

| Need | Vizmatic answer |
|---|---|
| Rich educational illustrations | React primitives rendered through Satori and resvg |
| Theme-aware output | Semantic tones and dark/light theme tokens |
| Agent-friendly authoring | JSX scene modules with simple props |
| Reproducible artifacts | Pure Node render path, no browser required |
| Safer generated visuals | Overflow detection, autocrop, wrapping-safe labels |
| Docs and decks | Same frame can become article art, report figure, or presentation slide |

## Gallery

<p>
  <img src="docs/assets/examples/attention-head_dark.png" alt="Attention head" width="380" />
  <img src="docs/assets/examples/rag-graph_dark.png" alt="RAG graph" width="380" />
</p>
<p>
  <img src="docs/assets/examples/eval-dashboard_dark.png" alt="Evaluation dashboard" width="380" />
  <img src="docs/assets/examples/token-matrix_dark.png" alt="Token matrix" width="380" />
</p>
<p>
  <img src="docs/assets/examples/theme-system_dark.png" alt="Theme system" width="380" />
  <img src="docs/assets/examples/presentation-frame_dark.png" alt="Presentation frame" width="380" />
</p>

More examples live in [`examples/`](examples) and on the [website](https://bvolpato.github.io/vizmatic/).

## API

### Themes

```ts
import { getThemeColors } from "vizmatic"

const dark = getThemeColors("dark")
const light = getThemeColors("light")
```

Primitives receive `c`, the resolved theme object. This keeps every visual connected to one palette, typography scale, and contrast model.

### Core primitives

- `Scene`, `Row`, `Column`
- `Panel`, `Card`, `StepCard`, `MetricCard`, `CalloutCard`
- `Flow`, `FlowArrow`, `LayeredNetwork`, `GraphDiagram`
- `Grid`, `DataTable`
- `MiniBarChart`, `BarChart`, `LineChart`, `ScatterPlot`, `QuadrantChart`
- `TextLabel`, `BadgePill`, `ToneStrip`

### Rendering

```ts
import { renderToPng, renderToBuffer, renderToSvg } from "vizmatic"
```

`renderToPng` renders at 2x scale by default, checks for clipped content, crops extra vertical whitespace, and can apply an optional brand mark.

```ts
await renderToPng(element, {
  width: 1040,
  height: 560,
  outputPath: "dist/frame.png",
  brand: "Your Product",
  crop: true,
  scale: 2,
})
```

## Project Layout

```text
src/
  theme.ts        semantic colors, tones, typography
  primitives.ts   reusable scene building blocks
  render.ts       Satori -> SVG -> resvg -> PNG
  autocrop.ts     content bounds and overflow checks
  cli.ts          vizmatic render
examples/
  *.tsx           generated gallery frames
docs/
  index.html      static website for GitHub Pages
```

## Development

```bash
pnpm install
pnpm test
pnpm render:examples
pnpm site:serve
```

## Publishing

```bash
pnpm test
pnpm render:examples
npm publish --access public
```

## License

MIT
