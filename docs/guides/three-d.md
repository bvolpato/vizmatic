---
title: 3D
nav: 3D
section: Motion
order: 4
description: A 3D scene is a node. It projects meshes, curves, and points to vector paths on every frame, so a browser and an export draw the same picture.
---

## A scene and a camera

`scene3d(options)` creates a view. Add 3D objects to it, and add the scene to the stage. `phi` is the angle down from straight overhead, and `theta` is the rotation around the vertical axis. Both live on the timeline.

```film paired label="A wave-like surface turns under a rotating camera"
import { axes3d, fadeIn, film, scene3d, surface } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const view = s.add(scene3d({ phi: 1.1, theta: -0.6, unit: 130 }))
    view.add(axes3d({ x: [-3, 3], y: [-3, 3], z: [-1, 2] }))
    const hill = surface((x, y) => Math.sin(x) * Math.cos(y), {
        x: [-3, 3], y: [-3, 3], resolution: 36, colors: ['blue', 'teal', 'yellow'],
    })
    view.add(hill)
    s.play(fadeIn(hill))
    s.play(view.orbit({ theta: 1.4 }, { duration: 4 }))
})
```

## Surfaces

`surface(f)` draws a height field. `parametricSurface(fn, u, v)` draws any shape from two parameters, and `sphere(radius)` draws a sphere. Faces sort from back to front on every frame, and they shade from a light you can move.

```film paired label="A shaded torus turns slowly"
import { fadeIn, film, parametricSurface, scene3d } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const view = s.add(scene3d({ phi: 1, theta: 0.4, unit: 170 }))
    const torus = parametricSurface((u, v) => [
        (2 + 0.8 * Math.cos(v)) * Math.cos(u),
        (2 + 0.8 * Math.cos(v)) * Math.sin(u),
        0.8 * Math.sin(v),
    ], [0, Math.PI * 2], [0, Math.PI * 2], { resolution: 36, colors: ['purple', 'blue'] })
    view.add(torus)
    s.play(fadeIn(torus))
    s.play(view.orbit({ theta: Math.PI }, { duration: 5 }))
})
```

## Curves, points, and trails

`curve3d(f, from, to)` draws a curve in space. `line3d`, `vector3d`, `points3d`, and `point3d` draw marks. `trail3d(point, from, to)` keeps the recent path of a moving point, and `label3d` places text that faces the camera.

```film paired label="A helix draws itself in space"
import { axes3d, curve3d, draw, film, scene3d } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const view = s.add(scene3d({ phi: 1.15, theta: -0.8, unit: 120 }))
    view.add(axes3d({ x: [-3, 3], y: [-3, 3], z: [-3, 3] }))
    const helix = curve3d((t) => [Math.cos(t) * 2, Math.sin(t) * 2, t / 4 - 1.5], 0, Math.PI * 6, { color: 'yellow', width: 5 })
    view.add(helix)
    s.play(draw(helix, { duration: 3 }))
    s.wait(0.6)
})
```

## Why it uses no GPU

Each frame projects the 3D objects to ordinary paths. The same code paints to a canvas in the browser and to a rasterizer during export, so the two match. Large meshes cost more than they would on a GPU. Keep `resolution` near what the frame needs, because a mesh of 40 by 40 cells is 1600 faces.

See the [gradient descent film](../films.html) for a surface with real iterates, and the [Lorenz film](../films.html) for trails.
