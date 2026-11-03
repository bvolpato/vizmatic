---
title: Figures reference
nav: Figures reference
section: Diagrams
order: 2
description: Render TSX figures to PNG, SVG, and GIF. This page covers the frame format, render options, themes, primitives, and the programmatic API.
---

A figure is a TSX file. The `vizmatic` command renders it in each theme. Use [Diagrams and density](diagrams.md) for the design guidance, and this page for the details.

## Write a frame

Create `frame.tsx`:

```jsx
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

Check both themes before publishing. `--json` reports overflow, contrast, small text, overlapping labels, uneven panel whitespace, connector congestion, asset failures, and suggested dimensions:

```bash
vizmatic check ./frame.tsx --theme dark,light --json
```

PNG and SVG renders have transparent backgrounds by default. Add `--background theme` for an opaque dark or light canvas:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light --background theme
```

CSS alpha colors stay semi-transparent in PNG and SVG output. Set the canvas background in the frame or pass a quoted CSS color to `--background`:

```jsx
<Scene background="rgba(15, 23, 42, 0.5)">
  <CalloutCard title="Alpha background" detail="The host page remains visible through the canvas." />
</Scene>
```

```bash
vizmatic ./frame.tsx --background 'rgba(15, 23, 42, 0.5)'
```

When a frame omits `width` or `height`, Vizmatic starts at `960x540` and grows that axis if content overflows. Set `autoSize = false` when dimensions must remain fixed and clipping should fail the render.

Bare CLI frames do not need imports. Use a regular module when a frame needs helper code, data loading, other dependencies, animation, or direct renderer APIs.

## Rendering options

Add a text or image watermark when output needs branding:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light --watermark "Acme" --watermark-image ./logo.svg
```

Each output directory includes `manifest.json`. `outputs` lists generated files, and `outputDetails` records theme, path, and pixel dimensions.

Static CLI renders default to PNG. Use `--format svg` for vector output or `--format both` to export PNG and SVG together. Each manifest output detail includes its `format`; both formats support themes, backgrounds, watermarks, cropping, and automatic canvas growth.

```bash
vizmatic ./frame.tsx --out ./visuals --theme dark,light --format both
```

Render an animation:

```bash
vizmatic gif ./animated-frame.tsx --out ./dist/frames --theme dark,light --fps 20 --watermark "Acme" --watermark-image ./logo.svg
```

Or call the renderer directly:

```typescript
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

```jsx
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

## Runtime assets

Vizmatic uses `react` for JSX frames, `satori` for layout, `@resvg/resvg-js` for PNG output, `gifenc` for GIFs, and `tsx` to load frame files.

Published packages include Inter, JetBrains Mono, Noto Sans, Noto Sans Math, and a compressed Twemoji bundle under `assets/`, so normal CLI rendering does not fetch them at runtime. Set `VIZMATIC_FONT_DIR` or `VIZMATIC_ASSET_DIR` to use other local assets. Set `VIZMATIC_DISABLE_NETWORK=1` or `VIZMATIC_OFFLINE=1` to disable public fallbacks.

The complete Twemoji set stays available offline but ships as one Brotli bundle instead of 3,720 individual SVG files. `pnpm deps:check` keeps the package below 3.2 MB compressed, 7.3 MB unpacked, and 100 files, including the separately loaded browser scene renderer.

## API

### Themes

```typescript
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
| `Board` | Fixed canvas for freely positioned components, with explicit dimensions and an optional background. |
| `CanvasItem` | Positions and sizes a component at logical-pixel `x` / `y` coordinates. Charts fit their complete plotting layers, labels, and frame inside the item. |
| `Scene` | Standard frame wrapper with optional title/subtitle, content column, and theme-aware typography. |
| `TitleBar` | Shared title/subtitle block used by `Scene`. |
| `Row` / `Column` | Flex layout primitives with gap, alignment, wrapping, width, and height props. |
| `Stack` | Layered vertical stack for repeated cards, tokens, or processing layers. |

Use `Board` with `CanvasItem` for layouts that people can move and resize in the browser builder. Coordinates and sizes remain in the TSX source. Set the frame dimensions to match the board; the board clips content outside its bounds. With both item dimensions set, chart primitives scale proportionally to fit the complete chart, including wrapped headings, legends, and footers.

