---
title: Cookbook
nav: Cookbook
section: Reference
order: 1
description: Short recipes for things people often want. Each one is a complete film you can copy.
---

## A point that follows a curve

Drive a `dynamic` drawing from a `Value`. The dot and its guides stay true to the curve at any time.

```film paired label="A dot travels along a curve with a readout"
import { axes, draw, dot, dynamic, film, line } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const graph = s.add(axes({ x: [0, 6.3], y: [-1.4, 1.4], width: 1400, height: 700, labels: false }))
    const curve = graph.plot(Math.sin, { stroke: 'blue', width: 7 })
    s.play(draw(graph.lines), draw(curve), { duration: 1 })
    const x = s.value(0)
    s.add(dynamic(() => {
        const p = graph.world(x.value, Math.sin(x.value))
        return [
            line(graph.world(x.value, 0), p, { stroke: 'dim', width: 3, dash: [10, 12] }),
            dot(20, 'yellow').glow(20).at(p),
        ]
    }))
    s.play(x.to(6.28, { duration: 3 }))
})
```

## Trace a moving point

`traced` keeps the path of any point over a span of time.

```film paired label="A spirograph traces itself"
import { dot, dynamic, film, traced, type Vec } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const t = s.value(0)
    const point = (): Vec => {
        const a = t.value
        return [Math.cos(a) * 300 + Math.cos(a * 5.1) * 150, Math.sin(a) * 300 + Math.sin(a * 5.1) * 150]
    }
    s.add(traced(point, 0, 5, { color: 'teal', width: 4 }))
    s.add(dynamic(() => dot(16, 'yellow').at(point())))
    s.play(t.to(Math.PI * 6, { duration: 5, ease: (u) => u }))
})
```

## A signal through a system

Lines, labels, and pulses make a small architecture film. Connect the boxes first, and then send packets along the edges.

```film paired label="A request pulses through three services"
import { arrow, draw, fadeIn, film, lagged, pulse, rect, seq, text, group } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const box = (label: string, x: number) => group(
        rect(380, 200, { stroke: 'blue', width: 4, radius: 12 }),
        text(label, { size: 64 }).at(0, 0),
    ).at(x, 0)
    const boxes = [box('edge', -620), box('api', 0), box('db', 620)]
    const links = [arrow([-420, 0], [-200, 0], { stroke: 'dim', width: 6 }), arrow([200, 0], [420, 0], { stroke: 'dim', width: 6 })]
    s.play(lagged(boxes.map((b) => fadeIn(b, { shift: [0, 24] }))), { duration: 1 })
    s.play(...links.map((link) => draw(link)))
    const shaft = (i: number) => links[i]!.children[0]!
    s.play(seq(pulse(shaft(0), { duration: 0.7 }), pulse(shaft(1), { duration: 0.7 })))
    s.play(seq(pulse(shaft(1), { duration: 0.7 }), pulse(shaft(0), { duration: 0.7 })))
})
```

## Reveal a chart

Bars and lines are nodes, so a chart can arrive in order and call out one value.

```film paired label="Bars grow and one is highlighted"
import { barChart, film, grow, indicate, lagged } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const chart = s.add(barChart([
        { label: 'Mon', value: 3 }, { label: 'Tue', value: 5 }, { label: 'Wed', value: 9 }, { label: 'Thu', value: 4 },
    ], { width: 1200, height: 720 }))
    s.play(lagged(chart.bars.map((bar) => grow(bar, { from: bar.bottom })), { lag: 0.25 }), { duration: 1.4 })
    s.play(indicate(chart.bars[2]!, { color: 'yellow', scale: 1.05 }))
    s.wait(0.5)
})
```

## Build a logo sting

A glyph outline is a path, so a mark can draw itself and settle.

```film paired label="The letter v draws itself and a dot lands beside it"
import { dot, draw, fadeIn, film, overshoot, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const mark = s.add(text('v', { font: 'text-serif', size: 620 }))
    s.play(draw(mark, { duration: 1.4 }))
    const point = s.add(dot(36, 'yellow').glow(24).at(190, -160))
    s.play(fadeIn(point, { scale: 0.05, ease: overshoot() }))
    s.wait(0.6)
})
```

## Time things to a voiceover

Put a label at a moment with `s.at`, so one section does not push others around.

```ts
import { fadeIn, film, text } from 'vizmatic/stage'

export default film((s) => {
    const cue = (time: number, words: string, y: number) => {
        s.at(time, () => {
            s.play(fadeIn(s.add(text(words, { size: 72 }).at(0, y))))
        })
    }
    cue(0.5, 'First sentence.', -100)
    cue(3.2, 'Second sentence.', 40)
    s.wait(6)
})
```
