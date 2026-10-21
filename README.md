<p align="center">
  <img src="https://bvolpato.github.io/vizmatic/assets/logo.svg" alt="Vizmatic logo" width="460" />
</p>

<p align="center">
  <strong>Diagrams, charts, dashboards, GIFs, and MP4 videos from TSX.</strong><br/>
  Render theme-aware PNG, SVG, and GIF in the browser; export H.264 MP4 from Node.js or CI.
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
  <a href="https://bvolpato.github.io/vizmatic/playground.html">Playground</a> ·
  <a href="https://bvolpato.github.io/vizmatic/components.html">Components</a> ·
  <a href="https://bvolpato.github.io/vizmatic/agents.html">For agents</a> ·
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

Check both themes before publishing. `--json` reports overflow, contrast, small text, overlapping labels, uneven panel whitespace, connector congestion, asset failures, and suggested dimensions:

```bash
vizmatic check ./frame.tsx --theme dark,light --json
```

PNG and SVG renders have transparent backgrounds by default. Add `--background theme` for an opaque dark or light canvas:

```bash
vizmatic ./frame.tsx --out ./dist/frames --theme dark,light --background theme
```

CSS alpha colors stay semi-transparent in PNG and SVG output. Set the canvas background in the frame or pass a quoted CSS color to `--background`:

```tsx
<Scene background="rgba(15, 23, 42, 0.5)">
  <CalloutCard title="Alpha background" detail="The host page remains visible through the canvas." />
</Scene>
```

```bash
vizmatic ./frame.tsx --background 'rgba(15, 23, 42, 0.5)'
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

The [agent guide](https://bvolpato.github.io/vizmatic/agents.html) explains installation and the check/render workflow. Agents can discover instructions through [llms.txt](https://bvolpato.github.io/vizmatic/llms.txt), load the [full context bundle](https://bvolpato.github.io/vizmatic/llms-full.txt), or read [runnable component examples as JSON](https://bvolpato.github.io/vizmatic/components.json).

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

Static CLI renders default to PNG. Use `--format svg` for vector output or `--format both` to export PNG and SVG together. Each manifest output detail includes its `format`; both formats support themes, backgrounds, watermarks, cropping, and automatic canvas growth.

```bash
vizmatic ./frame.tsx --out ./visuals --theme dark,light --format both
```

Render an animation:

```bash
vizmatic gif ./animated-frame.tsx --out ./dist/frames --theme dark,light --fps 20 --watermark "Acme" --watermark-image ./logo.svg
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
| Layout checks | Overflow, contrast, small text, label overlap, uneven panel whitespace, and connector congestion |
| Animation | Typed state timelines, tweens, easing, holds, keyframes, and parallel tracks export as GIFs |

## Gallery

<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/animated-pipeline_dark.gif" alt="Animated pipeline" width="380" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/nccl-broadcast_dark.gif" alt="Animated NCCL Broadcast: root rank sends one buffer to every rank" width="300" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/nccl-all-reduce_dark.gif" alt="Animated NCCL AllReduce: every rank reduces values and receives the sum" width="300" />
</p>
<p>
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/nccl-all-gather_dark.gif" alt="Animated NCCL AllGather: every rank receives concatenated tensors" width="300" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/nccl-reduce-scatter_dark.gif" alt="Animated NCCL ReduceScatter: each rank receives one reduced chunk" width="300" />
  <img src="https://bvolpato.github.io/vizmatic/assets/examples/nccl-all-to-all_dark.gif" alt="Animated NCCL AllToAll: every rank exchanges one chunk with every rank" width="300" />
</p>
<p>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/rag-graph_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/rag-graph_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/rag-graph_light.png" alt="RAG graph" width="380" /></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/eval-dashboard_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/eval-dashboard_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/eval-dashboard_light.png" alt="Evaluation dashboard" width="380" /></picture>
</p>
<p>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/token-matrix_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/token-matrix_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/token-matrix_light.png" alt="Token matrix" width="380" /></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/theme-system_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/theme-system_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/theme-system_light.png" alt="Theme system" width="380" /></picture>
</p>
<p>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/system-architecture_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/system-architecture_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/system-architecture_light.png" alt="System architecture" width="380" /></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/presentation-frame_dark.png" /><source media="(prefers-color-scheme: light)" srcset="https://bvolpato.github.io/vizmatic/assets/examples/presentation-frame_light.png" /><img src="https://bvolpato.github.io/vizmatic/assets/examples/presentation-frame_light.png" alt="Presentation frame" width="380" /></picture>
</p>

