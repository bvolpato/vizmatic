<p align="center">
  <img src="https://bvolpato.github.io/vizmatic/assets/logo.svg" alt="Vizmatic logo" width="460" />
</p>

<p align="center">
  <strong>Diagrams, charts, dashboards, and GIFs from TSX.</strong><br/>
  Render dark and light PNG, SVG, and GIF files locally or in CI.
</p>

<p align="center">
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/bvolpato/vizmatic/actions/workflows/pages.yml"><img src="https://github.com/bvolpato/vizmatic/actions/workflows/pages.yml/badge.svg" alt="Pages" /></a>
  <a href="https://github.com/bvolpato/vizmatic/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/vizmatic"><img src="https://img.shields.io/npm/v/vizmatic?color=%2334d058" alt="npm version" /></a>
</p>

<p align="center">
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/animated-pipeline_dark.gif" alt="Vizmatic animated render pipeline" width="760" />
</p>

<p align="center">
  <a href="https://bvolpato.github.io/vizmatic/">Website</a> ·
  <a href="https://bvolpato.github.io/vizmatic/#playground">Playground</a> ·
  <a href="examples">Examples</a> ·
  <a href="PROMPT.md">Agent Prompt</a> ·
  <a href="#api">API</a>
</p>

---

## Quick start

Vizmatic requires Node.js 20 or newer. Install its CLI:

```bash
npm install -g vizmatic
```

Create `frame.tsx`:

```tsx
<Scene title="Agent visual pipeline">
  <Flow
    stages={[
      { title: "Prompt", subtitle: "intent", tone: "blue" },
      { title: "Scene spec", subtitle: "typed structure", tone: "purple" },
      { title: "PNG / SVG / GIF", subtitle: "files", tone: "green" },
    ]}
  />
</Scene>
```

`Scene` title and subtitle are optional. Omit both when surrounding copy already names the visual.

Render it directly:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light
```

Check both themes before publishing. `--json` returns machine-readable errors, warnings, overflow edges, and suggested dimensions:

```bash
vizmatic check ./frame.tsx --theme dark,light --json
```

PNG and SVG renders have transparent backgrounds by default. Add `--background theme` for an opaque dark or light canvas:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light --background theme
```

When a frame omits `width` or `height`, Vizmatic starts at `960x540` and grows that axis if content overflows. Set `autoSize = false` when dimensions must remain fixed and clipping should fail the render.

Bare CLI frames do not need imports. Use a regular module when a frame needs helper code, data loading, other dependencies, animation, or direct renderer APIs.

Add Vizmatic to a project for scripts, editor types, or direct renderer APIs:

```bash
pnpm add vizmatic react
```

To use the current GitHub version:

```bash
pnpm add github:bvolpato/vizmatic react
```

## Agent skill

Install the Vizmatic skill for Codex, Claude Code, Cursor, OpenCode, or another compatible agent:

```bash
npx skills add bvolpato/vizmatic --skill vizmatic -g -y
```

Choose agents explicitly when needed:

```bash
npx skills add bvolpato/vizmatic --skill vizmatic -g -a codex -a claude-code -a cursor -a opencode -y
```

Example prompts:

```text
Use the Vizmatic skill to create a theme-aware architecture diagram and render dark/light PNG files.
Use the Vizmatic skill to turn this release workflow into an animated GIF for docs.
```

Skill source lives in [`.agents/skills/vizmatic`](.agents/skills/vizmatic). Review it before installing with `npx skills add bvolpato/vizmatic --list`.

Codex and Claude Code can also install Vizmatic as a plugin:

```bash
codex plugin marketplace add bvolpato/vizmatic --ref main
codex plugin add vizmatic@vizmatic
```

```bash
claude plugin marketplace add bvolpato/vizmatic
claude plugin install vizmatic@vizmatic --scope user
```

## Rendering options

Add a text or image watermark when output needs branding:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light --watermark "Acme" --watermark-image ./logo.svg
```

Each output directory includes `manifest.json`. `outputs` lists generated files, and `outputDetails` records theme, path, and pixel dimensions.

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
  background: "theme", // omit for alpha-transparent output
  watermark: { text: "Acme", image: "data:image/svg+xml;base64,...", position: "top-right" },
})
```

Frames can export their own watermark:

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

## What Vizmatic handles

Coding agents can write a small component tree more reliably than raw SVG paths and hand-tuned coordinates.

Vizmatic provides reusable layout, diagram, and chart primitives:

| Need | Vizmatic answer |
|---|---|
| More than flowcharts | Charts, cards, matrices, timelines, trees, icons, and custom composition |
| Editable output | Source-controlled TSX stays inspectable and renders consistently |
| Headless rendering | Node produces assets directly in local workflows and CI |
| Theme variants | One command renders dark and light output from semantic color tokens |
| Layout checks | Overflow detection, autocrop, and wrapping-safe labels catch common failures |
| Animation | Ordered scene states export as GIFs |

## Gallery

