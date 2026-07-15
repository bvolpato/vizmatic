# Vizmatic Patterns

## Primitive Choice

- Linear workflow: `Flow` with 3-5 stages. Add `CalloutCard` or `MetricCard` below for key details.
- Branching system: `GraphDiagram` with explicit `x` and `y` positions. Keep labels under 24 characters.
- Dashboard or report figure: `MetricCard`, `DonutChart`, `BarChart`, `LineChart`, `DataTable`, and `ProgressList`.
- Architecture layers: `LayeredNetwork`, `Pipeline`, `Panel`, `TileGrid`, and `StatusList`.
- Model internals: `Matrix`, `Heatmap`, `TiledMatrix`, `AxisPlot`, and `ScatterPlot`.
- Timeline or schedule: `Timeline`, `IntervalPlot`, `ProgressRow`, `StatusRow`, and `BadgePill`.
- Hierarchy or ownership: `TreeDiagram` for parent/child structure; use `GraphDiagram` when edges are non-hierarchical.
- Small visual anchors: `Icon` inside cards, callouts, compact rows, and presentation frames.
- Code or terminal state: `WindowFrame`, `CodeBlock`, `KeyValueList`, and `StatusList`.

## Bare Static Frame

Omit dimensions during exploration if content size is uncertain; the CLI starts at `960x540` and grows omitted axes on overflow. Add explicit dimensions when final output size matters.
`Scene` title/subtitle are optional. Omit them for visual-only figures, badges, or inline article diagrams.

```tsx
width = 1040;
height = 560;

<Scene title="Agent pipeline" subtitle="intent -> scene -> asset">
  <Flow stages={[
    { title: "Prompt", subtitle: "goal", tone: "blue" },
    { title: "Scene", subtitle: "structure", tone: "purple" },
    { title: "Render", subtitle: "PNG/GIF", tone: "green" },
  ]} />
</Scene>
```

For minimal engineering-blog figures, add `preset = "engineering";` before the
dimensions and render `--theme light`. The preset uses a light gray palette,
left-aligned title, flat pastel nodes, thin connectors, and mono annotations.
Add `background={c.bg}` for an opaque canvas; omit it for alpha transparency.
Keep the figure to one architectural transition or tradeoff.

## Full Module Frame

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
        { title: "Ship", tone: "green" },
      ]} />
    </Scene>
  )
}

export default create("dark")
```

## Render Commands

```bash
# alpha-transparent PNG/SVG background
vizmatic ./frames/frame.tsx --out ./public/vizmatic --theme dark,light

# opaque theme background
vizmatic ./frames/frame.tsx --out ./public/vizmatic --theme dark,light --background theme

vizmatic frames --out ./public/vizmatic --theme dark,light --watermark "Product"
vizmatic gif ./frames/animated.tsx --out ./public/vizmatic --theme dark,light --scale 1
```

## Quality Checklist

- Rendered files exist for expected themes.
- Text does not clip, overlap, or shrink below readability.
- Dark and light themes both have enough contrast.
- Output filenames and destination match the repo's docs/app conventions.
- Final response includes paths and render command.
