# Vizmatic Agent Prompt

Use Vizmatic to create polished, theme-aware diagrams, figures, dashboards, presentation frames, and animated GIFs from structured React scene primitives.

## Install

Use the package manager already present in the project.

```bash
pnpm add vizmatic react
```

If the npm package is not available yet, install from GitHub:

```bash
pnpm add github:bvolpato/vizmatic react
```

For npm/yarn/bun projects, use the equivalent package-manager command.

## Create a frame

Create `frames/agent-pipeline.tsx`:

```tsx
import React from "react"
import {
  CalloutCard,
  defineIllustration,
  Flow,
  Row,
  Scene,
} from "vizmatic"

export const width = 1040
export const height = 560

const frame = defineIllustration((c) => (
  <Scene
    c={c}
    title="Agent visual pipeline"
    subtitle="prompt -> scene spec -> verified artifact"
    gap={26}
  >
    <Flow
      c={c}
      connectorTone="purple"
      stages={[
        {
          eyebrow: "input",
          title: "Prompt",
          subtitle: "intent and constraints",
          tone: "blue",
          lines: ["domain language", "audience", "theme tokens"],
          width: 190,
        },
        {
          eyebrow: "contract",
          title: "Scene spec",
          subtitle: "typed structure",
          tone: "purple",
          lines: ["cards", "flows", "charts", "tables"],
          width: 190,
        },
        {
          eyebrow: "render",
          title: "Satori frame",
          subtitle: "React primitives",
          tone: "cyan",
          lines: ["layout defaults", "safe text", "semantic tones"],
          width: 190,
        },
        {
          eyebrow: "output",
          title: "PNG / GIF",
          subtitle: "CI-ready asset",
          tone: "green",
          lines: ["autocrop", "overflow checks", "retina scale"],
          width: 190,
        },
      ]}
    />
    <Row width="100%" gap={14}>
      <CalloutCard
        c={c}
        title="Model writes structure"
        detail="No hand-written SVG paths or brittle x/y layout for common cases."
        tone="purple"
        width={470}
      />
      <CalloutCard
        c={c}
        title="Design system stays in control"
        detail="Theme tokens decide color, typography, radius, spacing, and contrast."
        tone="green"
        width={470}
      />
    </Row>
  </Scene>
))

export const create = frame.create
export default frame.default
```

Render it:

```bash
pnpm exec vizmatic render frames --out public/vizmatic --theme dark,light --brand "Your Product"
```

Render animated frames with `createScenes(theme)`:

```bash
pnpm exec vizmatic gif frames/animated-pipeline.tsx --out public/vizmatic --theme dark,light --brand "Your Product" --scale 1
```

## Create an animated frame

Animated frames keep the same static `create(theme)` export and add `createScenes(theme)` for GIF output.

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

## Pick primitives first

Use Vizmatic primitives instead of raw SVG or absolute-positioned divs whenever possible.

- Layout: `Scene`, `Row`, `Column`, `Panel`, `Card`, `WindowFrame`.
- Process visuals: `Flow`, `Pipeline`, `StepCard`, `FlowArrow`, `CalloutCard`.
- Networks and graphs: `LayeredNetwork`, `GraphDiagram`.
- Data visuals: `BarChart`, `LineChart`, `ScatterPlot`, `QuadrantChart`, `MiniBarChart`, `StackedBar`, `IntervalPlot`.
- Tables and matrices: `DataTable`, `Grid`, `Matrix`, `Heatmap`, `TiledMatrix`.
- UI/data cards: `MetricCard`, `ProgressList`, `StatusList`, `KeyValueList`, `Comparison`, `CodeBlock`, `EquationCard`.
- Labels and helpers: `TextLabel`, `BadgePill`, `ToneStrip`, `Legend`, `SvgFrame`, `SvgPoint`, `VectorArrow`.

Drop to raw SVG only for custom geometry that a primitive cannot express.

## Quality rules

- Use semantic tones, not hard-coded colors: `blue`, `purple`, `green`, `warm`, `cyan`, `pink`, `critical`, `ocean`, `neutral`.
- Keep canvas sizes explicit. Good defaults: `1040x560` for article figures, `1280x720` for slide frames, `900x520` for compact diagrams.
- Use `width`, `minWidth`, `height`, `minHeight`, `gap`, and `padding` props to stabilize layout.
- Keep text short. Use `TextLabel`, `Panel`, `StepCard`, `MetricCard`, `DataTable`, and `Grid` for wrapping-safe labels.
- Render both dark and light when shipping reusable assets: `--theme dark,light`.
- Use GIF only when motion explains state change. Keep scenes short, export `createScenes(theme)`, and keep a static `create(theme)` fallback.
- If render fails with `Canvas overflow detected`, increase canvas dimensions or reduce content density. Do not ignore the error.
- Verify generated PNGs/GIFs exist and are non-empty. Open at least one rendered image before finalizing.

## Common recipes

### RAG graph

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

## Final answer checklist

After creating a Vizmatic visual, report:

- files created or changed
- render command used
- output image paths, including GIF paths when generated
- whether dark/light variants rendered
- any overflow or layout fixes made
