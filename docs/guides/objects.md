---
title: Objects
nav: Objects
section: Objects
order: 1
description: Ready-made math, chart, and computer science objects. Each one is a node, so every animation works on it.
---

## Axes and plots

`axes(options)` draws coordinate axes. `.world(x, y)` converts math coordinates to stage points, and `.plot(f)` draws a function.

```film paired label="A curve on axes with a dot and dashed guides"
import { axes, dashedGuides, draw, fadeIn, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const graph = s.add(axes({ x: [0, 4], y: [0, 16], width: 1300, height: 760, grid: true }))
    const curve = graph.plot((x) => x * x, { stroke: 'blue', width: 7 })
    const dotAt = graph.dotAt(3, 9, 'yellow', 16)
    const guides = dashedGuides(graph, 3, 9)
    graph.add(guides)
    s.play(draw(graph.grid, { lag: 0.02 }), draw(graph.lines), fadeIn(graph.numbers), { duration: 1 })
    s.play(draw(curve))
    s.play(fadeIn(dotAt), fadeIn(guides))
    s.wait(0.8)
})
```

`riemann`, `areaUnder`, `tangentLine`, and `secantLine` work with an `Axes`. `numberLine` draws one axis alone.

```film paired label="Rectangles under a curve grow more numerous and approach the area"
import { axes, draw, fadeIn, film, morph, riemann } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const graph = s.add(axes({ x: [0, 4], y: [0, 16], width: 1300, height: 760 }))
    const f = (x: number) => x * x
    const curve = graph.plot(f, { stroke: 'yellow', width: 6 })
    s.play(draw(graph.lines), fadeIn(graph.numbers), draw(curve), { duration: 1 })
    let bars = riemann(graph, f, { from: 0, to: 4, n: 6 })
    graph.add(bars)
    s.play(fadeIn(bars))
    for (const n of [12, 40]) {
        const next = riemann(graph, f, { from: 0, to: 4, n })
        graph.add(next)
        s.play(morph(bars, next))
        bars = next
    }
    s.wait(0.6)
})
```

## Planes and fields

`plane` draws the classic grid. Its lines are dense paths, so they bend smoothly under `applyMatrix` and `warp`. `complexPlane` and `applyComplex` map the grid through a complex function.

```film paired label="A grid is mapped through the complex square function"
import { applyComplex, complex, complexPlane, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const grid = s.add(complexPlane({ unit: 170, x: [-5, 5], y: [-4, 4] }))
    s.wait(0.2)
    s.play(applyComplex(grid, (re, im) => {
        const [x, y] = complex.pow([re, im], 2)
        return [x / 2.2, y / 2.2]
    }, { duration: 2.6 }))
    s.wait(0.6)
})
```

`vectorField` draws arrows from a function, and `streamLines` draws flowing paths through the same field.

```film paired label="Streamlines flow around a center"
import { fadeIn, film, streamLines, vectorField } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const field = (x: number, y: number): readonly [number, number] => [-y, x]
    const arrows = s.add(vectorField(field, { unit: 150, step: 1, x: [-6, 6], y: [-3, 3] }))
    const flow = s.add(streamLines(field, { unit: 150, x: [-6, 6], y: [-3, 3] }))
    s.play(fadeIn(arrows), fadeIn(flow))
    s.wait(3)
})
```

## Fourier

`fourier(points)` computes rotating circles from a closed outline. `epicycles(terms, options)` draws them, and `fourierPoint` gives the pen position at any fraction of a turn.

The [Fourier film](../films.html) uses these three together.

## Marks

| Object | Use |
|---|---|
| `matrix(rows)` | A bracketed matrix of numbers or TeX. |
| `braceLabel(target, label)` | A curly brace beside a node, with a label. |
| `surroundingBox(target)` | A rounded box around a node. |
| `labeledDot(label)` | A dot with a label, as a graph vertex. |
| `angleMark(vertex, from, to)` | An arc between two rays. |
| `rightAngle(vertex, a, b)` | A square corner mark. |
| `traced(point, from, to)` | The path a moving point left behind. |

```film paired label="A matrix writes itself and a brace labels it"
import { braceLabel, fadeIn, film, matrix, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const m = s.add(matrix([[2, 1], [0, 3]], { size: 130 }))
    s.play(write(m))
    const note = s.add(braceLabel(m, '\\text{a linear map}', { side: 'bottom', size: 72 }))
    s.play(fadeIn(note, { shift: [0, -24] }))
    s.wait(0.8)
})
```

## Charts

`barChart`, `histogram`, `scatter`, `lineChart`, `pie`, `donut`, and `heatmap` take data and expose their parts for animation.

```film paired label="Bars grow up from an axis"
import { barChart, film, grow, lagged } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const chart = s.add(barChart([
        { label: 'A', value: 4 }, { label: 'B', value: 7 }, { label: 'C', value: 5 }, { label: 'D', value: 9 },
    ], { width: 1200, height: 700 }))
    s.play(lagged(chart.bars.map((bar) => grow(bar, { from: bar.bottom })), { lag: 0.2 }), { duration: 1.6 })
    s.wait(0.8)
})
```

## Graphs and networks

`graph(nodes, edges)` draws a node-link diagram, and `tree(root)` lays out a tree. Edges work with `pulse`, so a signal can run along them.

```film paired label="A signal pulses through a small tree"
import { fadeIn, film, pulse, seq, tree } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const t = s.add(tree({ label: 'a', children: [
        { label: 'b', children: [{ label: 'd' }, { label: 'e' }] },
        { label: 'c', children: [{ label: 'f' }] },
    ] }, { levelGap: 210, siblingGap: 170, radius: 46, labelSize: 44 }))
    s.play(fadeIn(t))
    s.play(seq(...t.edges.map((edge) => pulse(edge, { duration: 0.4 }))))
    s.wait(0.4)
})
```

## Code and tokens

`codeBlock(source)` draws syntax-colored code as glyphs. `morphCode(a, b)` morphs one version into another, and tokens that stayed travel to their new places. `tokens(items)` draws a row of labeled cells for language models, and `attentionMatrix` draws a heatmap with labels.

```film paired label="One line of code morphs into a longer version"
import { codeBlock, film, morphCode, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const a = s.add(codeBlock('const area = w * h', { size: 70 }))
    const b = codeBlock('const area = (w * h) / 2', { size: 70 })
    s.play(write(a))
    s.play(morphCode(a, b))
    s.wait(0.8)
})
```

`arrayCells(values)` draws a row of cells for algorithms, and `neuralNet(layers)` draws a layered network whose edges you can pulse.