<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/animated-pipeline_dark.gif" alt="Animated pipeline" width="380" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/attention-head_dark.png" alt="Attention head" width="380" />
</p>
<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/rag-graph_dark.png" alt="RAG graph" width="380" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/eval-dashboard_dark.png" alt="Evaluation dashboard" width="380" />
</p>
<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/token-matrix_dark.png" alt="Token matrix" width="380" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/theme-system_dark.png" alt="Theme system" width="380" />
</p>
<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/presentation-frame_dark.png" alt="Presentation frame" width="380" />
</p>

More examples live in [`examples/`](examples) and on the [website](https://bvolpato.github.io/vizmatic/). [`PROMPT.md`](PROMPT.md) contains the full install, syntax, component, and verification reference for coding agents.

## Repository checks

Generated examples and website files are committed. CI fails when a build changes them without a matching source update.

| Gate | What it protects |
|---|---|
| `pnpm lint` | TypeScript coverage plus GitHub Actions validation with actionlint |
| `pnpm test` | Render pipeline behavior, watermark options, and output validation |
| `pnpm render:examples` | Dark/light PNGs, animated GIFs, source snippets, and website HTML |
| `pnpm docs:check` | Local asset references, `PROMPT.md` sync, source modal themes, and homepage affordances |
| `pnpm deps:check` | npm audit plus package tarball contents before release |
| `./test.sh` drift check | Confirms render and docs commands leave no uncommitted output |

Run the full local gate:

```bash
./test.sh
```

## Runtime assets

Vizmatic uses `react` for JSX frames, `satori` for layout, `@resvg/resvg-js` for PNG output, `gifenc` for GIFs, and `tsx` to load frame files.

Published packages include Inter, JetBrains Mono, Noto Sans, Noto Sans Math, and Twemoji SVGs under `assets/`, so normal CLI rendering does not fetch them at runtime. Set `VIZMATIC_FONT_DIR` or `VIZMATIC_ASSET_DIR` to use other local assets. Set `VIZMATIC_DISABLE_NETWORK=1` or `VIZMATIC_OFFLINE=1` to disable public fallbacks.

## API

### Themes

```ts
import { getThemeColors, getToneFill } from "vizmatic"

const dark = getThemeColors("dark")
const light = getThemeColors("light")
const engineering = getThemeColors("light", "engineering")
const engineeringNodeFill = getToneFill("purple", engineering)
```

Primitives receive `c`, the resolved theme object, for colors and typography.

Bare frames select the same style with `preset = "engineering";`. Full modules pass the preset as the second argument to `getThemeColors`.

### Component catalog

Use these primitives before writing raw SVG or absolute-positioned layouts.

#### Frame and layout

| Component | Use |
|---|---|
| `defineIllustration` | Wraps a theme-aware frame builder and exports `create(theme)` plus a default element. |
| `Canvas` | Low-level full-frame root with alpha-transparent default background, optional background fill, padding, and vertical alignment. |
| `Scene` | Standard frame wrapper with optional title/subtitle, content column, and theme-aware typography. |
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
| `Icon` | Curated SVG icon set for cards, callouts, compact rows, and presentation frames. |
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
| `Timeline` | Vertical or horizontal milestone list with tone markers, time labels, and compact event cards. |
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
| `TreeDiagram` | Auto-laid parent/child hierarchy for ownership, routing, taxonomy, and decision trees. |

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
| `DonutChart` | Part-to-whole chart with center label/value, segment labels, and shared chart styling. |
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
| `renderToPngWithOutput` | Render PNG and return logical plus physical pixel dimensions. |
| `renderAnimatedGif` | Render ordered `AnimatedScene[]` states to GIF with `fade`, `appear`, or no transition. |
| `renderAnimatedGifWithOutput` | Render GIF and return its physical pixel dimensions. |
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

`renderToPng` renders at 2x scale, checks for clipping, and crops extra whitespace while keeping 24 source pixels around detected content. Output stays transparent unless `background` is set.

Use `background: "theme"` to paint `c.bg`, or pass a CSS color. Use `crop: "height"` to keep canvas width while trimming vertical whitespace. `watermark.image` accepts a URL or data URI; CLI flag `--watermark-image` also accepts a local path. A frame module can export `watermark = <Watermark>...</Watermark>`. `brand` remains a compatibility alias.

```ts
await renderToPng(element, {
  width: 1040,
  height: 560,
  outputPath: "dist/frame.png",
  background: "theme",
  theme: "dark",
  watermark: { text: "Your Product", image: "https://example.com/logo.svg", position: "top-right" },
  crop: "height",
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

`renderAnimatedGif` turns ordered scene states into a looping GIF. GIF transparency is one-bit; use PNG or SVG when edges need full alpha.

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

## Development

```bash
pnpm install
pnpm verify
pnpm site:serve
```

## Publishing

Use the GitHub `Release` workflow. It runs verification, bumps package and plugin versions, publishes to npm with provenance, pushes the tag, and creates release notes with the compare link and commits since the previous version.

```bash
gh workflow run release.yml -f version=patch
```

The workflow requires an `NPM_TOKEN` repository secret with publish access.

The workflow keeps package version, plugin metadata, tag, release notes, and npm provenance in sync.

## License

MIT
