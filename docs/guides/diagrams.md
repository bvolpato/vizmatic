---
title: Diagrams and density
nav: Diagrams and density
section: Diagrams
order: 1
description: The TSX component library draws static figures. It packs a page of facts into a frame by default, and it renders larger when you are presenting.
---

## Two engines, one package

Films use the stage engine, which is vector animation from TypeScript functions. Figures use the component library, which lays out TSX elements and renders PNG, SVG, and GIF.

Use a figure when the reader studies the picture. Use a film when the change over time is the point.

```bash
npx vizmatic ./architecture.tsx --out ./figures --theme dark,light --format both
```

The [component explorer](../components.html) shows every component with live controls, and the [diagram builder](../playground.html) arranges them on a canvas.

## Titles are optional

A scene takes a title and a subtitle, and both are optional. Leave them out when the surrounding page already names the figure, and add a title when the visual needs them.

## A rich node

Graph nodes can carry more than a title. A node can have key and value rows, metrics with small trend lines, tags, an owner, and a footer. A reader then gets the facts from the figure without a second document.

```tsx
import { getThemeColors, GraphDiagram, Scene, type GraphDiagramEdge, type GraphDiagramNode, type ThemeMode } from 'vizmatic'

const nodes: GraphDiagramNode[] = [
    {
        id: 'api', label: 'Checkout API', detail: 'Go, 3 regions', icon: 'server', tone: 'blue', status: 'ok',
        rows: [{ key: 'replicas', value: '48' }, { key: 'deploy', value: 'blue/green' }],
        metrics: [{ label: 'p95', value: '184 ms' }, { label: 'errors', value: '0.02%' }],
    },
    { id: 'db', label: 'Orders', detail: 'Postgres 16', icon: 'database', tone: 'green' },
]
const edges: GraphDiagramEdge[] = [{ from: 'api', to: 'db', label: 'SQL, 2.1k/s' }]

export const width = 960
export const height = 420

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title="Checkout">
            <GraphDiagram c={c} nodes={nodes} edges={edges} width={900} height={320} />
        </Scene>
    )
}
```

## Density

Every component reads its type, spacing, strokes, and corner radius from one set of tokens. One source can render as a dense engineering figure or as a slide.

| Density | Use |
|---|---|
| `dense` | The default. Small type at 10 to 12 px, hairlines, and tight gutters. |
| `compact` | A little more air, for docs and dashboards. |
| `comfortable` | The sizes the components were first designed at. |
| `presentation` | Large type and strokes, for a room. |
| a number | A direct scale. `0.9` is slightly dense, and `1.25` is large. |

Set it on a scene.

```tsx
import { CalloutCard, getThemeColors, Scene, type ThemeMode } from 'vizmatic'

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title="Same content, larger" density="presentation">
            <CalloutCard c={c} title="Density is one prop" detail="Nothing else in the source changes." />
        </Scene>
    )
}
```

Or set it for a whole render.

```ts
import { renderToPng } from 'vizmatic'
import type { ReactElement } from 'react'

export async function renderBoth(figure: ReactElement): Promise<void> {
    await renderToPng(figure, { width: 1400, height: 800, outputPath: 'figure.png', density: 'dense' })
    await renderToPng(figure, { width: 1400, height: 800, outputPath: 'slide.png', density: 'presentation' })
}
```

## Check before you publish

`vizmatic check` reports overflow, contrast, small text, overlapping labels, and connector congestion. It works in both themes and can write JSON.

```bash
npx vizmatic check ./architecture.tsx --theme dark,light --json
```

## Keep the source

A figure is a TSX file. Keep it beside the document it illustrates, review it in a pull request, and render it in CI. Dark and light come from the same file.
