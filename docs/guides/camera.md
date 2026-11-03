---
title: Camera
nav: Camera
section: Motion
order: 3
description: The camera is a node. Move it, zoom it, or turn it with the same animations as anything else.
---

## Move and zoom

`s.camera` is a node. Its position is the point at the center of the frame. Its `sx` property is the zoom.

```film paired label="The camera zooms into one dot, then pulls back"
import { dot, film, Node, seq, to } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    for (let i = 0; i < 40; i++) {
        s.add(dot(14, i % 7 ? 'dim' : 'yellow').at(-760 + (i % 8) * 216, -360 + Math.floor(i / 8) * 180))
    }
    const look = (x: number, y: number, zoom: number) =>
        to(s.camera, (c: Node) => c.at(x, y).set('sx', zoom), { duration: 1.4 })
    s.play(seq(look(-112, -180, 4), look(0, 0, 1)))
})
```

## Keep titles in place

A pinned node ignores the camera. Use `.pin()` for titles, captions, and readouts that stay on the screen.

```film paired label="A grid slides under a pinned title"
import { film, Node, plane, text, to } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    s.add(plane({ unit: 160 }))
    s.add(text('This title is pinned.', { font: 'text-serif', size: 120 }).at(0, -380).pin())
    s.play(to(s.camera, (c: Node) => c.at(700, 300).set('sx', 1.6), { duration: 2 }))
    s.wait(0.5)
})
```

## Turn the view

Set `rotation` on the camera to turn the view.

```film paired label="The view rotates a quarter turn around the center"
import { film, Node, plane, to } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    s.add(plane({ unit: 200 }))
    s.play(to(s.camera, (c: Node) => c.set('rotation', Math.PI / 2), { duration: 2 }))
    s.wait(0.5)
})
```

Stroke widths scale with the zoom, as if the camera moved closer. For a line that keeps its screen width at every zoom, use a pinned node or set the width from the zoom in a `dynamic` drawing.
