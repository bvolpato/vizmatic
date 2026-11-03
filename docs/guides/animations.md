---
title: Animations
nav: Animations
section: Motion
order: 1
description: Every animation in the library, each with a small live demo. Pass any of these to s.play.
---

Each animation takes optional `duration` and `ease` settings. Without them it uses a length that suits it and the `smooth` ease.

## Reveal

### draw

`draw` traces strokes in order. Filled shapes outline first and then fill.

```film paired label="A circle and an arrow draw themselves"
import { arrow, circle, draw, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const ring = circle(300, { stroke: 'blue', width: 10 }).at(-300, 0)
    const pointer = arrow([100, 220], [750, -220], { stroke: 'yellow', width: 12, tip: 60 })
    s.play(draw(ring), draw(pointer), { duration: 1.6 })
    s.wait(1)
})
```

### write

`write` handwrites text and equations. Each glyph is outlined and then filled, with a small lag between glyphs.

```film paired label="An equation handwrites itself"
import { film, tex, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const eq = s.add(tex('e^{i\\pi} + 1 = 0', { size: 190 }))
    s.play(write(eq, { duration: 2 }))
    s.wait(1)
})
```

### fadeIn and fadeOut

Fades can also travel with `shift` and change size with `scale`. With `lag`, a group fades in child by child.

```film paired label="A word rises into place, holds, and sinks away"
import { fadeIn, fadeOut, film, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const word = text('arrive', { font: 'serif', size: 280 })
    s.play(fadeIn(word, { shift: [0, 90], lag: 0.1, duration: 1.2 }))
    s.wait(0.6)
    s.play(fadeOut(word, { shift: [0, -90] }))
})
```

### grow

`grow` scales up from nothing. Pass `from` to grow out of a point, such as the tail of an arrow.

```film paired label="An arrow grows out of its tail point"
import { arrow, dot, film, grow } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    s.add(dot(22, 'ink').at(-600, 200))
    const pointer = arrow([-600, 200], [600, -200], { stroke: 'teal', width: 18, tip: 80 })
    s.play(grow(pointer, { from: [-600, 200], duration: 1.2 }))
    s.wait(1)
})
```

### erase

`erase` is the reverse of `draw`.

```film paired label="A wave draws and then erases along its length"
import { draw, erase, film, parametric } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const wave = parametric((u) => [-800 + 1600 * u, Math.sin(u * 14) * 220], 0, 1, { stroke: 'pink', width: 10 })
    s.play(draw(wave))
    s.wait(0.4)
    s.play(erase(wave))
})
```

`appear` and `vanish` show or hide a node with no transition.

## Change

### to

`to` animates any change. Make the change inside the callback, and the engine interpolates from the old state to the new one.

```film paired label="A dot moves, changes color, and grows in one motion"
import { dot, film, to } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const d = s.add(dot(70, 'blue').at(-550, 150))
    s.play(to(d, (n) => n.at(550, -150).color('yellow').scale(2.4), { duration: 1.5 }))
    s.wait(0.8)
})
```

### moveTo, shift, scaleBy, rotate, recolor, fade

These are short forms of `to` for one kind of change.

```film paired label="A square moves, turns, grows, and changes color in order"
import { film, moveTo, recolor, rect, rotate, scaleBy, seq } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const box = s.add(rect(240, 240, { fill: 'teal', stroke: null, radius: 12 }).at(-600, 0))
    s.play(seq(
        moveTo(box, [0, 0]),
        rotate(box, Math.PI / 2),
        scaleBy(box, 1.8),
        recolor(box, 'orange'),
    ))
    s.wait(0.6)
})
```

### along

`along` follows a path or the shape of another node. Set `orient` to turn the node along the way.

```film paired label="A triangle follows a figure-eight path and turns with it"
import { along, film, parametric, regularPolygon } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const road = s.add(parametric((t) => [Math.sin(t) * 700, Math.sin(t * 2) * 320], 0, Math.PI * 2, { stroke: 'grid', width: 6 }))
    const rider = s.add(regularPolygon(3, 48, { fill: 'yellow', stroke: null }).rotate(Math.PI / 2))
    s.play(along(rider, road, { orient: true, duration: 4 }))
})
```

### morph

`morph` turns one shape into another. Afterwards the target is on stage and the source is hidden, so later code always refers to the node you can see.

```film paired label="A square morphs into a circle and then into a letter"
import { circle, film, morph, rect, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const a = s.add(rect(520, 520, { fill: 'blue', stroke: null }))
    const b = circle(290, { fill: 'teal', stroke: null })
    const c = text('v', { font: 'serif', size: 900, color: 'yellow' })
    s.play(morph(a, b))
    s.wait(0.3)
    s.play(morph(b, c))
    s.wait(0.6)
})
```

### morphMatching

`morphMatching` morphs equations and labels by meaning. Glyphs on both sides travel to their new places, and the rest fade where they stand.

