---
title: Looks and color
nav: Looks and color
section: Style
order: 1
description: A look is a complete art direction. Write color names in your film, and render the same source in any look.
---

## Names, not values

Write `'yellow'` or `'ink'` in your film. Each look gives those names its own values, so one film renders correctly in every look.

```film paired label="An equation and a curve in the current look"
import { axes, draw, film, tex, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const graph = s.add(axes({ x: [-3, 3], y: [-1, 5], width: 900, height: 700, grid: true, labels: false }).at(-380, 0))
    const curve = graph.plot((x) => 0.5 * x * x, { stroke: 'teal', width: 6 })
    const eq = s.add(tex('y = \\tfrac{1}{2} x^2', { size: 110, color: 'yellow' }).at(520, 0))
    s.play(draw(graph.lines), draw(curve), write(eq))
    s.wait(1)
})
```

This page follows the site theme. Switch the theme at the top of the page and the film above recompiles in the other look.

## The looks

| Look | Character |
|---|---|
| `midnight` | Deep neutral black with luminous pigments. The default. |
| `paper` | Warm paper and printed ink, for articles and print. |
| `blueprint` | Drafting-table navy with cool cyan linework. |
| `chalk` | Near-black green with warm chalk, for lessons. |
| `neon` | Saturated light on pure black, for trailers. |

Choose a look in the film, or override it when you render.

```ts
import { film, text, write } from 'vizmatic/stage'

export default film({ look: 'blueprint', title: 'Plans' }, (s) => {
    s.play(write(s.add(text('Plans', { font: 'serif', size: 200 }))))
})
```

```bash
npx vizmatic film my-film.ts --look midnight,paper
```

## The tokens

Each look defines `bg`, `surface`, `ink`, `dim`, `faint`, `grid`, `gridStrong`, `blue`, `teal`, `green`, `yellow`, `gold`, `orange`, `red`, `pink`, and `purple`. A CSS color also works anywhere a token does, and it stays fixed across looks.

## Gradients

`colorAlong` colors a stroke along its length. `linearGradient` and `radialGradient` fill shapes. `ramp(n, a, b)` gives `n` evenly mixed colors for a list of items. Colors mix in the OKLab color space, so blends stay bright and even.

```film paired label="A curve whose color travels along its length"
import { colorAlong, draw, film, parametric } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const curve = parametric((u) => [-800 + 1600 * u, Math.sin(u * 12) * 320 * (1 - u * 0.5)], 0, 1, {
        stroke: colorAlong('blue', 'teal', 'yellow', 'orange', 'pink'), width: 12,
    })
    s.play(draw(curve), { duration: 2 })
    s.wait(0.8)
})
```

## Light

`.glow(radius)` adds soft light around one shape. A look's `bloom` lets every bright mark spill a little light across the frame. Set `bloom` on the film to change it, and use `0` to turn it off. Looks on a light ground have no bloom.

```film paired label="A ring with a strong glow beside one with none"
import { circle, draw, film } from 'vizmatic/stage'

export default film({ fps: 30, bloom: 0.3 }, (s) => {
    const lit = circle(260, { stroke: 'yellow', width: 10 }).glow(40).at(-380, 0)
    const flat = circle(260, { stroke: 'yellow', width: 10 }).at(380, 0)
    s.play(draw(lit), draw(flat))
    s.wait(1)
})
```

## Make your own

A look is a plain object. Pass it as `look` on the film.

```ts
import { film, midnight, text, write, type Look } from 'vizmatic/stage'

const studio: Look = {
    ...midnight,
    name: 'studio',
    background: '#101418',
    colors: { ...midnight.colors, bg: '#101418', yellow: '#f6c945' },
}

export default film({ look: studio }, (s) => {
    s.play(write(s.add(text('Our colors', { font: 'serif', size: 200, color: 'yellow' }))))
})
```
