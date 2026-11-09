---
title: Animations
nav: Animations
section: Motion
order: 1
description: Every animation in the library, each with a small live demo. Pass any of these to s.play.
---

Each animation takes optional `duration` and `ease` settings. Without them it uses a length that suits it and the `smooth` ease.

A `duration` on `s.play` stretches every animation in that call to fill it, and it overrides a `duration` set on any of them. To give animations different lengths, leave it off `s.play`.

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
    const word = text('arrive', { font: 'text-serif', size: 280 })
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
    const c = text('v', { font: 'text-serif', size: 900, color: 'yellow' })
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

These leave a node as they found it. `spotlight` is the exception: its light stays on until the film turns it off.

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
    const word = s.add(text('careful', { font: 'text-serif', size: 300, color: 'red' }))
    s.wait(0.3)
    s.play(shake(word, { angle: 0.12 }))
    s.wait(0.6)
})
```

### circumscribe

```film paired label="A lit line traces around a word and runs off"
import { circumscribe, film, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const word = s.add(text('this one', { font: 'text-serif', size: 260 }))
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

### spotlight

`spotlight` dims the rest of the stage, so that the viewer looks at one node. The targets keep their look. A second `spotlight` moves the light, and `spotlight(null)` turns it off. Use it in place of a list of fades: a film that fades the other nodes by hand forgets one, and that node stays bright or stays dim.

```film paired label="A light moves across four boxes while the heading stays bright, then every box comes back"
import { beside, film, group, rect, row, spotlight, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const heading = s.add(text('Four steps of a request', { font: 'text-serif', size: 90 }).at(0, -330))
    const steps = ['parse', 'plan', 'run', 'reply'].map((name) => group(rect(360, 240, { radius: 16, stroke: 'blue', width: 6 }), text(name, { font: 'text-serif', size: 80 })))
    // A row measures the boxes, and it goes under the heading.
    beside(row(steps, { gap: 60 }), heading, 'under', 'loose')
    for (const step of steps) s.add(step)
    s.wait(0.5)
    for (const step of steps) {
        s.play(spotlight(step, { keep: [heading] }))
        s.wait(0.7)
    }
    s.play(spotlight(null))
    s.wait(0.6)
})
```

The target is one node, a list of nodes, or `null`. A part of a text is a target too: `spotlight(eq.part('c^2'))` lights one term, and the other glyphs of the equation dim. The light takes half a second unless you give a `duration`. The options are `dim`, `within`, and `keep`:

- `dim` is the part of its color that the rest keeps, from 0 to 1. The default is 0.3 on a dark look and 0.4 on a light look. Both leave dim ink text at a contrast of about 2.4 to 1, which a viewer can still read. On paper, 0.3 leaves it at 1.9.
- `within: chart` dims only inside one node, such as one chart or one group. The rest of the stage does not change, so two charts can each have a light. `spotlight(null, { within: chart })` turns off the light of that node, and `spotlight(null)` turns off every light.
- `keep: heading` or `keep: [heading, source]` names nodes that stay bright with the targets: a heading, a source line, a claim tag, a backdrop. `keep` belongs to one call, so give it to each `spotlight`. Pinned nodes (`.pin()`) stay bright without it.

**What dims.** The rest is every node that shows before the light starts and still shows at that time, and that is not a target, not in a target, and not an ancestor of a target. An ancestor keeps its look, and its other children dim. A node at opacity 0 does not show.

Three objects know which labels belong to a part, and a light on the part keeps them bright. In a `barChart`, a bar has its name and its readout: `spotlight(chart.bar(2))` dims the other bars, their labels, and the base line. In a `dotChart`, a dot or an interval has its row. In `lanes`, the bar, the arrow or the dot of an event has its label. For another object, name the labels as targets too: `spotlight([cell, label])`.

A node that enters at the very time that a light starts is not a part of the rest. It arrives with its own look, as a node that enters later does. That is one rule for `fadeIn`, `write`, `draw`, `grow`, `appear`, `morph`, and `s.add`, and the order of the arguments of `s.play` does not change it: `s.play(write(note), spotlight(row))` and `s.play(spotlight(row), write(note))` are the same film. The next `spotlight` dims such a node with the rest. Three cases to know:

- At time 0, the nodes that the film put there with `s.add` are a part of the rest. A film has no time before 0.
- A node that comes into a dim group is dim with its group.
- A dim node that the film hides and shows again under the same light is still dim. A node that is hidden when a light starts is not a part of its rest, so it comes back with its own look.

A mark that a verb adds for a node is as bright as that node, at any time: the line of `circumscribe`, the rays of `flash`, the ring of `ripple`, the segment of `pulse`, the stroke of `highlightSweep`, and the cursor of `typewriter`. A `flash` or a `ripple` at a point belongs to no node, and has its own look.

**How a dim node looks.** The light does not write the `opacity` of a node. It writes a value of its own, `dim`, and a dim node keeps its opacity: each of its colors goes toward the background color of the film. That is its fill, its stroke, the color of its text, each stop of a gradient, and its glow. So a dim node still hides what is behind it. A dim label on a line does not show the line, and two dim shapes that overlap do not blend. A picture has no one color to change, so each of its pixels goes toward the background color and keeps its alpha: the clear parts of a logo stay clear. A node in a dim group is as dim as the group, not dimmer.

The background color is the `background` of the film, or the one of its look. If the film draws its own backdrop, such as a gradient or a picture, set `background` to the main color of that backdrop, because dim nodes go toward it.

The film can fade a node while the light is on, and the two do not undo each other. `spotlight(null)` gives every node the look that the film gave it: a node that the film fades to 0.5 under the light is at 0.5 when the light goes off.

**Lights follow time.** A light does not change the stage when the film names it. It joins the lights of the film, and what is dim at a time comes from that list in time order, when the film is complete. So a narrated film can name its lights, and bring its nodes, in any order with `s.at`, and the result is the same. At a time, the light that started last decides. A light of the whole stage takes the place of every light before it. A light with `within` decides inside its node and leaves the rest of the stage to the lights before it.

A light that would show nothing, or that would make a frame jump, stops the build, and the error says what to do:

- A target that is not on the stage, or is hidden, when the light starts. A node that enters at that time is a target, and so is a part of it, such as one term of an equation that `write` brings. For a morph that starts at that time, light the node that the morph starts from.
- The camera or the root of the stage as a target, and two nodes as two arguments: `spotlight([a, b])` takes one list.
- A light with `within` in a node that another light dimmed, or in a node whose group it dimmed. Make that node a target of the other light, or turn the other light off first.
- Two lights that start at the same time in the same place. They have no order, so give one light all the targets. Two times that differ by less than a millionth of a second are the same time.
- A light that dims a node while it morphs. The shape that travels is a new node with its own look, so a dim source would jump to bright, and a result in a dim group would jump to dim. Make the source of the morph a target or a `keep` of the light, or turn the light off before the morph. The result of a morph has its own look, and the next `spotlight` decides for it.

The light has one limit. A `scene3d` draws its own objects, so the light does not act on one object in it: the scene is bright or dim as a whole.

The film check reads dim text as text, and a light gives it no new finding: a dim label keeps its plate, so no line crosses it. The check has no rule for the contrast of a text, so it counts a dim text as readable at any `dim`. Keep the default, or more, for text that a viewer must still read.

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

`delay` gives a clean change from one sentence to the next. The old text fades before the new text can be read, so the two never overlap. Inside a `s.play` that has a `duration`, `seq(fadeOut(oldText), fadeIn(newText))` does the same.

```ts
import { delay, fadeIn, fadeOut, film, text } from 'vizmatic/stage'

export default film((s) => {
    const oldText = s.add(text('The old sentence', { size: 72 }))
    s.wait(1)
    const newText = text('The new sentence', { size: 72 })
    s.play(fadeOut(oldText, { duration: 0.15 }), delay(fadeIn(newText, { duration: 0.25 }), 0.1))
    s.wait(1)
})
```

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