```film paired label="An equation rearranges as its terms travel"
import { film, morphMatching, tex, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const a = s.add(tex('a^2 + b^2 = c^2', { size: 150 }))
    s.play(write(a))
    const b = tex('a^2 = c^2 - b^2', { size: 150 })
    s.play(morphMatching(a, b, { duration: 1.6 }))
    s.wait(0.8)
})
```

### warp and applyMatrix

`warp` deforms shapes through any function of stage position. `applyMatrix` is the linear case.

```film paired label="A square grid shears under a matrix"
import { applyMatrix, film, plane } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const grid = s.add(plane({ unit: 200 }))
    s.wait(0.3)
    s.play(applyMatrix(grid, [[1, 1], [0, 1]], { duration: 2 }))
    s.wait(0.8)
})
```

```film paired label="A square grid bends under a smooth function of position"
import { film, plane, warp } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const grid = s.add(plane({ unit: 180 }))
    s.play(warp(grid, (x, y) => [x + Math.sin(y / 170) * 120, y + Math.sin(x / 170) * 120], { duration: 2.4 }))
    s.wait(0.8)
})
```

## Emphasis

These leave a node as they found it.

### indicate

```film paired label="One term of an equation swells and turns yellow, then returns"
import { film, indicate, tex } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const eq = s.add(tex('E = m c^2', { size: 190 }))
    s.wait(0.3)
    s.play(indicate(eq.part('c^2'), { scale: 1.3 }))
    s.wait(0.6)
})
```

### shake

```film paired label="A warning word shakes"
import { film, shake, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const word = s.add(text('careful', { font: 'serif', size: 300, color: 'red' }))
    s.wait(0.3)
    s.play(shake(word, { angle: 0.12 }))
    s.wait(0.6)
})
```

### circumscribe

```film paired label="A lit line traces around a word and runs off"
import { circumscribe, film, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const word = s.add(text('this one', { font: 'serif', size: 260 }))
    s.wait(0.2)
    s.play(circumscribe(word, { pad: 40, width: 7 }))
    s.wait(0.4)
})
```

### flash and ripple

```film paired label="A burst of rays and an expanding ring at a point"
import { dot, film, flash, ripple } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    s.add(dot(30, 'yellow'))
    s.play(flash([0, 0], { radius: 320, rays: 14 }))
    s.play(ripple([0, 0], { radius: 460, width: 8 }))
    s.wait(0.3)
})
```

### pulse

`pulse` sends a short lit segment along a line: a packet on an edge, or a signal on a wire.

```film paired label="A lit pulse travels down a curved line"
import { film, parametric, pulse } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const wire = s.add(parametric((u) => [-800 + 1600 * u, Math.sin(u * 7) * 200], 0, 1, { stroke: 'grid', width: 10 }))
    s.play(pulse(wire, { width: 16, glow: 20, duration: 1.6 }))
    s.wait(0.2)
})
```

## Composition

### par, seq, and lagged

`par` runs animations together. `seq` runs them in order. `lagged` starts each one after a fraction of the previous one has played.

```film paired label="A row of dots fades in as a wave from left to right"
import { dot, fadeIn, film, lagged } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const dots = Array.from({ length: 13 }, (_, i) => dot(30, 'teal').at(-720 + i * 120, Math.sin(i * 0.8) * 180))
    s.play(lagged(dots.map((d) => fadeIn(d, { scale: 0.1 })), { lag: 0.25 }), { duration: 2 })
    s.wait(0.8)
})
```

### delay, retime, and call

`delay` waits before an animation begins. `retime` changes the length or ease of an animation without changing what it does. `call` runs a function at a moment on the timeline.

### Value.to

Animate a number. Anything that reads it follows.

```film paired label="A readout counts from zero to one hundred"
import { decimal, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const n = s.value(0)
    s.add(decimal(() => n.value, { digits: 1, size: 220, color: 'yellow' }))
    s.play(n.to(100, { duration: 2.4 }))
    s.wait(0.6)
})
```

## Easing

Pass an `ease` to any animation. Names such as `smooth`, `smoother`, `easeOutCubic`, `rushInto`, `rushFrom`, and `bounce` are functions you import, and `overshoot()`, `spring()`, `wiggle()`, `cubicBezier()`, and `during()` build new ones.

```film paired label="Three dots travel with different easing"
import { bounce, dot, film, linear, moveTo, spring } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const row = (y: number, color: string) => s.add(dot(40, color).at(-650, y))
    const a = row(-220, 'blue'), b = row(0, 'yellow'), c = row(220, 'pink')
    s.play(
        moveTo(a, [650, -220], { ease: linear }),
        moveTo(b, [650, 0], { ease: spring() }),
        moveTo(c, [650, 220], { ease: bounce }),
        { duration: 2 },
    )
    s.wait(0.6)
})
```
