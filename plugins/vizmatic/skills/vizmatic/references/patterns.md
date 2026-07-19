# Vizmatic patterns

## Choose a primitive

- Linear workflow: `Flow` with 3-5 stages. Add `CalloutCard` or `MetricCard` only when the flow needs supporting detail.
- Branching system: `GraphDiagram` with explicit `x` and `y` positions. Keep labels under 24 characters.
- Dashboard or report figure: `MetricCard`, `DonutChart`, `BarChart`, `LineChart`, `DataTable`, and `ProgressList`.
- Architecture layers: `LayeredNetwork`, `Pipeline`, `Panel`, or `TileGrid`.
- Model internals: `Matrix`, `Heatmap`, `TiledMatrix`, `AxisPlot`, and `ScatterPlot`.
- Timeline or schedule: `Timeline`, `IntervalPlot`, `ProgressRow`, `StatusRow`, and `BadgePill`.
- Hierarchy or ownership: `TreeDiagram` for parent/child structure; use `GraphDiagram` when edges are non-hierarchical.
- Small visual anchors: `Icon` inside cards, callouts, compact rows, and presentation frames.
- Code or terminal state: `WindowFrame`, `CodeBlock`, `KeyValueList`, and `StatusList`.

## Bare static frame

Omit dimensions while content is changing. The CLI starts at `960x540` and grows an omitted axis when content overflows. Add explicit dimensions for fixed output.

`Scene` title and subtitle are optional. Omit them for badges, inline figures, or pages that already provide a caption.

```tsx
width = 1040;
height = 560;

<Scene title="Agent pipeline" subtitle="intent -> scene -> output">
  <Flow stages={[
    { title: "Prompt", subtitle: "goal", tone: "blue" },
    { title: "Scene", subtitle: "structure", tone: "purple" },
    { title: "Render", subtitle: "PNG/GIF", tone: "green" },
  ]} />
</Scene>
```

For flat technical article figures, add `preset = "engineering";` before the dimensions and render `--theme light`. Add `background={c.bg}` for an opaque canvas. Omit it for transparency.

## Full module frame

Use the full module form when the frame needs loops, helper functions, data loading, reusable components, non-Vizmatic imports, or animation.

```tsx
import React from "react"
import { Flow, Scene, getThemeColors, type ThemeMode } from "vizmatic"

export const width = 1040
export const height = 560

export function create(theme: ThemeMode = "dark") {
  const c = getThemeColors(theme)
  return (
    <Scene c={c} title="Runtime path">
      <Flow c={c} stages={[
        { title: "Input", tone: "blue" },
        { title: "Check", tone: "purple" },
        { title: "Output", tone: "green" },
      ]} />
    </Scene>
  )
}

export default create("dark")
```
