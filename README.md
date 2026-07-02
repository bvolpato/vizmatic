<p align="center">
  <img src="docs/assets/logo.svg" alt="Vizmatic logo" width="460" />
</p>

<p align="center">
  <strong>Theme-aware visuals from structured scenes.</strong><br/>
  Give AI agents typed primitives. Get polished diagrams, figures, dashboards, slide frames, and animated GIFs.
</p>

<p align="center">
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/pages.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/pages.yml/badge.svg" alt="Pages" /></a>
  <a href="https://github.com/bvolpato/vizmatic/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/vizmatic"><img src="https://img.shields.io/npm/v/vizmatic?color=%2334d058" alt="npm version" /></a>
</p>

<p align="center">
  <img src="docs/assets/examples/animated-pipeline_dark.gif" alt="Vizmatic animated render pipeline" width="760" />
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/">Website</a> ·
  <a href="examples">Examples</a> ·
  <a href="PROMPT.md">Agent Prompt</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#why-vizmatic">Why Vizmatic</a> ·
  <a href="#api">API</a>
</p>

---

## Quick Start

```bash
pnpm add vizmatic react
```

Optional edge build from GitHub:

```bash
pnpm add github:bvolpato/vizmatic react
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
        { title: "PNG / SVG / GIF", subtitle: "rendered artifact", tone: "green" },
      ]}
    />
  </Scene>
))

export const create = frame.create
export default frame.default
```

Render it:

```bash
vizmatic render ./frame.tsx --out ./dist/frames --theme dark,light --watermark "Acme" --watermark-image ./logo.svg
```

Render an animation:

```bash
vizmatic gif ./animated-frame.tsx --out ./dist/frames --theme dark,light --watermark "Acme" --watermark-image ./logo.svg
```

Or call the renderer directly:

```ts
import { renderToPng } from "vizmatic"
import { create, width, height } from "./frame"

await renderToPng(create("dark"), {
  width,
  height,
  outputPath: "dist/agent-pipeline.png",
  watermark: { text: "Acme", image: "data:image/svg+xml;base64,...", position: "top-right" },
})
```

Code-owned watermark:

```tsx
import { Watermark } from "vizmatic"

export const watermark = (
  <Watermark position="bottom-right" opacity={0.82}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#7c3aed", fontWeight: 800 }}>
      <img src="data:image/svg+xml;base64,..." width={14} height={14} />
      Acme
    </div>
  </Watermark>
)
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
| Animated explainers | GIF export from ordered scene states |
| Docs and decks | Same frame can become article art, report figure, or presentation slide |

## Gallery

<p>
  <img src="docs/assets/examples/animated-pipeline_dark.gif" alt="Animated pipeline" width="380" />
  <img src="docs/assets/examples/attention-head_dark.png" alt="Attention head" width="380" />
</p>
<p>
  <img src="docs/assets/examples/rag-graph_dark.png" alt="RAG graph" width="380" />
  <img src="docs/assets/examples/eval-dashboard_dark.png" alt="Evaluation dashboard" width="380" />
</p>
<p>
  <img src="docs/assets/examples/token-matrix_dark.png" alt="Token matrix" width="380" />
  <img src="docs/assets/examples/theme-system_dark.png" alt="Theme system" width="380" />
</p>
<p>
  <img src="docs/assets/examples/presentation-frame_dark.png" alt="Presentation frame" width="380" />
</p>

More examples live in [`examples/`](examples) and on the [website](https://bvolpato.github.io/vizmatic/).

## Copy-Paste Examples

### Minimal flow

Use this for small docs snippets and quick agent-generated frames.

```tsx
import { defineIllustration, Flow, Scene } from "vizmatic"

export const width = 1040
export const height = 560

const frame = defineIllustration((c) =>
  <Scene c={c} title="Agent pipeline">
    <Flow c={c} stages={[
      { title: "Prompt", tone: "blue" },
      { title: "Scene spec", tone: "purple" },
      { title: "PNG / GIF", tone: "green" },
    ]} />
  </Scene>
)