NCCL gallery examples cover five operations: Broadcast, AllReduce, AllGather, ReduceScatter, and AllToAll. Their diagrams follow NVIDIA's documented [collective operation semantics](https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html): rooted transfer, reduction, rank-ordered gathering, reduced chunk ownership, and pairwise exchange.

More examples live in [`examples/`](examples). Browse the searchable [component catalog on the homepage](https://bvolpato.github.io/vizmatic/#component-browser), copy a focused example, or open it in the playground to edit and render both themes. The [full catalog](https://bvolpato.github.io/vizmatic/components.html) also includes category previews and source. [`PROMPT.md`](PROMPT.md) contains the full install, syntax, component, and verification reference for coding agents. [`ROADMAP.md`](ROADMAP.md) tracks the next C4, provider pack, UML, layout, and interoperability capabilities.

## Repository checks

Generated examples and website files are committed. CI fails when a build changes them without a matching source update.

| Gate | What it protects |
|---|---|
| `pnpm lint` | TypeScript coverage plus GitHub Actions validation with actionlint |
| `pnpm test` | Render pipeline behavior, watermark options, and output validation |
| `pnpm render:examples` | Dark/light PNGs, animated GIFs, source snippets, and website HTML |
| `pnpm check:examples` | Every example renders in both themes without errors or visual warnings |
| `pnpm docs:check` | Local asset references, `PROMPT.md` sync, source modal themes, and homepage affordances |
| `pnpm deps:check` | npm audit plus package tarball contents, size, and file-count budgets before release |
| `./test.sh` drift check | Confirms render and docs commands leave no uncommitted output |

Run the full local gate:

```bash
./test.sh
```

## Runtime assets

Vizmatic uses `react` for JSX frames, `satori` for layout, `@resvg/resvg-js` for PNG output, `gifenc` for GIFs, and `tsx` to load frame files.

Published packages include Inter, JetBrains Mono, Noto Sans, Noto Sans Math, and a compressed Twemoji bundle under `assets/`, so normal CLI rendering does not fetch them at runtime. Set `VIZMATIC_FONT_DIR` or `VIZMATIC_ASSET_DIR` to use other local assets. Set `VIZMATIC_DISABLE_NETWORK=1` or `VIZMATIC_OFFLINE=1` to disable public fallbacks.

The complete Twemoji set stays available offline but ships as one Brotli bundle instead of 3,720 individual SVG files. `pnpm deps:check` keeps the package below 2.5 MB compressed, 5 MB unpacked, and 100 files.

## Editable scenes for video applications

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

```ts
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

Source uses local JavaScript/TypeScript declarations and helper components followed
by one JSX root. Imports, exports and module wrappers are not supported. Vizmatic
JSX primitives are provided automatically. SVG geometry and `<text>`/`<tspan>` use
the bundled fonts through Resvg, including inside HTML layouts. `Scene`, `Board`,
`CanvasItem`, charts and other trusted Vizmatic components use the same rendering
path in previews and video frames. Function-valued props are unsupported; calculate
formatted values and geometry in the source before returning JSX.

| Source value | Meaning |
| --- | --- |
| `width`, `height` | Exact output canvas dimensions |
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
| `Board` | Fixed canvas for freely positioned components, with explicit dimensions and an optional background. |
| `CanvasItem` | Positions and sizes a component at logical-pixel `x` / `y` coordinates. Charts fit their complete plotting layers, labels, and frame inside the item. |
| `Scene` | Standard frame wrapper with optional title/subtitle, content column, and theme-aware typography. |
| `TitleBar` | Shared title/subtitle block used by `Scene`. |
| `Row` / `Column` | Flex layout primitives with gap, alignment, wrapping, width, and height props. |
| `Stack` | Layered vertical stack for repeated cards, tokens, or processing layers. |

Use `Board` with `CanvasItem` for layouts that people can move and resize in the browser builder. Coordinates and sizes remain in the TSX source. Set the frame dimensions to match the board; the board clips content outside its bounds. With both item dimensions set, chart primitives scale proportionally to fit the complete chart, including wrapped headings, legends, and footers.

```tsx
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
| `GraphDiagram` | Auto-laid architecture graph with nested boundaries, technical icons, typed relationships, and custom icon definitions. |
| `TreeDiagram` | Auto-laid parent/child hierarchy for ownership, routing, taxonomy, and decision trees. |
| `SequenceDiagram` | Participants, lifelines, activations, notes, sync/async/return messages, and control fragments. |
| `DataflowDiagram` | Schema-aware source, transform, store, and sink lineage with batch or streaming edges. |
| `DeploymentDiagram` | Nested infrastructure boundaries with workload kinds, ports, protocols, and trust direction. |
| `TransformerTopology` | Transformer blocks, tensor shapes, repeated layers, residual paths, caches, experts, and collectives. |

`GraphDiagram` uses deterministic layered layout when node coordinates are omitted. Groups become nested system boundaries, while built-in technical icons keep common architecture nodes concise:

```tsx
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

Set `id`, `title`, and `description` for accessible SVG exports. Nodes and edges accept safe `href` links and tooltip `title` text. These semantics are included by `renderToSvg` and the playground SVG download; see the [SVG accessibility guide](docs/accessibility.md) for supported links and stable ID behavior.

Set `x` and `y` on every node for normalized manual positioning when no groups are present. Mixed coordinate modes fail with a clear error. Automatic layout treats node and edge array order as its stable tie-breaker and expands `width` or `height` when needed. Set `sizing="fixed"` to keep exact graph dimensions and let overflow checks report a canvas that is too small. Use `direction`, `nodeGap`, `rankGap`, and `edgeGap` to tune the result.

Connector routing is separate from node layout. The default `routing="dagre"` preserves existing geometry. Choose `routing="straight"` for direct connectors or `routing="orthogonal"` for right-angle routes that avoid node boxes and group headers. `routingClearance` defaults to 12 logical pixels; `edgeGap` separates parallel traffic. Orthogonal routing supports automatic and manual node positions, self-loops with distinct anchors, and separated parallel routes.

Declare node `ports` as `{ id, side, offset? }`, then reference them with edge `fromPort` / `toPort`. Sides are `top`, `right`, `bottom`, or `left`; offsets run from 0 to 1 along the side and default to 0.5. An edge can instead specify `fromSide` / `toSide`. Use either a port reference or a side for each endpoint. Explicit anchors also opt an edge into orthogonal geometry when the routing mode is Dagre. With explicit straight or orthogonal routing, `DeploymentDiagram` anchors declared port references and accepts port `side` / `offset` overrides.

Routing runs synchronously offline with limits of 64 node/header obstacles and 256 edges, plus bounded grid and search work. A blocked route, repeated route with no separate lane, or exhausted limit omits the affected connector and makes the checker report `layout.connector_unroutable` as an error. Increase spacing or canvas size, change anchors, or reduce clearance before publishing. Missing port references fail validation. See the [routed graph example](examples/orthogonal-routing.tsx).

The [import guide](docs/import.md) documents the supported Mermaid and D2 subsets and their structured source diagnostics.

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

Use `PieChart` for category shares, `BarChart` for category values, `ScatterPlot` for paired numeric observations, and `ParetoBarChart` to identify the categories behind most of a total. Pie and Pareto bar values must be finite and non-negative; zero-valued pie slices are omitted. Pareto bars sort descending without changing the input array and preserve input order for equal values. The cumulative line reaches 100% when the total is positive. See the [pie](examples/pie-chart.tsx) and [Pareto bar](examples/pareto-bar-chart.tsx) examples.

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

```tsx
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

### Rendering

```ts
import { renderAnimatedGif, renderAnimationGif, renderToPng, renderToBuffer, renderToSvg } from "vizmatic"
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

Prefer `defineAnimation` when values should move, resize, or fade continuously. Timeline array runs sequentially; every property in one `tween` moves in parallel. `parallel` adds independent property tracks for staggered or overlapping motion. Renderer samples exact cadence boundaries plus terminal state, checks every rendered frame for overflow, coalesces unchanged frames, and delta-encodes changed rectangles on opaque GIFs. Infinite loops should end on same visual state where they begin. Fade moving content out and reset it with a `keyframe` while hidden instead of reversing a one-way operation. Keep `create(theme)` as static fallback for PNG, docs previews, and reduced-motion users.

```tsx
import { defineAnimation, hold, keyframe, tween } from "vizmatic"

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
    render: (state, frame) => buildFrame(theme, state, frame),
  })
}
```

```ts
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