```jsx
width = 960;
height = 540;

<Board width={960} height={540}>
  <CanvasItem x={40} y={40} width={280} height={160}>
    <MetricCard label="Requests" value="1,240" tone="green" />
  </CanvasItem>
  <CanvasItem x={360} y={40} width={540} height={340}>
    <PieChart title="Requests by outcome" format="integer" segments={[
      { label: "Successful", value: 82, color: "positive" },
      { label: "Retried", value: 18, color: "warning" },
    ]} />
  </CanvasItem>
</Board>
```

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
| `SvgMathText` | Positioned HTML overlay for math labels aligned to custom plot coordinates. Place it beside, not inside, raw SVG geometry in a relative container. |

#### Arrows, connectors, and SVG helpers

| Component | Use |
|---|---|
| `Arrow` | Simple directional arrow element. |
| `FlowArrow` / `Connector` | Theme-aware connector between flow stages. |
| `VectorArrow` | SVG vector arrow for coordinate-style diagrams. |
| `VectorSegment` | Labeled segment/vector primitive for geometry and embedding visuals. |
| `SvgFrame` | SVG container with theme-aware background and border. |
| `SvgPoint` / `DotPoint` | Point markers with optional labels. |
| `ArrowMarkerDef` | SVG arrowhead marker definition for custom paths and graph edges. Use `direction="start"` to define a backward-facing path-start tip. |
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
| `GraphDiagram` | Auto-laid architecture graph with nested boundaries, technical icons, typed relationships, and custom icon definitions. |
| `TreeDiagram` | Auto-laid parent/child hierarchy for ownership, routing, taxonomy, and decision trees. |
| `SequenceDiagram` | Participants, lifelines, activations, notes, sync/async/return messages, and control fragments. |
| `DataflowDiagram` | Schema-aware source, transform, store, and sink lineage with batch or streaming edges. |
| `DeploymentDiagram` | Nested infrastructure boundaries with workload kinds, ports, protocols, and trust direction. |
| `TransformerTopology` | Transformer blocks, tensor shapes, repeated layers, residual paths, caches, experts, and collectives. |

`GraphDiagram` uses deterministic layered layout when node coordinates are omitted. Groups become nested system boundaries, while built-in technical icons keep common architecture nodes concise:

```jsx
<GraphDiagram
  ariaLabel="Checkout architecture"
  groups={[
    { id: "prod", label: "Production", tone: "blue" },
    { id: "data", label: "Data", parent: "prod", tone: "green" },
  ]}
  nodes={[
    { id: "client", label: "Client", icon: "browser", tone: "cyan" },
    { id: "api", label: "API", icon: "server", group: "prod", tone: "purple" },
    { id: "db", label: "Postgres", icon: "database", group: "data", tone: "green" },
  ]}
  edges={[
    { from: "client", to: "api", label: "HTTPS", kind: "sync" },
    { from: "api", to: "db", label: "SQL", kind: "data", arrow: "both" },
  ]}
/>
```

Groups support unlimited nesting in automatic layout, reserve a boundary-header gutter, and clip long headers inside the boundary. Set `icon` to a built-in `IconName`, a React element, or a reusable icon from `defineDiagramIcon`; `defineIconRegistry` groups provider packs without a runtime registry. Icon size stays inside its node. Custom React elements own their theme colors and accessible label. Relationship `kind` selects solid, dashed, or dotted defaults, `style` overrides them, and `arrow` accepts `forward`, `backward`, `both`, or `none`. Associations default to no arrow.