export const create = frame.create
export default frame.default
```

### Flow + callouts

Use this for process diagrams, architecture walkthroughs, and agent pipelines.

```tsx
import React from "react"
import { CalloutCard, defineIllustration, Flow, Row, Scene } from "vizmatic"

export const width = 1040
export const height = 560

const frame = defineIllustration((c) => (
  <Scene c={c} title="Agent visual pipeline" subtitle="prompt -> scene spec -> verified artifact" gap={26}>
    <Flow
      c={c}
      connectorTone="purple"
      stages={[
        { eyebrow: "input", title: "Prompt", subtitle: "intent", tone: "blue", lines: ["goal", "audience", "constraints"], width: 190 },
        { eyebrow: "contract", title: "Scene spec", subtitle: "typed structure", tone: "purple", lines: ["cards", "flows", "charts"], width: 190 },
        { eyebrow: "render", title: "Satori", subtitle: "React primitives", tone: "cyan", lines: ["layout", "theme", "safe text"], width: 190 },
        { eyebrow: "output", title: "PNG / GIF", subtitle: "verified asset", tone: "green", lines: ["autocrop", "overflow checks"], width: 190 },
      ]}
    />
    <Row width="100%" gap={14}>
      <CalloutCard c={c} title="Model writes structure" detail="No hand-written SVG paths." tone="purple" width={470} />
      <CalloutCard c={c} title="Theme stays in control" detail="Colors and typography come from tokens." tone="green" width={470} />
    </Row>
  </Scene>
))

export const create = frame.create
export default frame.default
```

### Animated GIF

Use this for state changes, product flows, lesson steps, and timelines. Static frames export `create(theme)`. Animated frames also export `createScenes(theme)`.

```tsx
import React from "react"
import {
  CalloutCard,
  defineIllustration,
  Flow,
  Scene,
  getThemeColors,
  type AnimatedScene,
  type ThemeColors,
  type ThemeMode,
} from "vizmatic"

export const width = 1040
export const height = 560

const stages = [
  { title: "Prompt", tone: "blue" as const },
  { title: "Scene spec", tone: "purple" as const },
  { title: "PNG / GIF", tone: "green" as const },
]

function buildFrame(c: ThemeColors, active: number) {
  return (
    <Scene c={c} title="Animated agent pipeline">
      <Flow
        c={c}
        stages={stages.map((stage, index) => ({
          ...stage,
          title: index <= active ? stage.title : "Pending",
          tone: index <= active ? stage.tone : "neutral",
        }))}
      />
      <CalloutCard c={c} title="Scene changes over time" detail="Render with vizmatic gif." tone="green" />
    </Scene>
  )
}

const frame = defineIllustration((c) => buildFrame(c, stages.length - 1))

export function createScenes(theme: ThemeMode): AnimatedScene[] {
  const c = getThemeColors(theme)
  return stages.map((_, index) => ({
    element: buildFrame(c, index),
    duration: index === stages.length - 1 ? 1000 : 700,
    transition: index === 0 ? "appear" : "fade",
  }))
}

export const create = frame.create
export default frame.default
```

```bash
vizmatic gif ./animated-frame.tsx --out ./dist/frames --theme dark,light --watermark "Acme" --watermark-image ./logo.svg --scale 1
```

### RAG graph

Use this for workflows with branches, retries, and validation loops.

```tsx
import React from "react"
import { defineIllustration, GraphDiagram, Scene } from "vizmatic"

export const width = 1040
export const height = 560

const frame = defineIllustration((c) => (
  <Scene c={c} title="RAG control graph" subtitle="retrieval is a graph, not a prompt append" align="center">
    <GraphDiagram
      c={c}
      width={820}
      height={390}
      nodes={[
        { id: "query", label: "Query", detail: "intent", x: 0.08, y: 0.52, tone: "blue" },
        { id: "retrieve", label: "Retrieve", detail: "top-k docs", x: 0.40, y: 0.25, tone: "cyan" },
        { id: "rerank", label: "Rerank", detail: "quality gate", x: 0.68, y: 0.25, tone: "warm" },
        { id: "answer", label: "Answer", detail: "grounded draft", x: 0.92, y: 0.52, tone: "green" },
        { id: "verify", label: "Verify", detail: "citations", x: 0.52, y: 0.78, tone: "critical" },
      ]}
      edges={[
        { from: "query", to: "retrieve", label: "search", tone: "blue" },
        { from: "retrieve", to: "rerank", label: "rank", tone: "cyan" },
        { from: "rerank", to: "answer", label: "context", tone: "green" },
        { from: "answer", to: "verify", label: "claims", tone: "critical" },
        { from: "verify", to: "retrieve", label: "retry", dashed: true, tone: "warm" },
      ]}
    />
  </Scene>
))

