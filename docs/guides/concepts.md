---
title: Core concepts
nav: Core concepts
section: Start
order: 2
description: A film is a function that writes keys on a timeline. Any frame can then be sampled at any time, in any order.
---

## The stage

The stage is a coordinate space. The origin is the center of the frame, and y points down. The default stage is 1920 by 1080 units. You always author in these units, and the export width only changes how many pixels each unit gets.

```film paired label="A dot moves to each corner of the stage in turn"
import { dot, film, moveTo, seq } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const d = s.add(dot(40, 'yellow'))
    const corner = (x: number, y: number) => moveTo(d, [x, y], { duration: 0.6 })
    s.play(seq(
        corner(800, -400), corner(800, 400),
        corner(-800, 400), corner(-800, -400),
        corner(0, 0),
    ))
})
```

The stage also gives you `s.left`, `s.right`, `s.top`, and `s.bottom`, which are the edges in stage units.

## Nodes

Everything visible is a `Node`. A node with a path draws that path. A node with children groups them. Setter methods chain, so setup reads as one line.

```ts
import { circle, group, text } from 'vizmatic/stage'

const ring = circle(120, { stroke: 'blue', width: 4 }).glow(8)
const label = text('radius', { size: 36, color: 'dim' }).nextTo(ring, 'down', 24)
export const figure = group(ring, label).at(-300, 0)
```

Text and equations are also nodes. Each glyph is a child, so you can animate one letter or one term of an equation.

## The timeline

`s.play(...)` does not wait. It records keys on the timeline and moves the cursor forward, and your function finishes almost at once. Animations passed to one `s.play` run together. Use `seq` and `lagged` to arrange them in time.

```film paired label="Three squares fade in one after another while a label writes"
import { fadeIn, film, lagged, rect, text, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const boxes = [-400, 0, 400].map((x) =>
        rect(260, 260, { fill: 'teal', stroke: null, radius: 16 }).at(x, -60))
    const label = text('one play, two animations', { size: 72 }).at(0, 240)

    s.play(lagged(boxes.map((box) => fadeIn(box, { shift: [0, 40] }))), write(label))
    s.wait(1)
})
```

Because the function finishes before the first frame, code after a `play` sees the end state. This is why `eq.nextTo(graph)` is correct even when `graph` is still animating on screen.

## Why frames are pure

When the function returns, the film is compiled. A frame is then only a function of time: `film.frame(t)`. Nothing replays and nothing accumulates.

This gives you some useful properties:

- Seeking is immediate in both directions. On the [home page](../index.html), your scroll bar sets the time.
- Export can run frames on many threads, in any order, and encode them in sequence.
- Output is deterministic. The same source gives the same frames.

## Values and dynamic drawings

A `Value` is a number on the timeline. A `dynamic` node rebuilds its drawing on every frame from whatever it reads. Together they let geometry follow a number, as a secant follows its increment.

```film paired label="A sine wave whose frequency rises as a readout counts up"
import { axes, decimal, dynamic, film, Node } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const k = s.value(1)
    const graph = s.add(axes({ x: [0, 6.3], y: [-1.5, 1.5], width: 1300, height: 560, labels: false }).at(0, 60))
    s.add(dynamic(() => new Node(graph.plotPath((x) => Math.sin(k.value * x)))
        .stroke('yellow', 6).at(graph.get('x'), graph.get('y'))))
    s.add(decimal(() => k.value, { prefix: 'k = ', size: 72 }).at(0, -380))

    s.play(k.to(5, { duration: 3 }))
    s.play(k.to(1, { duration: 2 }))
})
```

A drawing inside `dynamic` should read values and return nodes. It should not change anything else, because it can run for any time in any order.

## Updaters

`s.update(node, fn)` runs a function on each frame and can set properties on a node that is already on stage. Use it when one node should follow another, without rebuilding geometry.

```ts
import { dot, film, moveTo, text } from 'vizmatic/stage'

export default film((s) => {
    const a = s.add(dot(20, 'yellow').at(-500, 0))
    const label = s.add(text('here', { size: 48 }))
    s.update(label, (node) => node.nextTo(a, 'up', 24))
    s.play(moveTo(a, [500, 0], { duration: 2 }))
})
```

## Assets load themselves

Fonts and the TeX engine load the first time a film asks for them. The compiler catches the request, waits, and then runs your function again. This is why a build function should have no side effects other than authoring on the stage.