Set `id`, `title`, and `description` for accessible SVG exports. Nodes and edges accept safe `href` links and tooltip `title` text. These semantics are included by `renderToSvg` and the playground SVG download; see the [SVG accessibility guide](https://github.com/bvolpato/vizmatic/blob/main/docs/accessibility.md) for supported links and stable ID behavior.

Set `x` and `y` on every node for normalized manual positioning when no groups are present. Mixed coordinate modes fail with a clear error. Automatic layout treats node and edge array order as its stable tie-breaker and expands `width` or `height` when needed. Set `sizing="fixed"` to keep exact graph dimensions and let overflow checks report a canvas that is too small. Use `direction`, `nodeGap`, `rankGap`, and `edgeGap` to tune the result.

Connector routing is separate from node layout. The default `routing="dagre"` preserves existing geometry. Choose `routing="straight"` for direct connectors or `routing="orthogonal"` for right-angle routes that avoid node boxes and group headers. `routingClearance` defaults to 12 logical pixels; `edgeGap` separates parallel traffic. Orthogonal routing supports automatic and manual node positions, self-loops with distinct anchors, and separated parallel routes.

Declare node `ports` as `{ id, side, offset? }`, then reference them with edge `fromPort` / `toPort`. Sides are `top`, `right`, `bottom`, or `left`; offsets run from 0 to 1 along the side and default to 0.5. An edge can instead specify `fromSide` / `toSide`. Use either a port reference or a side for each endpoint. Explicit anchors also opt an edge into orthogonal geometry when the routing mode is Dagre. With explicit straight or orthogonal routing, `DeploymentDiagram` anchors declared port references and accepts port `side` / `offset` overrides.

Routing runs synchronously offline with limits of 64 node/header obstacles and 256 edges, plus bounded grid and search work. A blocked route, repeated route with no separate lane, or exhausted limit omits the affected connector and makes the checker report `layout.connector_unroutable` as an error. Increase spacing or canvas size, change anchors, or reduce clearance before publishing. Missing port references fail validation. See the [routed graph example](https://github.com/bvolpato/vizmatic/blob/main/examples/orthogonal-routing.tsx).

The [import guide](https://github.com/bvolpato/vizmatic/blob/main/docs/import.md) documents the supported Mermaid and D2 subsets and their structured source diagnostics.

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
| `PieChart` | Full-circle part-to-whole chart with segment values, percentages, and a legend. |
| `DonutChart` | Part-to-whole chart with center label/value, segment labels, and shared chart styling. |
| `MiniBarChart` | Small bar chart for cards and dashboards. |
| `StackedBar` | Segmented horizontal bar with labels and percentages. |
| `BarChart` | Full bar chart with ticks, labels, values, grids, and formats. |
| `LineChart` | Multi-series line chart with optional area fill, points, labels, and grid. |
| `ScatterPlot` | Labeled scatter plot with axes, ticks, point sizing, and collision-aware labels. |
| `ParetoBarChart` | Categories sorted by descending count with a cumulative percentage line and separate count/share axes. |
| `ParetoChart` | Automatic non-dominated frontier for competing objectives, including log-scaled cost axes. |
| `QuadrantChart` | 2x2 decision matrix with numeric axes, configurable thresholds, labeled points, and optional region emphasis. |
| `IntervalPlot` | Timeline/range plot for spans, phases, latencies, and schedules. |

Use `PieChart` for category shares, `BarChart` for category values, `ScatterPlot` for paired numeric observations, and `ParetoBarChart` to identify the categories behind most of a total. Pie and Pareto bar values must be finite and non-negative; zero-valued pie slices are omitted. Pareto bars sort descending without changing the input array and preserve input order for equal values. The cumulative line reaches 100% when the total is positive. See the [pie](https://github.com/bvolpato/vizmatic/blob/main/examples/pie-chart.tsx) and [Pareto bar](https://github.com/bvolpato/vizmatic/blob/main/examples/pareto-bar-chart.tsx) examples.

`ParetoChart` shows a non-dominated scatter frontier for competing objectives. It defaults to minimizing x and maximizing y, which fits cost-versus-score comparisons. Set `xObjective` or `yObjective` for other tradeoffs. Non-positive x values are omitted on a logarithmic x-axis. `QuadrantChart` accepts raw numeric domains, threshold values, tick formats, and optional grid lines; omit them to keep normalized 0-1 coordinates and centered splits. Regions accept `emphasis: true` to give one decision region a stronger fill and border.

#### Rendering and verification

| API | Use |
|---|---|
| `checkFrame` | Check a React scene or themed frame and return typed diagnostics with configurable severity-based pass/fail. |
| `renderToPng` | Render React scene to PNG through Satori and resvg, with optional watermark, crop, scale, and overflow check. |
| `renderToPngWithOutput` | Render PNG and return logical dimensions, physical pixel dimensions, and painted `contentBounds`. |
| `CanvasOverflowError` | Typed clipping failure with canvas dimensions and per-edge overflow details. |
| `renderAnimatedGif` | Render ordered `AnimatedScene[]` states to GIF with `fade`, `appear`, or no transition. |
| `renderAnimatedGifWithOutput` | Render GIF and return dimensions, timing, encoded-frame, delta-frame, and byte metrics. |
| `defineAnimation` | Define a typed state timeline rendered at deterministic sample times. |
| `hold`, `tween`, `keyframe`, `parallel` | Compose sequential pauses, eased property transitions, instant state changes, and staggered concurrent tracks. |
| `sampleAnimation` | Evaluate timeline state at an exact millisecond without rendering. |
| `analyzeAnimationCadence` | Inspect sampled frame count, target interval, encoded duration, and delay range. |
| `renderAnimationGif` | Stream sampled timeline frames into a GIF without retaining every RGBA frame. |
| `renderToBuffer` | Render PNG to memory for tests and pipelines. |
| `renderToSvg` | Render SVG markup directly. |
| `Watermark` | JSX marker component for expressive frame-module watermarks. |
| `wrapWithWatermark` | Add optional watermark text, image/icon, custom element, and position to a frame. |
| `normalizeWatermark` | Normalize boolean, string, object, or React-element watermark input to `WatermarkOptions`. |
| `wrapWithBrand` | Compatibility wrapper for adding a text watermark through `wrapWithWatermark`. |
| `getFonts` | Load and cache bundled Satori font data for advanced renderer integrations. |
| `loadAdditionalAsset` | Resolve Satori missing-glyph requests, including bundled or cached Twemoji assets. |
| `detectBackgroundColor` | Find dominant transparent/background color for cropping. |
| `detectContentBounds` | Compute non-background bounds for autocrop. |
| `cropPixels` | Crop raw pixel buffers. |
| `detectOverflow` | Fail frames that clip content at canvas edges. |

Theme and chart helpers are public for custom primitives: `getReadableColor(name, c)` selects the highest-contrast semantic variant, `getReadableToneColor(tone, c, background?)` adapts tone text to a background, and `getReadableTextColor(background, c)` chooses a foreground meeting 4.5:1 contrast when possible. `createPlotArea(width, height, margin)` returns clamped chart geometry for custom axes and marks.

### Programmatic checking

Use `checkFrame` when a build, editor, or agent already has a React scene in memory. Pass `scene` for one fixed element or `create(theme)` for theme-specific elements:

```jsx
import { CalloutCard, Scene, checkFrame, getThemeColors } from "vizmatic"

const report = await checkFrame({
  source: "agent-pipeline",
  width: 640,
  height: 360,
  create(theme) {
    const c = getThemeColors(theme)
    return (
      <Scene c={c}>
        <CalloutCard c={c} title="Ready" detail="Checked in-process" tone="green" />
      </Scene>
    )
  },
}, {
  themes: ["dark", "light"],
  background: "theme",
  failOn: "warning",
})

if (!report.ok) throw new Error(`Visual check failed: ${report.summary.errors} errors`)
```

`failOn` accepts `"error"` (the default), `"warning"`, `"info"`, or `"never"`. `report.ok` means the diagnostics pass that policy; `report.rendered` means every requested theme completed rendering. Each theme report includes resolved and output dimensions, stable diagnostic codes, and severity counts. Diagnostics expose `elementId`, related IDs, and a `location` path or rendered bounds when available. Import `CHECK_DIAGNOSTIC_CODES`, `CheckDiagnostic`, `CheckFrameInput`, and `CheckFrameReport` for typed integrations. Use `vizmatic check ... --json` when the checker should discover and load frame files itself.

The [`render.svg_context` diagnostic](#svg-context-diagnostics) detects SVG shapes placed in known HTML contexts, including `SvgFrame` directly inside `Board` or `CanvasItem`. Use a native `<svg>` or `AxisPlot` to provide the required SVG context.

### Rendering

```typescript
import { renderAnimatedGif, renderAnimationGif, renderToPng, renderToBuffer, renderToSvg } from "vizmatic"
```

`renderToPng` renders at 2x scale, checks for clipping, and crops extra whitespace while keeping 24 source pixels around detected content. Output stays transparent unless `background` is set.

Use `background: "theme"` to paint `c.bg`, or pass a CSS color. Use `crop: "height"` to keep canvas width while trimming vertical whitespace. `watermark.image` accepts a URL or data URI; CLI flag `--watermark-image` also accepts a local path. A frame module can export `watermark = <Watermark>...</Watermark>`. `brand` remains a compatibility alias.

```typescript
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

```jsx
import { Watermark } from "vizmatic"

export const watermark = (
  <Watermark position="bottom-right">
    <div style={{ color: "#7c3aed", fontFamily: "Inter", fontWeight: 800 }}>
      Acme Research
    </div>
  </Watermark>
)
```

Prefer `defineAnimation` when values should move, resize, or fade continuously. Timeline array runs sequentially; every property in one `tween` moves in parallel. `parallel` adds independent property tracks for staggered or overlapping motion. Renderer samples exact cadence boundaries plus terminal state, checks every rendered frame for overflow, coalesces unchanged frames, and delta-encodes changed rectangles on opaque GIFs. Infinite loops should end on same visual state where they begin. Fade moving content out and reset it with a `keyframe` while hidden instead of reversing a one-way operation. Keep `create(theme)` as static fallback for PNG, docs previews, and reduced-motion users.

```jsx
import { defineAnimation, getThemeColors, hold, keyframe, Scene, tween, type ThemeMode } from "vizmatic"

function buildFrame(theme: ThemeMode, state: { operation: number; progress: number }) {
  const c = getThemeColors(theme)
  return <Scene c={c} title={`Step ${state.operation + 1}: ${Math.round(state.progress * 100)}%`}><div /></Scene>
}

export function createAnimation(theme: ThemeMode) {
  return defineAnimation({
    initial: { operation: 0, progress: 0 },
    timeline: [
      hold(500, "Broadcast input"),
      tween({ progress: 1 }, { duration: 900, easing: "ease-in-out", label: "Transfer" }),
      hold(500, "Broadcast output"),
      keyframe({ operation: 1, progress: 0 }),
      tween({ progress: 1 }, { duration: 900, easing: "ease-in-out", label: "AllReduce" }),
    ],
    fps: 20,
    render: (state) => buildFrame(theme, state),
  })
}
```

```typescript
await renderAnimationGif(createAnimation("dark"), {
  width: 1040,
  height: 560,
  outputPath: "dist/collective.gif",
  watermark: { text: "Your Product", image: "data:image/png;base64,...", position: "bottom-right" },
  theme: "dark",
  scale: 1,
})
```

`createScenes(theme)` and `renderAnimatedGif(AnimatedScene[])` remain supported for intentional scene cuts and pixel crossfades. `fps` controls their transition sampling as well as typed timelines. GIF output uses one shared 256-color palette and centisecond timing. Opaque animations use changed rectangles by default; set `deltaFrames: false` only for legacy decoder debugging. Transparent animations stay full-frame to preserve one-bit compositing. Use PNG/SVG for smooth alpha edges.

### SVG context diagnostics

`render.svg_context` reports an error when an SVG-only element appears in a known HTML context. `Board` and `CanvasItem` create HTML containers. Place `SvgFrame` inside a native `<svg>` or `AxisPlot` so its rectangle renders. Satori can otherwise complete rendering while omitting the shape. The diagnostic identifies the component or tag, React element path, and element ID when available.

Native and nested `<svg>` elements establish SVG context. `AxisPlot` places its children inside its generated SVG. Children of `<foreignObject>` use HTML context, so SVG shapes there need another `<svg>` wrapper. The checker follows resolved wrappers and known primitive contracts. It does not infer the child namespace of opaque function wrappers. Inspect their rendered output to confirm that shapes appear.

## The browser builder

The Components page and the Playground share a live component explorer. Choose a component to open its focused example, or use Add to scene to compose several components. Select an element to edit its literal props, add optional properties, duplicate or remove it, and move it within its group. Controls follow inline text and TSX edits. Computed props and expression-generated structure stay editable in the TSX. Preview framing and zoom preserve the full canvas in downloaded PNG and SVG files.

Choose the Freeform canvas template for a positioned builder. Move and resize `CanvasItem` components through the preview handles, use grid snapping, or adjust their literal coordinates in the inspector. Arrow keys nudge a focused handle; Shift makes a larger move and Alt bypasses snapping. The layout remains ordinary `Board` / `CanvasItem` TSX.

Structured data editors let you add, remove, and change pie segments, bar categories, scatter points, and table cells. Nested styles, arrays, and objects also have JSON editors. Invalid shapes and missing graph node references report an error before changing the source. Computed data remains editable in TSX.

Open Canvas and palette to change the frame dimensions, style preset, and any theme color. Choose a transparent, theme, or custom CSS background. These settings are saved in the TSX and participate in undo, project files, share links, and exports. Bare CLI frames support the same metadata:

```jsx
width = 960;
height = 540;
preset = "default";
background = "#101827";
themeColors = {"primary":"#22c55e","primaryLight":"hsl(140, 70%, 65%)"};

<Board width={960} height={540}>
  <CanvasItem x={40} y={40} width={300} height={120}>
    <CalloutCard title="Your palette" detail="Colors travel with the frame." />
  </CanvasItem>
</Board>
```

Copy block copies the selected element as reusable bare TSX, including its setup and canvas settings. Inside a Board it keeps the enclosing CanvasItem and its geometry, so the copied block renders on its own. Ctrl/Command+C copies a block when its canvas handle is focused. Copy source copies the complete composition.

Edits are saved locally in this browser and restore after reload. Component, shared-source, and gallery links open their own examples. Editing clears the original example or source bookmark so reload can recover your draft. Undo and redo cover source typing, controls, inline text, and scene operations, with up to 100 source snapshots for the current session. Use the buttons or Ctrl/Command+Z and Ctrl/Command+Shift+Z. Drafts do not sync between devices; use Save project to download a named `.vizmatic.json` file containing source, output theme, and canvas background, then Open project to restore it. Share and Copy source also let you move your TSX between tools.