export const create = frame.create
export default frame.default
```

### Evaluation dashboard

Use this for compact report figures and release decks.

```tsx
import React from "react"
import { BarChart, defineIllustration, LineChart, Row, Scene } from "vizmatic"

export const width = 1040
export const height = 620

const frame = defineIllustration((c) => (
  <Scene c={c} title="Evaluation snapshot" subtitle="charts inherit theme, labels, and contrast">
    <Row gap={18} align="stretch">
      <BarChart
        c={c}
        width={440}
        height={260}
        title="Pass rate by task"
        format="percent"
        data={[
          { label: "tools", value: 0.82, color: "positive" },
          { label: "math", value: 0.71, color: "secondary" },
          { label: "code", value: 0.77, color: "primary" },
          { label: "long", value: 0.58, color: "warning" },
        ]}
      />
      <LineChart
        c={c}
        width={440}
        height={260}
        title="Quality over releases"
        format="percent"
        labels={["v1", "v2", "v3", "v4", "v5"]}
        series={[
          { name: "quality", points: [0.55, 0.61, 0.69, 0.74, 0.81], color: "positive", area: true },
          { name: "latency", points: [0.72, 0.69, 0.66, 0.62, 0.59], color: "warning" },
        ]}
      />
    </Row>
  </Scene>
))

export const create = frame.create
export default frame.default
```

## Agent Prompt

[`PROMPT.md`](PROMPT.md) is a plug-and-play instruction file for coding agents. It covers install, frame structure, every visual component with props, render commands, examples, quality rules, and final verification.

## Quality Gates

Vizmatic treats generated visuals as source-controlled build artifacts. CI fails if examples, site assets, source snippets, or prompt copies drift from the repo source.

| Gate | What it protects |
|---|---|
| `pnpm typecheck` | Type safety across `src/`, `examples/`, `scripts/`, and tests |
| `pnpm test` | Render pipeline behavior, watermark options, and output validation |
| `pnpm render:examples` | Dark/light PNGs, animated GIFs, source snippets, and website HTML |
| `pnpm docs:check` | Local asset references, `PROMPT.md` sync, source modal themes, and homepage affordances |
| `pnpm security:audit` | Fails on known low-or-higher npm advisories |
| `npm pack --dry-run` | Published package contents before release |
| CI generated-file check | Ensures rendered docs/examples are committed |

Run the full local gate:

```bash
pnpm verify
git diff --exit-code
```

## Supply Chain Posture

Vizmatic keeps runtime dependencies narrow: `satori` for JSX layout, `@resvg/resvg-js` for rasterization, `gifenc` for animated GIF output, and `tsx` so the CLI can load TSX scene files directly.

Package resolution is intentionally conservative:

- `minimumReleaseAge: 10080` requires timestamped package releases to age seven days before pnpm can select them.
- `strictPeerDependencies`, `engineStrict`, and `packageManagerStrict` make install drift fail loudly.
- `overrides.esbuild: 0.28.1` keeps the build graph on the patched esbuild line used by `tsx` and `tsup`.
- `pnpm security:audit` runs inside `pnpm verify`, `prepublishOnly`, and CI.

## API

### Themes

```ts
import { getThemeColors } from "vizmatic"

