# Vizmatic patterns

## Choose a primitive

- Linear workflow: `Flow` with 3-5 stages. Add `CalloutCard` or `MetricCard` only when the flow needs supporting detail.
- System architecture or branching system: `GraphDiagram` with automatic layout, nested `groups`, technical `icon` names, and labeled relationship kinds. Keep labels under 24 characters.
- Dashboard or report figure: `MetricCard`, `DonutChart`, `BarChart`, `LineChart`, `DataTable`, and `ProgressList`.
- Architecture layers and deployment boundaries: nested `GraphDiagram` groups. Use `LayeredNetwork` only for dense repeated layers.
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

## Animated timeline

Use a typed timeline when motion should interpolate values instead of crossfading hand-authored frames. Timeline steps run sequentially; properties in one `tween` move together. `parallel` supports staggered property tracks. Keep nodes and labels fixed, move semantic objects, and let Vizmatic rasterize interpolated positions without coarse snapping. Prefer 10, 20, 25, or 50 FPS and align durations to each frame interval. Keep `create(theme)` as static fallback.

```tsx
import React from "react"
import { Scene, defineAnimation, getThemeColors, hold, tween, type ThemeMode } from "vizmatic"

export const width = 1040
export const height = 560

function frame(theme: ThemeMode, progress: number) {
  const c = getThemeColors(theme)
  return (
    <Scene c={c} title="Chunk transfer">
      <div style={{ display: "flex", position: "relative", width: "100%", height: 260 }}>
        <div style={{ display: "flex", position: "absolute", left: 40 + progress * 760, top: 90 }}>
          chunk
        </div>
      </div>
    </Scene>
  )
}

export function createAnimation(theme: ThemeMode) {
  return defineAnimation({
    initial: { progress: 0 },
    timeline: [hold(500), tween({ progress: 1 }, { duration: 900, easing: "ease-in-out" }), hold(500)],
    fps: 20,
    render: (state) => frame(theme, state.progress),
  })
}

export function create(theme: ThemeMode = "dark") {
  return frame(theme, 1)
}

export default create("dark")
```

```bash
vizmatic gif ./frames/chunk-transfer.tsx --out ./public/vizmatic --theme dark,light --fps 20
```