## MP4 export and mathematical motion

Export an existing TSX animation directly with `vizmatic video`:

```bash
vizmatic video ./lesson.tsx --out ./videos --theme dark --fps 30
vizmatic video ./lesson.tsx --out ./videos --theme dark,light --fps 60 --audio narration.wav
```

The module exports `width`, `height`, and `createAnimation(theme)`, just like the
GIF examples. The video command samples the timeline at exact video timestamps,
renders each React scene, and streams it to FFmpeg. It writes `lesson_dark.mp4`
and a `video-manifest.json`. Use `--crf 18` for crisp text, `--preset medium` for
a smaller file, and `--scale 2` for twice the pixel dimensions. FFmpeg with
libx264 is required; audio export also needs AAC. MP4 requires an opaque
background, with the theme background used by default. Set `--background` to
an opaque CSS color to choose another fill. The browser builder exports GIF;
MP4 encoding runs in Node.js.

### Render a complete video example

The short [request lifecycle starter](examples/videos/request-lifecycle.tsx)
shows one request moving through a three-step workflow. It uses only Vizmatic's
published package and keeps the motion tied to the work being explained. The
longer [From noise to signal film](examples/videos/signal-to-story.tsx) shows a
chart, synthetic observations, and a fitted trend.

In a Node.js 20 or newer project, install Vizmatic and React. [Install FFmpeg](https://ffmpeg.org/download.html)
separately and check that its encoder list includes `libx264`. Audio output
also needs the `aac` encoder.

```bash
npm install --save-dev vizmatic@0.4.0 react
npx vizmatic video ./request-lifecycle.tsx --out ./dist/videos --theme dark --fps 30
```

The CLI writes `request-lifecycle_dark.mp4` and `video-manifest.json` under
`./dist/videos`. Add narration with `--audio ./narration.wav`; the audio is
trimmed or padded to the animation duration and encoded as AAC. Vizmatic renders
the picture and optional audio. Keep `.vtt` or `.srt` captions as separate files
and synchronize their cues to the finished timeline. The downloadable source
and a copyable command are also on the [website video example](https://bvolpato.github.io/vizmatic/#video).

The same workflow is available through the API:

```ts
import { renderAnimationVideo } from "vizmatic"
import { createAnimation, width, height } from "./lesson"

await renderAnimationVideo(createAnimation("dark"), {
  width, height, fps: 30, theme: "dark",
  outputPath: "videos/lesson.mp4",
  crf: 18, preset: "medium",
  // audioPath: "narration.wav",
})
```

Video supports 1–120 fps independently of the GIF cadence. Canvas dimensions
after scaling must be positive even integers. Every frame is checked for
overflow; failures report its timestamp and timeline label and preserve an
existing output file. `signal`, audio alignment, and streaming use the same
contracts as `renderRgbaVideo` below. Keep a finite film's last state visible
long enough to read. Use `parallel` tracks for overlapping transitions and
path helpers for continuous motion.

Watch **[From noise to signal](https://bvolpato.github.io/vizmatic/#video)**,
an 18-second motion design example built from
[`examples/videos/signal-to-story.tsx`](examples/videos/signal-to-story.tsx).
Its chart fits actual least-squares coefficients to explicitly synthetic data.
The source demonstrates staggered entrances, arc-length line reveals,
parallel tracks, camera motion, and an ending held on screen. From a repository
checkout, generate the film, posters, captions, and downloadable source with:

```bash
pnpm install --frozen-lockfile
pnpm render:video
```

The repository's `pnpm render:video` script regenerates the showcase poster,
captions, downloadable sources, and MP4. `pnpm site:build` regenerates the
website preview and source downloads without encoding the MP4. Those generated
media files live under `docs/assets/video/` and are excluded from Git. Pages
builds the MP4 and verifies it with `pnpm docs:check --require-video` before
publication. The website loads the poster until playback is requested and
provides chapter controls and a text description.

`renderRgbaVideo` streams caller-rendered RGBA frames to FFmpeg as an H.264 MP4.
It supports 1–120 fps, even pixel dimensions, optional audio, and backpressure,
without retaining the whole film in memory. Install FFmpeg with libx264 and AAC
support separately. Canvas painters can use the optional `@napi-rs/canvas` package:

```ts
import { createCanvas } from '@napi-rs/canvas'
import { renderRgbaVideo, pointAlongPath, tracePolyline } from 'vizmatic'

const canvas = createCanvas(1280, 720)
const ctx = canvas.getContext('2d')
const path = [{ x: 150, y: 550 }, { x: 640, y: 200 }, { x: 1130, y: 550 }]

await renderRgbaVideo((frame) => {
  ctx.fillStyle = '#101827'
  ctx.fillRect(0, 0, 1280, 720)
  const progress = Math.min(1, frame.time / 2000)
  const visible = tracePolyline(path, progress)
  ctx.beginPath()
  visible.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y))
  ctx.strokeStyle = '#63deec'
  ctx.lineWidth = 5
  ctx.stroke()
  const point = pointAlongPath(path, progress)
  ctx.beginPath()
  ctx.arc(point.x, point.y, 14, 0, Math.PI * 2)
  ctx.fillStyle = '#f4d477'
  ctx.fill()
  return canvas.data()
}, {
  width: 1280, height: 720, duration: 3000, fps: 30,
  outputPath: 'lesson.mp4',
  // audioPath: 'narration.wav',
})
```

Durations and `frame.time` are milliseconds, as in typed animation timelines.
`videoFrameSchedule(duration, fps)` lazily yields the same frame timestamps;
the endpoint is not emitted as an extra frame. The callback can be async and
must return exactly `width * height * 4` bytes. Each frame is consumed before
requesting the next. Optional audio is padded or trimmed to the video duration
and encoded as stereo AAC at 48 kHz. `signal` cancels an export. A failed
callback or encoder removes temporary files and preserves an existing output.

Use `defineAnimation` and `sampleAnimation(animation, frame.time)` to drive
multiple properties from a shared timeline. Sample per frame rather than
building a GIF frame array for a long video.

Motion helpers operate on `{ x, y }` points:

- `tracePolyline(points, progress)` reveals a path by actual arc length.
- `pointAlongPath(points, progress)` locates a moving marker on the same path.
- `morphPolyline(from, to, progress, { samples, easing })` smoothly changes one
  path into another, including paths with different vertex counts. It matches
  equal arc-length positions, uses 64 samples and `smoothstep` by default,
  and preserves the inputs. Use it for trajectories and changing curves.
- `createPolylineMorph(from, to, options)` prepares the same arc-length
  correspondence once and returns a `(progress) => points` sampler. Reuse it
  across frames to avoid repeating path measurement and resampling.
- `arcSwap(from, to, progress, { lift, easing })` exchanges positions along
  opposite arcs. `lift` is the maximum perpendicular displacement, defaulting
  to 80; the default easing is `smoothstep`.
- `smoothstep(progress)` clamps and eases progress between zero and one.

Path results use fresh points and handle repeated vertices. Empty paths trace
to an empty array; following an empty path throws. These helpers let a lesson
draw a curve, trace a computation graph, or exchange token positions while
keeping the underlying numerical state explicit.

`createCanvasComponents(painter)` provides reusable panels, labeled cards,
matrices, token rows, and moving particles for a Canvas video renderer. Inject
the renderer's drawing interface, including its containment and opacity
scopes. Every component uses those methods, so host layout checks and shape
metadata remain available. The components use no raw Canvas operations or
raster intermediates.

```ts
import { createCanvasComponents, type CanvasPainter } from 'vizmatic'

// The host supplies checked primitives. Scope callbacks must keep those
// checks active, and opacity must restore drawing state with try/finally.
function drawLesson<Shape>(painter: CanvasPainter<Shape>) {
  const scene = createCanvasComponents(painter)
  const node = scene.card({
    x: 40, y: 40, width: 160, height: 68, label: 'query',
    fill: '#18283b', stroke: '#63deec', textColor: '#fff',
  })
  scene.matrix({
    values: [[1, -2], [3, 4]], x: 240, y: 40, cellSize: 80,
    style: { fill: '#18283b', textColor: '#fff', fontSize: 26 },
    cellStyle: (value) => ({ labelOpacity: value < 0 ? 0.5 : 1 }),
  })
  scene.tokenRow({
    values: ['dogs', 'chase', 'cats'], centerX: 300, y: 240,
    fill: '#18283b', textColor: '#fff', reveal: 0.6,
  })
  return node // Original host geometry, usable for connector anchors.
}
```

Panels default to a container scope with 10 pixels of padding and a 14 pixel
corner radius; pass `scope: 'label'` for a label-only scope. Cards center their
label with a baseline offset of `fontSize * 0.34`. `opacity` affects the whole
card; `labelOpacity` reveals the text independently. Panel and card geometry
remains available at zero opacity. Finite opacity values are clamped to the
range from zero to one before composing fades or token reveals. Non-finite
opacity values throw. Matrices and token rows skip invisible
cells or items. Matrix `format(value, row, column)` and
`cellStyle(value, row, column)` customize individual cells without rebuilding
the component.

`layoutTokenRow(values, options)` returns `{ text, x, width }` items for shared
layout and connector placement. Automatic widths use the literal spelling;
pass `width` for fixed-width cards. `x` takes precedence over `centerX`.
`tokenRow` adds staggered reveal, with each item's opacity equal to
`clamp(reveal * itemCount - index, 0, 1)`. Use `particle({ points, progress,
fill })` to move a marker by route length; endpoints remain unpainted.

`createTeachingCanvas(painter)` adds checked axes, traced curves, scatter plots,
positive bar charts, and explicit-layout flow graphs. Supply a `TeachingPainter`
with the same checked methods plus `math`, `line`, `arrow`, `path`, and `connect`.
Its `connect` method returns `{ from, to }` endpoints. No component bypasses the
host's paint, containment, or opacity checks.

Scatter markers with centers inside the closed data domains remain fully
visible, including points on axis endpoints. Their circles can extend beyond
the axis rectangle; the host audits that complete geometry. Leave room around
the axes or pad the data domains when a surrounding container needs clearance.
Centers outside the data domains are omitted.

```ts
import { createTeachingCanvas, sampleFunction, stableSoftmax } from 'vizmatic'

const charts = createTeachingCanvas(painter)
const plot = charts.axes({
  x: 160, y: 140, width: 640, height: 360,
  xDomain: [-3, 3], yDomain: [0, 1],
  xTicks: [-3, 0, 3], yTicks: [0, 0.5, 1],
  xLabel: 'Input', yLabel: 'Probability', gridColor: '#283447',
})
charts.curve({
  plot, points: sampleFunction(x => 1 / (1 + Math.exp(-x)), -3, 3),
  color: '#63deec', progress: 0.7,
})
charts.bars({
  x: 980, y: 140, width: 480, height: 360,
  values: stableSoftmax([2, 1, 0]), labels: ['cat', 'dog', 'bird'], max: 1,
})
```

Axes return `{ point(x, y), bounds, xDomain, yDomain }`; plot bounds contain the
data marks, while tick labels and titles occupy space outside the plot. Use
`axes({ ..., equalUnits: true })` to preserve angles and distances. This
fits both requested domains at equal pixels per data unit and centers the
resulting plot inside the requested rectangle. Returned bounds, axes, labels,
point projection, and curve clipping use that fitted plot. The default fills
the requested rectangle with independent horizontal and vertical scales. Curves
return the visible mapped polyline and delegate clipping to the checked host.
Scatter omits circles whose complete mark would extend beyond the plot.
Bars accept nonnegative values and return `{ bars, slots, bounds }`, preserving
input indices with `null` for zero-height bars. `slots` describe full-height
columns, including zero values. Progress is clamped to the unit interval.

`flowGraph({ nodes, edges })` takes explicit node bounds and ID-based edges. It
draws edges and optional moving particles behind the cards, then transfers host
geometry metadata onto the connector references. The returned `{ nodes, routes }`
supports subsequent annotations and movement. Keep topic-specific numerical
models in the lesson; share their chart and graph composition through this API.

`transfer` coordinates an attached connector and optional particle. Supply each
painted card and its matching local opacity. Both marks use the minimum endpoint
and edge opacity; a shared host frame scope multiplies that opacity once.

```ts
const route = charts.transfer({
  source: { shape: source, opacity: 1 }, target: { shape: target, opacity: 0.6 },
  progress: 0.5, color: '#63deec', particle: { radius: 9, fill: '#ffce73' },
})
```

Hidden endpoints return `null`; progress outside `(0, 1)` omits the particle.
Gaps clear both cards by the marker/stroke extent plus `margin` (default 2),
preserving larger requests. Coincident centers or insufficient room throw.
The host must anchor rounded cards along their center ray and offset gaps along
that ray. Original routes and shape references retain audit evidence; the host
still checks intervening obstacles.

`grid` uses one panel and `rows + columns - 2` paths. `lineWidth` controls internal
lines; the border uses the host's rectangle stroke. Highlights and literal text
labels stay scoped; label dimensions must match the grid.

Supply `{ x, y, width, height, rows, columns }`; returns
`{ shape, bounds, cells, cell(row, column) }`. Connect to the painted `shape`;
cells are label/math geometry. `layoutCellGrid` returns layout without paint.

`timeline` draws supplied intervals on named lanes. One `time` controls elapsed
fills, completion flags, and the axis cursor. Intervals on the same lane must
not overlap; use separate lanes for concurrent work. Bounds include the lane
labels and time axis. Labels occupy their full planned span above the fill;
omit labels on spans too narrow for the chosen font. Future intervals paint
nothing, and visible interval labels use the same local opacity as their fill.

`allocation` draws a capacity-scaled strip and a value ledger from the same
nonnegative parts. Unused capacity remains visible; over-allocation throws.
Supply bounds tall enough for the header, strip, and one row per part plus Free.
`format` and `unit` apply to the computed totals and ledger values.

```ts
const trace = charts.timeline({
  x: 140, y: 260, width: 1640, height: 300, domain: [0, 100], time: 50,
  lanes: [{ id: 'cpu', label: 'CPU' }, { id: 'gpu', label: 'GPU' }],
  intervals: [
    { id: 'submit', lane: 'cpu', start: 0, end: 20, label: 'Submit' },
    { id: 'kernel', lane: 'gpu', start: 20, end: 80, label: 'Kernel' },
  ],
})
const memory = charts.allocation({
  x: 260, y: 650, width: 1400, height: 370, capacity: 100, unit: 'GB',
  parts: [{ id: 'weights', label: 'Weights', value: 20 },
          { id: 'state', label: 'Optimizer state', value: 30 }],
})
// trace.intervals.kernel.elapsed === 30; memory.remaining === 50
```

Timeline results expose `time`, `point(time)` (the canvas x coordinate), live
lane shapes, and ID-keyed intervals with `shape`, `bounds`, `elapsed`,
`complete`, and local `opacity`.
Zero elapsed time or zero opacity returns a null interval shape. Allocation
returns `used`, `remaining`, capacity-strip `bounds`, `freeBounds`, ordered
part geometry, the painted strip `shape`, and per-part `shapes` (null at zero
area). Connect only to those painted references. `layoutAllocation` computes
pure strip geometry for custom diagrams, with the supplied bounds as the strip.

`createCueTrack` holds one simulation snapshot until an explicit beat cue.
Sample once and derive tables, metrics and decisions from that same snapshot.

```ts
import { createCueTrack } from 'vizmatic'

const cutoffs = createCueTrack({
  initial: { id: 'morning', snapshot: { cutoff: 540, ageHours: 8 } },
  cues: [
    { id: 'noon', beat: 3, at: 0.2, snapshot: { cutoff: 720, ageHours: 3.5 } },
  ],
})
const { id, snapshot } = cutoffs.sample({ beat: state.beat, beatP: state.beatP })
```

Cue IDs are unique and positions increase strictly. Commits are inclusive;
beat-end `1` equals next-beat `0`. End snapshots hold outside the cues. Beats are
nonnegative safe integers; progress is `[0, 1]`. Definitions are copied and result
records frozen; snapshots retain identity without mutation or cloning. Treat
snapshots as immutable. The timeline still owns audio timing and motion.

Numerical helpers include `seededRandom(seed)`, `lerpArray`, `dotProduct`,
`multiplyMatrices`, `stableSoftmax(values, temperature)`, `entropy`,
`normalizeVector`, `sampleFunction`, `gaussian(mean, sigma, x)`, and
`sampleGaussian(random)`. Softmax subtracts the largest logit before scaling;
entropy accepts normalized probabilities; normalization preserves zero vectors.
Seeded sampling makes simulations reproducible during rendering and review.
Camera helpers keep world geometry and screen annotations aligned:

- `interpolateCamera(from, to, progress)` eases a camera's world-space center
  and interpolates zoom logarithmically. Optional `minZoom` and `maxZoom`
  constrain both endpoints.
- `cameraSvgTransform(camera, { width, height })` centers an SVG group on that
  camera. `projectWorldPoint(point, camera, viewport)` applies the same transform
  to a label anchor rendered outside the group.

Keep event progress separate from camera progress when cutting between views.
The event can continue from its previous state while each shot has its own
pan or zoom. Simulation time and camera movement can follow separate timelines.

Use `renderMathSvg` to typeset TeX into standalone SVG paths for a canvas,
figure, or video frame:

```ts
import { renderMathSvg } from 'vizmatic'

const formula = renderMathSvg(String.raw`\frac{\partial L}{\partial W_x} + x^2`, {
  fontSize: 48,
  color: '#63deec',
})
// formula.svg contains glyph paths; width, height, and baseline are pixels.
```

The synchronous renderer supports AMS equations, fractions, subscripts, and
superscripts. It returns baseline metrics for alignment with other labels,
caches formulas, and isolates macro definitions between calls. Invalid TeX
throws an error. SVG paths render with local assets and require no browser or
network access.

## Development

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, testing, visual review, dependency updates, and pull request guidance.

```bash
pnpm install
pnpm verify
pnpm site:serve
```

The homepage, Components page, and Playground share a live component explorer. Choose a component to open its focused example, or use Add to scene to compose several components. Select an element to edit its literal props, add optional properties, duplicate or remove it, and move it within its group. Controls follow inline text and TSX edits. Computed props and expression-generated structure stay editable in the TSX. Preview framing and zoom preserve the full canvas in downloaded PNG and SVG files.

Choose the Freeform canvas template for a positioned builder. Move and resize `CanvasItem` components through the preview handles, use grid snapping, or adjust their literal coordinates in the inspector. Arrow keys nudge a focused handle; Shift makes a larger move and Alt bypasses snapping. The layout remains ordinary `Board` / `CanvasItem` TSX.

Structured data editors let you add, remove, and change pie segments, bar categories, scatter points, and table cells. Nested styles, arrays, and objects also have JSON editors. Invalid shapes and missing graph node references report an error before changing the source. Computed data remains editable in TSX.

Open Canvas and palette to change the frame dimensions, style preset, and any theme color. Choose a transparent, theme, or custom CSS background. These settings are saved in the TSX and participate in undo, project files, share links, and exports. Bare CLI frames support the same metadata:

```tsx
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

Double-click a text label in the preview to edit its literal TSX value. Press Enter or click outside to save, Shift+Enter for a new line, or Escape to cancel. Keyboard users can focus a label and press Enter or F2. Labels derived from computed expressions or ambiguous source values stay editable in the TSX editor.

Choose the Animation scene template to play, pause, scrub time, and export a GIF in the browser. Bare animated source declares `animationDuration = 3` and optionally `animationFps = 10` before setup code. The injected `t` variable is time in seconds; Vizmatic timeline helpers continue to use milliseconds. Gallery timeline animations are adapted to the same browser workflow. Browser GIFs use an opaque canvas fill, with limits of 120 frames, 2 million pixels per frame, and 60 million pixels total. Static CLI render and check evaluate these snippets at `t=0`. Use a CLI animation module for larger animations or transparent GIF output.

The generated `components.json` includes compiler-derived prop types, requiredness, and finite allowed-value references. Shared value lists live in `propEnums`; defaults are not inferred. Full TypeScript definitions remain the contract for structured data and React values.

The website is generated from `docs/*.template.html`, the shared shell in `scripts/site-shell.ts`, and the component registry. Run `pnpm site:build` after editing these sources, then `pnpm docs:check`. Use `pnpm site:serve` for browser validation. The generated agent references, property controls, and example adapters update with the same build. If the bundled fonts change, regenerate the website's WOFF2 files with `pnpm site:fonts` using uv 0.9.17 or newer.

## Publishing

Prepare release commit locally, push it to protected `main`, and wait for required CI before pushing its tag:

```bash
npm version patch --no-git-tag-version
pnpm sync:plugin-versions
pnpm docs:check
git add package.json plugins/vizmatic/.codex-plugin/plugin.json plugins/vizmatic/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "Release v$(node -p "require('./package.json').version")"
git push origin main
# Push annotated vX.Y.Z tag only after CI passes on release commit.
```

Tag push starts GitHub `Release` workflow. It verifies exact commit again, publishes npm provenance, and creates release notes with compare link and commits since previous version. Retry existing tag with `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`. Workflow requires `NPM_TOKEN` repository secret with publish access.

The workflow keeps package version, plugin metadata, tag, release notes, and npm provenance in sync.

## License

MIT