const dark = getThemeColors("dark")
const light = getThemeColors("light")
```

Primitives receive `c`, the resolved theme object. This keeps every visual connected to one palette, typography scale, and contrast model.

### Component catalog

Vizmatic exports a fairly complete visual kit. Common cases should use these primitives before dropping to raw SVG or absolute positioning.

#### Frame and layout

| Component | Use |
|---|---|
| `defineIllustration` | Wraps a theme-aware frame builder and exports `create(theme)` plus a default element. |
| `Canvas` | Low-level full-frame root with background, padding, and vertical alignment. |
| `Scene` | Standard frame wrapper with title, subtitle, content column, and theme-aware typography. |
| `TitleBar` | Shared title/subtitle block used by `Scene`. |
| `Row` / `Column` | Flex layout primitives with gap, alignment, wrapping, width, and height props. |
| `Stack` | Layered vertical stack for repeated cards, tokens, or processing layers. |

#### Surfaces, labels, and cards

| Component | Use |
|---|---|
| `Panel` | Titled card surface with tone strip, subtitle, footer, shadow, and body controls. |
| `Card` | Flexible surface for custom content without a forced title. |
| `StepCard` | Compact stage card for flows, choices, and process steps. |
| `MetricCard` | KPI/value card with label, value, detail, tone, and monospace value support. |
| `CalloutCard` | Highlight block for takeaways, warnings, decisions, and summaries. |
| `WindowFrame` | Browser/terminal-style framed panel for code, UI, or tool output. |
| `Box` | Gradient or outlined labeled rectangle with optional icon and sublabel. |
| `Tile` / `TileGrid` | Uniform repeated tiles with tone, title, detail, and metric layouts. |
| `Badge` / `BadgePill` | Small labels for status, categories, and annotations. |
| `ValuePill` | Compact value badge for numbers or short state labels. |
| `GradientChip` | Small colored chip with gradient fill for legends and tone keys. |
| `ToneStrip` | Small semantic accent strip for visual grouping. |
| `TextLabel` | Wrapping-safe text with variant, color, math formatting, width, and alignment. |
| `MathText` / `formatMathText` | Converts simple `x_i` / `x^2` style strings into readable unicode math text. |
| `SvgMathText` | SVG text helper for math labels inside custom plots. |

#### Arrows, connectors, and SVG helpers

| Component | Use |
|---|---|
| `Arrow` | Simple directional arrow element. |
| `FlowArrow` / `Connector` | Theme-aware connector between flow stages. |
| `VectorArrow` | SVG vector arrow for coordinate-style diagrams. |
| `VectorSegment` | Labeled segment/vector primitive for geometry and embedding visuals. |
| `SvgFrame` | SVG container with theme-aware background and border. |
| `SvgPoint` / `DotPoint` | Point markers with optional labels. |
| `ArrowMarkerDef` | SVG arrowhead marker definition for custom line charts and graph edges. |
| `DashedLine` | Dotted/dashed SVG line helper. |
| `Legend` | Reusable legend block with colored items and optional title. |

#### Lists, comparisons, and status blocks

| Component | Use |
|---|---|
| `DetailList` | Compact repeated detail rows inside panels and flow stages. |
| `ProgressRow` / `ProgressList` | Progress bars with labels, values, tones, and optional math text. |
| `StatusRow` / `StatusList` | Check, cross, warning, info, pending, and dot rows. |
| `KeyValueList` | Structured label/value rows for configs and metadata. |
| `CodeBlock` | Themed code panel with highlighted lines and optional annotations. |
| `EquationCard` | Formula card with title, equation, and supporting detail. |
| `Comparison` | Side-by-side comparison panel with two titled sides and detail rows. |

#### Flows, pipelines, and graph diagrams

| Component | Use |
|---|---|
| `Flow` | Horizontal or vertical staged process diagram with optional detail rows. |
| `Pipeline` | Process pipeline with stage labels and a shared title. |
| `LayeredNetwork` | Neural-network/DAG diagram with layers, nodes, active path, annotations, and formula. |
| `GraphDiagram` | Positioned node-edge graph with labels, dashed/muted edges, and tone-aware nodes. |

#### Matrices, tables, and grids

| Component | Use |
|---|---|
| `Matrix` | Numeric matrix visualization for linear algebra and attention examples. |
| `Heatmap` | Color-scaled matrix/attention heatmap. |
| `TiledMatrix` | Matrix with region labels and grouped tiles. |
| `DataTable` | Compact text table with header rows/columns and monospace cells. |
| `Grid` | General-purpose cell grid with per-cell label, tone, color, border, and opacity. |

#### Charts and plots

| Component | Use |
|---|---|
| `ChartFrame` | Shared chart wrapper with title, subtitle, footer, and theme-aware shell. |
| `AxisPlot` | Low-level axis plot for custom lines, paths, and plotted values. |
| `MiniBarChart` | Small bar chart for cards and dashboards. |
| `StackedBar` | Segmented horizontal bar with labels and percentages. |
| `BarChart` | Full bar chart with ticks, labels, values, grids, and formats. |
| `LineChart` | Multi-series line chart with optional area fill, points, labels, and grid. |
| `ScatterPlot` | Labeled scatter plot with axes, ticks, point sizing, and collision-aware labels. |
| `QuadrantChart` | 2x2 decision matrix with regions, labeled points, and axis labels. |
| `IntervalPlot` | Timeline/range plot for spans, phases, latencies, and schedules. |

#### Rendering and verification

| API | Use |
|---|---|
| `renderToPng` | Render React scene to PNG through Satori and resvg, with optional watermark, crop, scale, and overflow check. |
| `renderAnimatedGif` | Render ordered `AnimatedScene[]` states to GIF with `fade`, `appear`, or no transition. |
| `renderToBuffer` | Render PNG to memory for tests and pipelines. |
| `renderToSvg` | Render SVG markup directly. |
| `Watermark` | JSX marker component for expressive frame-module watermarks. |
| `wrapWithWatermark` | Add optional watermark text, image/icon, custom element, and position to a frame. |
| `detectBackgroundColor` | Find dominant transparent/background color for cropping. |
| `detectContentBounds` | Compute non-background bounds for autocrop. |
| `cropPixels` | Crop raw pixel buffers. |
| `detectOverflow` | Fail frames that clip content at canvas edges. |

### Rendering

```ts
import { renderAnimatedGif, renderToPng, renderToBuffer, renderToSvg } from "vizmatic"
```

`renderToPng` renders at 2x scale by default, checks for clipped content, crops extra vertical whitespace, and can apply an optional watermark. Use `watermark.image` for a URL or data URI; the CLI also accepts local image paths through `--watermark-image`. For frame-owned branding, export `watermark = <Watermark>...</Watermark>` from the frame module. `brand` still works as a compatibility alias.

```ts
await renderToPng(element, {
  width: 1040,
  height: 560,
  outputPath: "dist/frame.png",
  watermark: { text: "Your Product", image: "https://example.com/logo.svg", position: "top-right" },
  crop: true,
  scale: 2,
})
```

Frame modules can export watermark config directly:

```tsx
import { Watermark } from "vizmatic"

export const watermark = (
  <Watermark position="bottom-right">
    <div style={{ color: "#7c3aed", fontFamily: "Inter", fontWeight: 800 }}>
      Acme Research
    </div>
  </Watermark>
)
```

`renderAnimatedGif` turns ordered scene states into a looping GIF.

```ts
await renderAnimatedGif(createScenes("dark"), {
  width: 1040,
  height: 560,
  outputPath: "dist/agent-pipeline.gif",
  watermark: { text: "Your Product", image: "data:image/png;base64,...", position: "bottom-right" },
  theme: "dark",
  scale: 1,
})
```

## Project Layout

```text
src/
  theme.ts        semantic colors, tones, typography
  primitives.ts   reusable scene building blocks
  render.ts       Satori -> SVG -> resvg -> PNG
  animate.ts      ordered scene states -> GIF
  autocrop.ts     content bounds and overflow checks
  cli.ts          vizmatic render / vizmatic gif
examples/
  *.tsx           generated gallery frames
docs/
  index.html      static website for GitHub Pages
```

## Development

```bash
pnpm install
pnpm verify
pnpm site:serve
```

## Publishing

Preferred release path is the GitHub `Release` workflow. It runs the full verification gate, bumps the package version, publishes to npm with provenance, pushes the tag, and creates a GitHub release.

```bash
gh workflow run release.yml -f version=patch
```

The workflow requires an `NPM_TOKEN` repository secret with publish access.

Manual release fallback:

```bash
pnpm verify
npm publish --access public
```

## License

MIT
