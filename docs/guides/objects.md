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

`plot` draws a function as a smooth curve through even samples. It also takes a series: the list of its points, `[x, y]` with x in rising order. A series is straight lines through its own points, so its shape stays the same while it grows or scrolls, and a point with no value (`NaN`) leaves a gap. `plot(points, { to: () => now.value })` draws a curve up to a value, and `from` takes a function too. `valueAt(points, x)` gives the value of a series at any x, for a mark that follows it.

`axes.marker({ x: () => now.value, label: 'now' })` draws a line across the plot at one value of x, with its label over the plot. With `y`, the line is level and its label is at the right of the plot, for a limit or a target. Near an end of the plot, the label stays beside the plot and does not pass the end. A marker that follows a value does not show while the value is outside the range.

## Bands

`band(axes, low, high)` fills the band between two curves on the same axes: the interval around a forecast, the range of a sensor, the room between a load and its limit. Each curve is a function or a series. `from` and `to` take a number or a function, so `to: () => t.value` opens the band from left to right, as a curve is drawn. The band stays inside the y range, and it has a gap where a curve has no value. `areaUnder(axes, high, { over: low })` is the same band.

```film paired label="A median draws, and two bands open around it: the dark one inside the light one"
import { axes, band, fadeIn, film, type Vec } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const open = s.value(0)
    const graph = s.add(axes({ x: [0, 12], y: [0, 10], width: 1300, height: 700, tips: false }))
    // One value for each whole x. The bands are wider at each step.
    const middle = [4, 4.6, 5.4, 6, 5.6, 4.8, 4.4, 5, 5.8, 6.4, 6, 5.2, 4.8]
    const around = (reach: number): Vec[] => middle.map((y, x) => [x, y + reach * Math.sqrt(x)])
    band(graph, around(-0.8), around(0.8), { to: () => open.value, fill: 'blue', opacity: 0.2 })
    band(graph, around(-0.3), around(0.3), { to: () => open.value, fill: 'blue', opacity: 0.3 })
    graph.plot(around(0), { to: () => open.value, stroke: 'blue' })
    s.play(fadeIn(graph), { duration: 0.6 })
    s.play(open.to(12), { duration: 2.4 })
    s.wait(0.8)
})
```

## Moving windows

A range can be a function, for a window that moves along a series: `axes({ x: () => [now.value - 8, now.value + 4] })`. The axes then draw their ticks and their numbers again on every frame, and a number fades before it passes an end of its axis. Give `xStep`, so that the ticks stay the same when the window changes its width. Keep the y range, or move it slowly: a y axis that jumps is hard to read.

Each mark on such axes follows the range. A curve and a band are cut at the two ends of the x range. A dot, a marker, guides, a tangent, a secant, the rectangles of `riemann`, and the names of the axes move with it, and a mark at a point does not show while the point is outside the range.

On fixed axes, the numbers have one place at every `labelSize`: the middle of a number is 26 pixels under the x axis, or 28 pixels beside the y axis. A number that would touch its tick there moves away as far as it must to clear the tick. On axes with a range that moves, that room grows with `labelSize`.

```film paired label="A window moves along a series, a marker follows the present, and a band opens ahead of it"
import { axes, band, dot, dynamic, fadeIn, film, linear, valueAt, type Vec } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const now = s.value(8), ahead = s.value(0)
    // A series with one point for each whole x.
    const points: Vec[] = Array.from({ length: 17 }, (_, x) => [x, 5 + 3 * Math.sin(x / 2)])
    const wave = (x: number) => 5 + 3 * Math.sin(x / 2)
    const graph = s.add(axes({ x: () => [now.value - 8, now.value + 4], y: [0, 10], width: 1300, height: 700, xStep: 2, tips: false }))
    band(graph, (x) => wave(x) - 0.3 * (x - 16), (x) => wave(x) + 0.3 * (x - 16), { from: 16, to: () => 16 + ahead.value, fill: 'blue' })
    graph.plot(points, { to: () => now.value, stroke: 'ink' })
    graph.marker({ x: () => now.value, label: 'now' })
    // A mark of the film at a place of the data: `p` gives the place for the range of each frame.
    graph.add(dynamic(() => dot(8, 'ink').at(graph.p(now.value, valueAt(points, now.value)))))
    s.play(fadeIn(graph), { duration: 0.6 })
    s.play(now.to(16, { ease: linear }), { duration: 3 })
    s.play(ahead.to(4), { duration: 1.2 })
    s.wait(0.8)
})
```

`p(x, y)` gives the place for the range at the time of the frame, so make a mark of your own with `dynamic`, as the dot of the example. Fade the parts of such axes in: `draw` has no line to trace on them.

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

`dotChart(data)` draws one row per item: a label, a dot at its value on a shared axis, and a line for its interval. Use it for scores with their uncertainty. It takes less room than bars, and its axis does not have to start at zero. The rows keep the order of the data, so sort the data to rank it. `hollow: true` draws a ring, to tell a second group apart.

```film paired label="Five scores with their intervals arrive from the best to the worst"
import { dotChart, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const chart = dotChart([
        { label: 'blocks', value: 0.89, low: 0.87, high: 0.91 },
        { label: 'tall CSV', value: 0.88, low: 0.86, high: 0.9 },
        { label: 'statistics alone', value: 0.57, low: 0.54, high: 0.6, color: 'orange' },
        { label: 'chart image', value: 0.57, low: 0.53, high: 0.6, color: 'pink' },
        { label: 'no data', value: 0.08, low: 0.06, high: 0.1, color: 'dim' },
    ], { width: 1100, labelSize: 40, domain: [0, 1], ticks: [0, 0.25, 0.5, 0.75, 1], xLabel: 'mean score, higher is better. Lines: 95% intervals' }).at(150, -40)
    s.play(chart.enter(), { duration: 2.4 })
    s.wait(0.8)
})
```

As with the other charts, `width` and `height` are the size of the plot, and the plot is centered on the chart. The labels are outside it, at the left, and the ticks are under it. Without a `domain`, the axis covers a round range around the data. `ticks` is a count or a list of values. `chart.rows` holds one node per item, with its label, its interval and its dot, and `chart.p(value, row)` gives a place on the chart for a bracket or a note. A value outside the domain, a value outside its interval, an interval with one end, and a tick outside the domain are errors.

`scale: 'log'` gives each power of ten the same room on the axis. Use it when the values differ by more than about a hundred times. On a linear axis, all of them but the largest sit at zero. On a log axis, a distance shows a ratio and not a difference, so say on screen that the axis is logarithmic. The `xLabel` is the place for that.

```film paired label="Five times, from 100 ns to 10 ms, on a log axis"
import { dotChart, film } from 'vizmatic/stage'

// About how long one operation takes, in nanoseconds.
const time = (ns: number) => (ns >= 1e6 ? `${ns / 1e6} ms` : ns >= 1e3 ? `${ns / 1e3} µs` : `${ns} ns`)

export default film({ fps: 30 }, (s) => {
    const chart = dotChart([
        { label: 'system call', value: 100 },
        { label: 'page fault', value: 1_000 },
        { label: 'read from a fast drive', value: 20_000, color: 'teal' },
        { label: 'round trip in a data center', value: 500_000, color: 'purple' },
        { label: 'read from a spinning disk', value: 10_000_000, color: 'orange' },
    ], { scale: 'log', width: 1000, labelSize: 40, format: time, xLabel: 'time for one operation, logarithmic' }).at(250, -40)
    s.play(chart.enter(), { duration: 2.4 })
    s.wait(0.8)
})
```

On a log axis, the default domain is the powers of ten around the data: values from 80 to 12,000,000 give an axis from 10 to 100,000,000. The default ticks are the powers of ten in the domain. When there are more than eight, every second or third power gets a tick, and the two ends keep theirs. A number for `ticks` asks for about that many. A list of `ticks` and a `domain` are used as they are. The default format is short: 1, 10, 100, 1k, 10k, 1M, 1G, and 0.1, 0.01, 0.001 below one. Pass `format` for a unit, as in the example. `chart.p(value, row)` gives the place of a value on the log axis, and `chart.domain` holds the two ends as values.

When the domain has three powers of ten or fewer, the grid also has fainter lines at 2 to 9 times each power. The axis must be wide enough to leave 12 px between the two closest lines. A log axis has no zero. A value, an interval end, a domain end, or a tick that is 0 or less is an error.

`unitChart(groups)` draws one mark for each unit, so the viewer sees a count and does not only read it. Use it for a number of cases, runs, hosts, or files, up to about 2,000. A group has a `count`, a `color`, and a `label`.

```film paired label="330 runs arrive, take the color of their result, and gather into three blocks"
import { film, unitChart } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const chart = unitChart([
        { count: 262, label: '262: no effect' },
        { count: 39, color: 'green', label: '39 better' },
        { count: 29, color: 'red', label: '29 worse' },
    ], { rows: 11, mixed: true, plain: true, cell: 22, labelSize: 34 })
    s.play(chart.enter(), { duration: 1.4 })
    s.play(chart.paint(), { duration: 0.8 })
    s.wait(0.4)
    s.play(chart.rearrange({ split: true }), { duration: 1.6 })
    s.wait(0.8)
})
```

The chart has three arrangements. By default the groups follow each other in one grid, so each group is one part of the whole. `mixed: true` puts the marks of all groups at mixed places in that grid, to show a few among many. The same `seed` gives the same places. `split: true` draws each group as its own block, with its label over it. The labels show only while the groups are split. For the other two arrangements, add a `legend()`. `rows` sets the marks in one column, and the chart fills column by column. `columns` sets the marks in one row, and the chart fills row by row. `cell` is the side of one mark, and `gap` the room between two marks.

`chart.enter()` brings the marks in line by line. `plain: true` starts every mark and label in one color, and `chart.paint()` gives each group its color. `chart.rearrange(arrangement)` moves the marks to another arrangement. It keeps the rows or columns and the seed that the new arrangement does not name. `split` and `mixed` turn each other off, and `rows` replaces `columns`. Each group moves over the whole time of the move, so a small group does not wait for a large one.

`.at()` places the middle of the grid, or of the row of blocks. A block is as wide as its marks or its label, so a row of blocks is wider than the grid: check both arrangements. A group with a count of 0 and a label keeps the room of its label, such as "0 failed". `chart.marks` holds every mark, `chart.groups` the marks of each group, and `chart.p(index)` the place of a mark. `shape: 'square'` draws squares. A chart of more than 20,000 marks is an error: let one mark stand for more than one unit, and say so in a label. Above about 2,000 marks, a move reads as a wipe.

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

## Messages on a line

`connector(a, b)` draws a line between two nodes, and `link.send(mark)` sends a mark along it: a request, an answer, a packet. Use it for a protocol between parts, where a message takes time, and can arrive late or not at all.

```film paired label="A request arrives, its answer comes back, one request is lost on the way, and one is refused at the server"
import { chip, connector, film, namedBox } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const look = { width: 340, height: 170, size: 56 } as const
    const client = s.add(namedBox('client', look).at(-620, 0))
    const server = s.add(namedBox('server', look).at(620, 0))
    const link = s.add(connector(client, server, { route: 'straight', tip: false, color: 'gridStrong', width: 4 }))
    // A new mark for each message. Any node is a mark: a chip, a pictogram, a group.
    const message = (word: string) => chip(word, { size: 44, round: true, anchor: 'center', stroke: 'dim' })
    s.play(link.send(message('request'), { duration: 1.2 }))
    s.play(link.send(message('answer'), { duration: 1.2, reverse: true }))
    s.play(link.send(message('request'), { duration: 0.8, lost: 0.6 }))
    s.play(link.send(message('request'), { duration: 1.2, refused: true }))
    s.wait(0.4)
})
```

The mark grows in beside the first node and travels to the second one at one speed. `reverse: true` sends it from the second node to the first, as an answer. `duration` is the time on the way, so a slow message has a long `duration`. The mark starts and stops clear of the two nodes, and `gap` is that room: 8 by default.

A message has one of three ends:

- It arrives. The mark goes into the node at the end of the line: it shrinks there, and it is gone.
- `lost: 0.6` loses it at that part of the way, from 0 to 1. The mark stops there, and a cross shows ahead of it. With `lost`, `duration` is the time to that place.
- `refused: true` is a message that arrives, and that the receiver does not take. The mark stops before the node, with the cross between the two.

The way of a message that stops ends before the node, with room for the cross. So the cross is never on the node or on the mark, and `lost: 1` stops the mark where a refused message stops.

A message that is lost or refused stays with its cross for `hold` seconds, 0.8 by default, and then both go. `stopColor` is the color of the cross, red by default. The cross is as high as the mark.

The animation lasts for the way and for what comes after it: 0.12 seconds for a mark that arrives, and `hold` more for one that stops. So `s.play(link.send(mark))` ends when the mark is gone. A film that has the times of its messages, such as the trace of a simulation, plays each one at its time: `s.at(sent, () => s.play(link.send(mark, { duration: arrives - sent })))`. Several marks can be on one line at one time. Each message has its own mark: one mark is at one place at a time, so a mark that is sent again while it is on its way is an error. Send a copy, `link.send(mark.clone())`, or make a new mark for each message. A mark that has arrived can go again, as the answer.

The mark never fades: it grows in and shrinks out. So the line under it does not show through a text on it. The mark follows the line as it is when the message leaves: when a node at an end moves while the message is on its way, the mark arrives at the place where the node was. A line that is too short for the mark, a `lost` outside 0 to 1, a message that is both lost and refused, and a `duration`, a `hold`, or a `gap` that is not a number or is under 0 are errors. A `duration` is more than 0. `send` works with any `route` of the connector, and it puts the line on the stage when the film did not.

## Lanes

`lanes(names, events)` shows who runs when. Each actor has one lane, and time runs from left to right. A span is a bar: the lane works from `start` to `end`. A handoff is an arrow from one lane to another at a time. A mark is a dot at one instant on one lane. Use it for a system call, a VM exit, an interrupt, or a request that passes through several services.

```film paired label="A VM exit, step by step: the guest, the kernel, and the monitor"
import { film, lanes } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const flow = lanes(
        [{ name: 'guest', color: 'red' }, { name: 'KVM', color: 'teal' }, { name: 'monitor', color: 'blue' }],
        [
            { lane: 'guest', start: 0, end: 30, label: 'runs' },
            { from: 'guest', to: 'KVM', at: 30, label: 'VM exit' },
            { lane: 'KVM', start: 30, end: 42 },
            { from: 'KVM', to: 'monitor', at: 42, label: 'to user space' },
            { lane: 'monitor', start: 42, end: 70, label: 'emulates the device' },
            { from: 'monitor', to: 'KVM', at: 70, label: 'KVM_RUN' },
            { lane: 'KVM', start: 70, end: 78 },
            { from: 'KVM', to: 'guest', at: 78, label: 'VM entry' },
            { lane: 'guest', start: 78, end: 100, label: 'runs', open: true },
        ],
        { width: 1400, size: 36, barHeight: 60 },
    ).at(110, 0)
    s.play(flow.enter(), { duration: 0.8 })
    for (const time of [30, 42, 70, 78, 100]) {
        s.play(flow.advance(time), { duration: 1.2 })
        s.wait(0.4)
    }
    s.wait(0.8)
})
```

`flow.enter()` brings the names and the lines of the lanes, and no event. `flow.advance(to)` moves a cursor from its time to `to`, and stops there. What the cursor passes appears. A span grows with the cursor: at every frame, the right end of a growing bar is at the cursor. A handoff draws its arrow when the cursor reaches it, and a mark shows its dot. A label arrives when its event is complete. A label inside a bar arrives when the bar starts to grow. All of it is over when the animation ends, so a narration can step through the sequence, one `advance` for each sentence. `flow.showAll()` is an advance to the end. `flow.time` is the time of the cursor. An advance to an earlier time is an error: the object has no rewind. The first advance shows the cursor. After that advance, `flow.cursor.hide()` takes it away. With the option `cursor: false`, the object draws no cursor at all, and the events still appear at their times.

The cursor never goes back, and never passes the time of its advance. With an ease that bounces or passes its end, the cursor follows the furthest point that the ease has reached. The object shows an event only through `advance`. A part that the film shows by hand, such as `flow.events[3].show()`, does not move the cursor, the time, or a counter.

A lane is a name, or `{ name, color }`. A span takes the color of its lane unless it has its own. An event names a lane by its name or by its index. A span that grows has no outline, and the outline comes when the span is complete. `open: true` is a span with no end: it never gets the outline, and it ends with an arrow head when it reaches the end of the domain.

A solid span is a lane that runs. `idle: true` is a span where the lane waits: an outline of dashes with a faint fill, for a thread that sleeps while another lane works. `idle` and `open` can combine. On a handoff, `dashed: true` draws an arrow of dashes, for a message whose sender does not wait and runs on.

The object places the labels. The label of a span is inside its bar, at the start, when it fits with room at both sides. Otherwise it is over the bar, from the left end of the bar. The label of a handoff is at the right of its arrow, between the two lanes, or at the left when the right has no room. The label of a mark is over its dot. No label may touch a bar, an arrow, a dot, or another label, and no label may leave the time area. The labels get their places in the order of time, so the order of the list changes nothing. When a label has no such place, `lanes()` throws, and names the two events that meet. Then use a wider `width`, a larger `pitch`, shorter labels, or times that are further apart.

When the object cannot settle a case, the film can: an event takes `labelSide`. For a span, `'over'` and `'under'` are over and under the bar, and `'left'` and `'right'` are beside the bar, on the lane. A short span at the foot of an arrow has no room for a label over it, and `labelSide: 'under'` or `'right'` gives it one. For a handoff, `'left'` and `'right'` are the two sides of its arrow, and `'over'` and `'under'` are the two sides of the boundary that it crosses first. For a mark, the four sides are around its dot. A label with a `labelSide` has that place or none: when the place is taken, `lanes()` throws.

Two spans that overlap on one lane are an error, because a lane does one thing at a time. A span may start at the time where another one ends. A `pitch` with no room for an arrow between two bars is an error when the object has a handoff, and the message names the least pitch.

With `ticks`, the object draws a time axis under the lanes, and one lane makes a chart of durations:

```ts
import { film, lanes } from 'vizmatic/stage'

export default film((s) => {
    const boot = lanes(['boot'], [
        { lane: 0, start: 0, end: 8, label: 'VMM', color: 'purple' },
        { lane: 0, start: 8, end: 20, label: 'load kernel', color: 'teal' },
        { lane: 0, start: 20, end: 78, label: 'kernel init' },
        { lane: 0, start: 78, end: 125, label: 'init', color: 'green' },
    ], { ticks: [0, 25, 50, 75, 100, 125], format: (time) => `${time} ms`, axisLabel: 'time since the start of the VMM' })
    s.play(boot.enter())
    s.play(boot.showAll())
})
```

`ticks` is a count or a list of values, and `format` writes a tick. Without `ticks`, no axis is drawn, for a sequence that is not to scale. An `axisLabel` without `ticks` draws the line of the axis and the label, and no tick: a line of time with a name and no scale. `domain` sets the times at the two ends. Without it, the domain is the range of the events.

`boundaries` draws a line of dashes between two lanes that are neighbors, such as the line between user space and the kernel. Its `label` is after the right end of the line, outside the time area, as the names of the lanes are before the left end. A handoff crosses each boundary that is between its two lanes. The object knows this from the order of the lanes, so the film does not count. `flow.crossings(boundary)` gives the number of crossings up to the time of the cursor, by the index of the boundary or by its label. With `count: true`, the boundary shows that number after its label, and each handoff leaves a tick where its arrow passes the line. The number goes up when the cursor passes the handoff. A dashed handoff counts as any other.

```ts
import { film, lanes } from 'vizmatic/stage'

export default film((s) => {
    const flow = lanes(['user space', 'kernel'], [
        { lane: 'user space', start: 0, end: 10 },
        { from: 'user space', to: 'kernel', at: 10, label: 'read' },
        { lane: 'kernel', start: 10, end: 30, label: 'copies' },
        { from: 'kernel', to: 'user space', at: 30 },
        { lane: 'user space', start: 30, end: 50, open: true },
    ], { width: 1100, boundaries: [{ between: ['user space', 'kernel'], label: 'system call line', count: true }] })
    s.play(flow.showAll())
    const crossings = flow.crossings('system call line') // 2
})
```

Two such objects side by side compare two designs by their crossings: ten against two. The label and the number of a boundary need room at the right of the object, so a handoff can be at any time, to the last end of the domain. The labels of all boundaries start at one x, and the numbers end at one x. The two lanes of a boundary are further apart, by 1.25 of the text size, for the line. The label of a handoff is then over the line or under it, beside the lane that the handoff leaves. `flow.boundaries` holds one node per boundary, and `flow.counters` the number of each boundary that counts, or null.

`.at()` places the middle of the time area. The names are outside it, at the left, so a long name needs room there. `width` is the width of the time area, `barHeight` the height of a bar, `pitch` the distance from one lane to the next, and `size` the text size. `flow.names`, `flow.rails` (the line of each lane), `flow.events`, `flow.axis`, and `flow.cursor` are the parts. `flow.spans`, `flow.handoffs`, and `flow.marks` hold the same events by kind. An event has a `shape` (its bar, its arrow, or its dot), a `text` (its label, or null), a `tip` (the arrow head of an open span, or null), and an `edge` (the outline of an idle span, or null). `flow.x(time)` and `flow.y(lane)` give a place on the object for a brace or a note.

The object draws by kind, whatever the order of the list: the lines of the lanes, then the bars, then the boundaries, then the arrows, then the dots. The cursor is under all of them, and it passes behind the labels: each label, each bar and each arrow of dashes has a patch under it, in the color of `backing`. The default `backing` is the background of the look, which fits an object on the background of the film. On a panel of another color, set `backing` to the color of the panel. Where no one color is behind the object, set `backing: null`: inside a zone with a fill, over a picture, or in a film that is rendered with `--background none`. Then the object draws no patch, the line of a lane shows through its bars, and the cursor passes through the labels. So with `backing: null`, also set `cursor: false`.

## Pipelines

`pipeline(stages, options)` follows an item through a sequence of named stages. A request, tool call, or data row keeps its ID as it moves, receives a verdict, or leaves the path. Use `steps` for a recap with one step highlighted, `lanes` for actors over time, and `graph` for branches with different stages.

```film paired label="A tool call passes the four gates of the host and takes a stamp at each, and a call with a wrong argument stops at the schema gate"
import { film, pipeline } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const flow = pipeline(['complete', 'schema', 'authorization', 'execute'], { width: 1800, size: 34, gates: true, lanes: 2 })
    s.play(flow.enter(), { duration: 1 })
    // Call 17 has all its arguments, a text id, and a grant. It takes one stamp at each gate.
    s.play(flow.put({ id: 'call 17', badge: 'hold B7' }))
    s.wait(0.6)
    for (const stamp of ['complete', 'schema ok', 'grant: Lena', 'held B7']) {
        s.play(flow.pass('call 17', stamp), { duration: 0.5 })
        s.wait(0.4)
        if (stamp !== 'held B7') s.play(flow.move('call 17'), { duration: 0.7 })
    }
    // Call 18 gives the book id as a number. The schema gate stops it, and the call does not reach the tool.
    s.play(flow.put({ id: 'call 18', badge: 'hold 4412', color: 'orange' }))
    s.play(flow.move('call 18'), { duration: 0.7 })
    s.play(flow.stop('call 18', 'id is a number'))
    s.wait(1.4)
})
```

A stage is a name, or `{ name, gate }`. A gate checks an item, and lets it through or stops it. Its mark on the path is a diamond, and the mark of a plain stage is a ring. `gates: true` makes every stage a gate, apart from a stage with `gate: false`. The names are over the path, at even steps, and each one is one line.

`flow.put({ id, badge, color, at, lane })` brings an item to the path. Only `id` is required. The capsule shows the ID and its optional badge. By default, the item starts at the first stage in the first lane available when its animation begins. `flow.put(items, { lag })` staggers the arrivals.

`flow.move(which)` takes an item to the next stage, and `flow.move(which, 'schema')` takes it to a stage by its name or its index. An item that leaves a stage leaves a mark there: a dot at a plain stage, and a check at a gate. So the path behind an item shows what happened to it. A move over several stages goes through each stage between them, and leaves its mark there too. A move back to an earlier stage takes the marks from that stage on away, for a second run of the same item.

`flow.setBadge(which, text)` changes the badge in place: the old text fades out, the capsule takes its new width, and the new text fades in. The id does not move. `null` takes the badge away. `flow.pass(which, text)` is the verdict of a stage that lets an item through: the item shows a check, and takes the text as its badge when the call gives one. `flow.stop(which, reason)` is the other verdict: the item shows a cross, its border goes red, and the reason is its badge. A stop has two signs beside the color: the cross and the words. The check or the cross stays at the stage when the item leaves, and the badge goes with the item. An item that is stopped does not move on. `flow.pass(which)` ends the stop, and the reason goes with it.

`which` is an id, a list of ids, or a function of an item, as in `flow.move((item) => item.state !== 'stopped')`. A number selects an item ID. Pass the destination stage as the second argument. The pipeline calls the function when the film plays the change, so a second change in one sequence sees what the first one left. A function picks items on the path only. With `lag`, the items of one call change one after another.

Each item occupies one lane. Set `lanes` to the most items you need on the path at once. The first lane is visible from the start. Each additional lane appears with its first item. Its marks record that item’s path until another item takes the lane. The frame reserves space for all lanes and the tray from the start.

```film paired label="Rows of a data set go through three gates: each gate stops the rows that break its rule, the counts follow, and the stopped rows go to the tray with their reasons"
import { film, pipeline } from 'vizmatic/stage'

// Five support tickets, and the first gate that refuses each one.
const TICKETS = [
    { id: 'T1' },
    { id: 'T2', gate: 'not empty', reason: 'no text' },
    { id: 'T3', gate: 'parses', reason: 'bad JSON' },
    { id: 'T4' },
    { id: 'T5', gate: 'not a copy', reason: 'copy of T1' },
]
const GATES = ['parses', 'not empty', 'not a copy']

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const flow = pipeline([...GATES, { name: 'training set', gate: false }], {
        width: 1800, size: 32, gates: true, lanes: TICKETS.length, tray: 'quarantine', counts: (count) => `${count} rows`, color: 'teal',
    })
    // The rows come with the path: each lane shows from its first item.
    s.play(flow.enter(), flow.put(TICKETS.map((ticket) => ({ id: ticket.id })), { lag: 0.3 }), { duration: 1.6 })
    s.wait(0.8)
    for (const gate of GATES) {
        // The gate stops the rows that break its rule. They go to the tray, and the other rows go on together.
        const refused = TICKETS.filter((ticket) => ticket.gate === gate)
        s.play(...refused.map((ticket) => flow.stop(ticket.id, ticket.reason)), { duration: 0.6 })
        s.wait(0.7)
        s.play(flow.eject(refused.map((ticket) => ticket.id)), { duration: 0.8 })
        s.play(flow.move((row) => row.name === gate), { duration: 0.8 })
    }
    s.wait(1.2)
})
```

`counts: true` writes under each name how many items reached the stage so far. A function writes the line, such as ``(count) => `${count} rows` ``. A move counts each intermediate stage as the item crosses it and the destination when it arrives. An item counts once per stage, including on a return trip. So the counts of a row of gates are a funnel: 5, 4, 3. `flow.reached(stage)` is that number, and `flow.count(stage)` is the number of items that are at the stage now.

`flow.eject(which)` sends an item to the tray named by `tray`. The tray keeps the ID, verdict, and badge. When the capsule crosses lower lanes or a tray that already holds items, its label fades out for the trip and returns at its destination. Items fill the tray from the left and remain there. If the tray runs out of room, shorten the reasons or increase `width`. `flow.exit(which)` removes an item instead. Its lane and ID become available when the exit finishes.

```ts
import { beside, fadeIn, film, pipeline, text } from 'vizmatic/stage'

export default film({ font: 'text-serif' }, (s) => {
    // One lane, and two requests one after another. The ids and the badges are in mono.
    const rail = s.add(pipeline(['gateway', 'auth', 'quota', { name: 'admission', gate: true }, 'model worker'], { width: 1800, tray: '503', itemFont: 'mono' }))
    s.play(rail.put({ id: 'R-104', badge: 'id set' }))
    for (const field of ['tenant A', 'slot 3/5', '40 ms', '412 tok']) {
        s.play(rail.move('R-104'))
        s.play(rail.setBadge('R-104', field))
    }
    // R-104 is done. R-105 takes its lane, and the marks of the lane start again.
    s.play(rail.exit('R-104'))
    s.play(rail.put({ id: 'R-105', color: 'purple' }))
    s.play(rail.move('R-105', 'admission'), { duration: 1.6 })
    s.play(rail.stop('R-105', '310 ms'))
    // A note of the film on one item: under the whole object, at the x of the item.
    const limit = beside(text('the budget for the first token is 250 ms', { size: 28, color: 'dim' }), rail, 'under', 'normal', rail.item('R-105'))
    s.play(fadeIn(limit))
    s.wait(2)
    s.play(rail.eject('R-105'))
    const state = rail.stateOf('R-105') // { id: 'R-105', stage: 3, name: 'admission', lane: null, state: 'stopped', where: 'tray', badge: '310 ms' }
})
```

An item takes one change at a time. Two changes of one item whose times overlap are an error that names the two calls and their times, and says what to do: play the two in a `seq`, or give the first one a shorter `duration`. Changes of two items play together, so `s.play(flow.move('a'), flow.stop('b', 'late'))` is right. An `exit` or an `eject` frees a lane when it is over, so the `put` of the next item into that lane starts then or later.

`flow.fork(id, item)` makes one item two: the new item comes out of the item `id`, at the same stage, and takes a free lane. Use it for a request that goes on as two parts, such as the text of an answer and the action that it asks for. `flow.join(id, into)` makes two items one: the item `id` goes to the item `into` and ends there. Both parts go through the same stages. For branches with stages of their own, use `graph`.

The getters return the state after the changes scheduled so far. `flow.stateOf(id)` gives the stage, lane, verdict (`waiting`, `passed`, or `stopped`), location (`path` or `tray`), and badge. `flow.find(test)` selects IDs from both the path and tray. `flow.ids` lists all current IDs. `flow.trailOf(stage, lane)` returns `open`, `visited`, `passed`, or `stopped`. A clone has its own items, counts, and marks, including when the film clones a group containing the pipeline.

The names, counts, IDs, and badges default to 28 px. `width` reserves space for the arrowhead and divides the rest equally among the stages. The pipeline measures text in the selected font and reports a fit error if a stage cannot hold it. For a 1080p lesson, keep `size` at 26 or above. Use a wider pipeline, a shorter badge, or a note beside the item for a long reason.

`.at()` places the middle of the object, and the object measures as its frame for the layout, with all its lanes and its tray, whatever its items do. So `fitted(region, (width) => pipeline(stages, { width }))` builds it for a region. `flow.p(stage, 'top')` and `flow.p(stage, 'bottom')` are points over and under a stage, in the coordinates of the object, for the end of an arrow. `flow.region({ stage, lane })` is the box of a stage, of a lane, or of the place of one item, and `flow.region({ tray: true })` is the box of the tray, in stage pixels. `flow.item(id)` is the node of an item, and `flow.mark(stage, lane)` is the node of a mark: give one to `beside` as the part, or to `spotlight`. `flow.enter()` brings the names, the line of the path, the marks and the tray, stage by stage. `flow.names`, `flow.counters`, `flow.rails`, `flow.laneNodes`, `flow.tray`, `flow.trayName` and `flow.items` are the parts. An item has a `capsule`, an `idText`, a `check`, a `cross` and a `badge`. `font` sets the font of the names, the counts and the name of the tray, and `itemFont` the font of the ids and the badges. Both default to the font of the film. `color` is the color of an item that has none of its own.

## Ring buffers

`ringBuffer(slots, options)` draws a ring of slots with a head pointer and a tail pointer. It is the picture of a bounded queue: the two rings of io_uring, a virtqueue, or the descriptor ring of a network card. Slot 0 is at the top, and the slots follow clockwise. `ring.push(entry)` is the producer: the slot at the tail fills, then the tail pointer moves one slot on. `ring.pop()` is the consumer: the entry at the head empties, then the head pointer moves one slot on.

```film paired label="A producer writes three entries at the tail, and a consumer reads two at the head"
import { film, ringBuffer, seq } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const sq = ringBuffer(8, { radius: 300, label: 'submission queue', counts: true, size: 40 }).at(0, -50)
    s.play(sq.enter(), { duration: 1.4 })
    s.play(seq(sq.push({ label: 'read' }), sq.push({ label: 'write', color: 'orange' }), sq.push({ label: 'recv' })), { duration: 2.7 })
    s.play(seq(sq.pop(), sq.pop()), { duration: 1.8 })
    s.wait(0.8)
})
```

`ring.head` and `ring.tail` are running counts that never wrap. The slot of a count is the count modulo `ring.size`, and `ring.length` is `tail - head`. With `counts: true`, each pointer shows its count beside its name: after 9 pushes on 8 slots, the tail reads 9 and is at slot 1. `numbers: true` writes the number of each slot beside it. With both, a name keeps three gaps from the numbers, so that "head 9" and the number of its slot do not read as one phrase.

`ring.length === 0` is an empty ring, and `ring.length === ring.size` is a full ring. In both states the two pointers are at one slot, so only the entries tell the two apart. The ring writes no text for these states: a film that names them reads `ring.length`. A `push()` on a full ring is an error, and so is a `pop()` on an empty ring.

One pointer is outside the ring and one is inside, so the two do not meet when both are at one slot. `outside` selects the pointer that is outside, and `head` and `tail` set the two names. A name of null draws no pointer. The names stay upright. The inside name must fit inside the ring at every slot. With `counts`, it must fit with a count of two digits from the start, and a count of three digits is checked when a pointer reaches it. An error gives the room, and a `radius` that has it.

`headColor` and `tailColor` set the color of the arrow head and the name of a pointer, for example the color of the side that writes that index. Without them, a pointer has the `color` of the ring, as the slots and the caption have. `ring.headPointer` and `ring.tailPointer` are nodes: fade, scale, or recolor a pointer as one node. A pointer grows about its tip, which stays on the band. The ring moves the pointers, so do not move them.

An entry has a `color` and a short `label`, which is upright in its slot. A label that is too wide is set smaller, down to 0.6 of `labelSize`. A label that is still too wide is an error, which gives a `labelSize`, a number of slots, and a `radius` that fit. More `thickness` does not help in a ring of many slots, where it makes a slot narrower. To keep all labels at one size, set `labelSize` to the size that fits the longest label. For labels of one or two letters, a larger `labelSize` reads better. An entry with no color has the `color` of the ring.

`push({ pending: true })` writes an entry and does not publish it: the entry is a dashed outline in its color, with no fill. `ring.publish()` fills every pending entry, and `ring.pending` is the number of pending entries. A `pop()` of a pending entry is an error, because the consumer cannot see it: publish first.

`tailFollows` says what the tail pointer stands for. With `'push'`, the default, the tail moves at each push, also for a pending entry: it is the index that the producer keeps for itself. With `'publish'`, the tail and its count stay behind the pending entries until `publish()`, and a dim arrow head with no name, `ring.writeMarker`, shows where the producer writes. A film about io_uring wants `'publish'` for the submission queue. The program fills several entries, then stores the tail once, and the kernel sees nothing before that store. With `'push'`, the tail counts up at each write, and a viewer learns that the kernel sees each one.

```film paired label="The program writes three requests, then one store of the tail publishes them to the kernel"
import { film, lagged, ringBuffer } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const sq = ringBuffer(8, { radius: 300, label: 'submission queue', color: 'dim', tailColor: 'blue', headColor: 'orange', tailFollows: 'publish', counts: true, size: 40 }).at(0, -50)
    s.play(sq.enter(), { duration: 1.2 })
    s.play(lagged(['read', 'write', 'recv'].map((label) => sq.push({ label, color: 'blue', pending: true })), { lag: 0.5 }), { duration: 2.4 })
    s.wait(0.6)
    s.play(sq.publish(), { duration: 1 })
    s.play(sq.pop(), { duration: 1 })
    s.wait(0.8)
})
```

To write several entries at once, pass the pushes to `lagged`, to `par`, or to one `s.play`. The slots fill in the order of the pushes. The moves of a pointer add up, so it goes over the slots without a jump, and its name stays with it. A `pop()` and a `push()` of one slot in one play is the case of a full ring: the entry that is read fades out first, then the new entry fades in.

`.at()` places the center of the ring, and `label` is a caption under it. The distance of the caption follows from `radius`, `size`, and `numbers`, and from no other option: it is the room of an arrow head and a name of 5 em under the band. So two rings that share these three have their captions on one line, whatever their names, counts and slots. For two rings that differ, or for a longer outside name, set `captionGap`: the distance from the band to the top of the caption. An outside name that can reach the caption is an error that gives the `captionGap` to set.

The bounds of a ring hold the outside name at every slot, with a count of two digits. So a `zone` or a `card` around a ring has room for the name wherever the pointer goes, and `nextTo` keeps two rings apart. `ring.p(slot)` gives the middle of a slot in the coordinates of the ring, to fly an entry in from another place. The slot wraps, so `ring.p(ring.tail)` is the slot that the next `push()` fills. `ring.enter()` draws the band slot by slot, then brings the pointers and the caption. `ring.slots`, `ring.entries`, `ring.numbers`, `ring.headPointer`, `ring.tailPointer`, `ring.writeMarker`, and `ring.caption` are the parts. A ring has 2 to 64 slots.

## Date lines

`dateLine(events, options)` draws a line of time with events at their dates: the history of a project, the releases of a kernel, or the documents of a source in the order in which they came. An event has its date in `at`, a `label`, and a `color`. Each event is a mark on the line, with a stem to its label. An event with no label is a mark only.

```film paired label="Three documents appear on a line of seven years as the cursor passes their dates"
import { dateLine, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const record = dateLine([
        { at: 2020, label: 'the first paper' },
        { at: '2025-06-10', label: 'the newsletter', color: 'orange' },
        { at: '2026-03-24', label: 'the technical report', color: 'orange', note: 'names the system' },
    ], { width: 1700, from: 2020, to: 2027, size: 40, font: 'text-serif' })
    s.play(record.enter(), { duration: 1 })
    s.play(record.advance(2022), { duration: 1 })
    s.wait(0.6)
    s.play(record.showAll(), { duration: 2 })
    s.wait(1.2)
})
```

`at` is a date as `'YYYY'`, `'YYYY-MM'`, or `'YYYY-MM-DD'`, or a number of years such as 2020 or 2023.25. A year is its first day, and a month is its first day. `from` and `to` are the dates at the two ends of the line, and they take the same dates, such as `from: '2025-06'`. `width` is the length of the line, and `.at()` places its middle. The first and the last date are a little inside the two ends, by the radius of a mark, so a mark at an end stays inside the width. A date that the object cannot read, an event outside `from` and `to`, and a `from` that is not before `to` are errors. An error prints the dates as the film wrote them.

The line has a tick for each year, for each month, or for each day: `unit` is `'year'`, `'month'`, or `'day'`. Without `unit`, the span of the line decides. The span goes from `from` to `to`, or from the first event to the last one. A span of 45 days or less has a tick for each day, a span of less than 2 years has a tick for each month, and a longer span has a tick for each year. One date alone has the year around it. Without `from` and `to`, the line holds the whole years, months, or days around the events.

A tick has a text under it, in the middle: the number of the year, the short name of the month, or the number of the day. On a line of months, each January has the number of its year in place of its name, and the first tick says the year too, as "Jun 2025". On a line of days, the first day of a month has the name of the month, and the first tick says the month and the year too, as "May 5, 2025". So every line says its year. A text under a tick at an end of the line passes that end by half of its width.

When the texts have no room, the line writes fewer of them. For years, it writes every second, fifth, or tenth year, and so on with 1, 2, or 5 times a power of ten, at round years. For months, it writes every second, third, or sixth month, counted from January. For days, it writes every second, seventh, or fourteenth day, counted from the first day of each month. Two texts are 0.6 of their size apart, or more. A tick with no text is a small tick. Ticks that would be nearer than 0.3 of the text size have no room, so the line draws the ticks of its texts only: 200 years on 400 px have 5 ticks. When the names of the months or the numbers of the days have no room at any of these steps, the line takes the next larger unit. With a `unit` from the film, that is an error. A line that holds no start of the `unit` of the film is an error too.

The object places the labels. They go over the line and under it by turns, in date order, so the order of the list changes nothing. A label is in the middle over the end of its stem. When events are near to each other, a label goes to the other side, or beside its stem, or to a higher place: `levels` is the number of heights at each side, 3 by default. No two labels meet, no stem passes through a label, and every label is inside the width of the line. `side: 'over'` or `side: 'under'` on an event keeps its label at that side. An event with a side has fewer places, so it takes its place first, and a label near it can leave its turn. The object uses as few heights as the labels need, so more `levels` never make a line fail. `note` is a second line under the label, in dim. A label and a note are one line each, and a line break in one of them is an error. A number is written as its text, and another value that is not a text is an error.

A stem over the line starts at its mark. A stem under the line starts under the row of the texts, at the x of its mark, and goes down to its label. So no stem passes through a text under the line, or beside one. This is the rule for an event at a tick, over the text of a tick, and between two ticks.

`mark` is the mark of an event: `'dot'`, `'star'`, or `'ring'`. An event with no label is a mark only, with no stem. Use it for a line with many events, such as the documents of a record. A mark has a clear room around it, 0.18 of the text size, and no other mark is in that room. A mark that would be in the room of an earlier mark goes to a row over the line, and the line has as many rows as its marks need: four marks of one day take four rows. `rows` is the most rows, 10 by default, which holds 60 marks at random dates on 860 px. The bounds of the object hold the rows. A tick of the line in the clear room of a mark leaves while the event shows, with `advance`, with `event.show()`, or with a fade. So no mark stands on a tick or beside one.

An event with a label can be near another one too. Events with labels at one date have one place on the line. When two events with labels are a few days apart, the mark of the later one goes one row up, and its label goes over the line, from its mark. The label of the earlier one goes under the line. So a line of seven years builds with two posts of one week.

`record.light(index)` gives one event the look of the lit event: the accent color on its mark, its stem, and its label, and a ring around its mark. The event that had this look takes its own color back. Use it for the event that the narration is about. The ring says which event is lit also when an event has the accent color as its own color. `record.light(null)` leaves no event lit, and `record.lit` is the index of the lit event, or null. `accent` is that color, orange by default.

When a line has no layout, `dateLine()` throws. The message says what has no place, and it ends with "What works for this line" and the changes that give this line a layout, such as `levels: 4`, `side: 'under' for event 2`, `no label for event 1`, `rows: 11`, `width: 2400`, or `scale: 'order'`. The object builds the line with each change before it names it, so each one works. It names three at the most.

```ts
import { dateLine, film } from 'vizmatic/stage'

export default film((s) => {
    const record = s.add(dateLine([
        { at: '2025-06-09' }, { at: '2025-06-10', mark: 'star' }, { at: '2025-10-29' }, { at: '2026-03-06' }, { at: '2026-03-06' },
        { at: '2026-03-24', mark: 'star' }, { at: '2026-06-02' }, { at: '2026-11-06', mark: 'ring' },
    ], { width: 1700 }))
    s.play(record.enter())
    s.play(record.showAll(), { duration: 1.5 })
    record.cursor.hide()
    // The document of this scene, and then the next one.
    s.play(record.light(5))
    s.wait(2)
    s.play(record.light(6))
    s.wait(2)
})
```

`record.enter()` brings the line, its ticks and its numbers, and no event. `record.advance(date)` moves a cursor along the line from its date to `date`, and stops there. Each event that the cursor passes appears: its mark and its stem, then its label. All of it is over when the animation ends, so a narration can go through the dates, one `advance` for each sentence. `record.showAll()` is an advance to the end of the line. This is the contract of `lanes.advance`. The cursor does not go back. An event at the first end of the line appears with the first advance. The cursor is a small pointer under the line. It moves in a room of its own, under the marks and their clear room and over the texts under the line, so it touches no mark, no tick, no stem, and no text at any date. The first advance shows it, `record.cursor.hide()` takes it away, and `cursor: false` draws none. `record.date` is the date of the cursor, as a number of years.

The events are hidden until the cursor passes them. The bounds of the object hold the room of every event from the start, so a `zone` or a group around a line has the same size before the events show and after. `record.extent` is that room, as `left`, `right`, `top`, and `bottom` in the coordinates of the object. Use it to place what is over the object or under it.

`scale: 'order'` is for events that are crowded in time, such as three posts in two weeks and one more a year later. The events are then at equal steps in date order. Each date is under its tick, as the film wrote it, and the line says "not to scale" at its end. With this scale, `at` can also be a version, such as `'5.1'`, and the versions go in their order: 5.10 is after 5.3. Give every event a date, or give every event a version. An event is known by its `at` as the film wrote it. Events with one text have one place, and `'5.1'` and `'5.1.0'` are two places. Write a version as a text: as a number, `5.10` is 5.1. The line has a place for the dates of its events and for no other, so `record.advance('5.6')` and `record.x('5.6')` take one of them, and `from` and `to` do not apply.

```ts
import { dateLine, film } from 'vizmatic/stage'

export default film((s) => {
    const releases = s.add(dateLine([
        { at: '5.1', label: 'eight operations' },
        { at: '5.6', label: 'open, close, statx' },
        { at: '5.19', label: 'passthrough commands' },
        { at: '6.0', label: 'a block device in user space', color: 'orange' },
    ], { width: 1600, scale: 'order' }))
    s.play(releases.advance('5.6'))
    s.play(releases.showAll())
    s.wait(2)
})
```

`record.events` holds one node per event, in the order of the list, with its `mark`, its `stem`, its `text`, its `note`, and its `halo`, the ring of the lit event. The stem and the text are null for an event with no label. `record.axis` is the line with its ticks and their texts, `record.cursor` is the cursor, and `record.unit` is the unit of the ticks. `record.x(date)` gives the x of a date, and `record.p(index)` the place of the mark of an event. Both are in the coordinates of the object, as `extent` is: the middle of the line is at (0, 0). `record.toWorld(...record.p(index))` gives the place on the stage, for a brace or a line to a picture. `size` is the text size of the labels. The notes and the texts under the line are a little smaller. `font` is the font of every text of the object.

## Pictograms

`pictogram(name)` draws a small picture of a concept: a time series, a forecast, logs, traces, a graph, a database, a model. All pictures share one 24-unit grid and one line style, so pictures in a row read as one family. `color` sets the lines, and `accent` sets the part that carries the meaning. A picture with one part, such as `series` or `check`, is all in the accent. `.at(x, y)` places the middle of the grid, so pictures of one `size` line up.

```film paired label="A row of pictograms for telemetry, structure, and systems"
import { draw, fadeIn, film, lagged, pictogram, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const names = ['series', 'forecast', 'logs', 'traces', 'graph', 'dag', 'database', 'model'] as const
    const pictures = names.map((name, i) => pictogram(name, { size: 150, accent: 'teal' }).at((i - 3.5) * 220, -40))
    const labels = names.map((name, i) => text(name, { font: 'mono', size: 32, color: 'dim' }).at((i - 3.5) * 220, 110))
    s.play(lagged(pictures.map((picture) => draw(picture)), { lag: 0.12 }), { duration: 2 })
    s.play(fadeIn(labels))
    s.wait(0.8)
})
```

`PICTOGRAMS` lists every name:

- Telemetry: `series`, `chart`, `forecast`, `threshold`, `anomaly`, `logs`, `traces`, `bars`, `table`, `matrix`, `event`, `alert`.
- Structure: `graph`, `dag`, `tree`, `layers`, `pipeline`, `branch`.
- Systems: `service`, `database`, `queue`, `cloud`, `chip`.
- Machines: `vm`, `process`, `kernel`, `memory`, `disk`, `nic`, `network`, `snapshot`, `clone`, `jail`, `wall`, `key`, `stopwatch`, `bolt`, `proxy`, `certificate`, `sleep`, `shard`.
- Hardware: `core`, `timer`, `firmware`, `irqchip`, `bus`, `drive`, `floppy`, `serial`, `keyboard`, `server`, `laptop`.
- Kernel: `thread`, `interrupt`, `syscall`, `ring`, `page`, `pagetable`, `pin`.
- Workflows: `worker`, `workflow`, `activity`, `signal`, `query`, `update`.
- Code review: `issue`, `pullRequest`, `repository`, `checklist`, `approval`.
- Models: `model`, `tokens`, `vector`, `agent`, `spark`.
- Work: `dashboard`, `terminal`, `container`, `experiment`, `target`, `loop`, `eye`, `message`, `shield`, `browser`, `desktop`, `recording`.
- World: `creditCard`, `warehouse`, `truck`, `microphone`, `forum`, `paywall`.
- General: `document`, `code`, `gear`, `clock`, `user`, `search`, `filter`, `lock`, `deploy`, `check`, `cross`, `warning`, `question`.

Use a pictogram when a card or a legend needs a picture of a kind of thing. When the picture must show real data or a real topology, use `sparkline`, `graph`, or `tree`, and size it with `fitTo`.

## Cards

`card(options)` draws a box with a `title` at the top, a `figure` in the middle, and a `caption` at the bottom. All three are optional. The title and the caption sit at fixed distances from the border. The figure is centered in the space between them, and a figure that is too large is scaled down to fit. So the cards of a row share one layout whatever they hold: give them one `width`, one `height`, and one `captionLines`, which is the number of lines of the longest caption.

```film paired label="Three cards with one layout hold three different figures"
import { card, fadeIn, film, lagged, pictogram, row, sparkline } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const values = Array.from({ length: 48 }, (_, i) => Math.sin(i / 5) + 0.4 * Math.sin(i / 1.7))
    const shared = { width: 500, height: 460, captionLines: 2, font: 'text-serif' } as const
    const cards = [
        card({ title: 'Metrics', figure: sparkline(values, { width: 380, height: 150, color: 'teal', weight: 5 }), caption: 'a number every ten seconds', color: 'teal', ...shared }),
        card({ title: 'Logs', figure: pictogram('logs', { size: 170, color: 'dim', accent: 'yellow' }), caption: 'one line per event', color: 'yellow', ...shared }),
        card({ title: 'Traces', figure: pictogram('traces', { size: 170, color: 'dim', accent: 'purple' }), caption: 'the path of one request through the services', color: 'purple', ...shared }),
    ]
    // A row measures the cards and puts them around the middle of the stage.
    row(cards, { gap: 40 })
    s.play(lagged(cards.map((made) => fadeIn(made, { shift: [0, 24] })), { lag: 0.25 }), { duration: 1.6 })
    s.wait(0.8)
})
```

A caption that is too wide wraps, and a title that is too wide is set in a smaller size, down to 0.6 of `titleSize`. Without a `height`, a card is as tall as its content. Content that cannot fit is an error: a `height` with no room for the figure, a title that is too long, or a caption word that is wider than the card. So a figure never runs into the text. Give the figure to one card only, and before it is on the stage.

`card.frame`, `card.title`, `card.figure`, and `card.caption` are the parts. `card.figureBox` is the space that the figure may use, in the coordinates of the card, where (0, 0) is its middle. `titleSize`, `captionSize`, `padding`, `font`, `color`, `captionColor`, `fill`, `radius`, and `borderWidth` set the look.

## Zones

`zone(content, options)` draws a border around one node or several, with a `title` on the border: a host, a network, a sandbox, a boundary of trust. The zone measures its content when it is built and takes the content as its children. So the zone and what it holds move, fade, and scale as one node, and a zone can hold other zones. `dash: true` draws a dashed border, for a boundary that is a rule and not a wall.

```film paired label="A process inside a jail inside a host, built from the inside out"
import { draw, fadeIn, film, group, rect, text, zone } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const box = (name: string, color: string) => group(
        rect(300, 110, { radius: 14, stroke: color, fill: 'surface', width: 3 }),
        text(name, { size: 38, font: 'text-serif', color }),
    )
    const devices = box('devices', 'purple').at(440, 0)
    const guest = zone([box('guest kernel', 'teal').at(0, -75), box('your code', 'ink').at(0, 75)], { title: 'microVM', color: 'teal', titleSize: 32 })
    const process = zone([guest, devices], { title: 'VMM process', color: 'purple', titleSize: 32, padding: 48 })
    const jail = zone(process, { title: 'jail', color: 'yellow', dash: true, titleSize: 32, padding: 52 })
    const host = s.add(zone(jail, { title: 'host', titleSize: 32, padding: 56, titleAlign: 'center' }).at(0, 0))
    // Everything is on the stage now. Hide what arrives later, then reveal it from the inside out.
    const layers = [guest, process, jail, host]
    for (const node of [devices, ...layers.flatMap((layer) => [layer.frame, layer.title!])]) node.hide()
    s.play(fadeIn(guest.content, { lag: 0.2 }), { duration: 0.8 })
    s.play(draw(guest.frame), fadeIn(guest.title!), { duration: 0.7 })
    s.play(fadeIn(devices), draw(process.frame), fadeIn(process.title!), { duration: 0.7 })
    s.play(draw(jail.frame), fadeIn(jail.title!), { duration: 0.7 })
    s.play(draw(host.frame), fadeIn(host.title!), { duration: 0.7 })
    s.wait(0.8)
})
```

Build the content where you want it, then the zone, then add the zone to the stage. The zone stays where its content was built, and `.at(x, y)` places the middle of its border, as for a card. A node of the content that is already on the stage or in a group is an error. After the zone is built, do not add a node of its content to the stage or to another group: that takes the node out of the zone.

The zone is wide enough for its title. `minWidth` and `minHeight` give the zones of a row one size. `padding` is the space between the content and the border. The border has a gap for the title, so no line crosses the title. A `fill` is faint by default, because its top edge runs behind the title. `zone.frame`, `zone.title`, `zone.backdrop` (the fill), and `zone.content` are the parts. `zone.box` is the middle line of the border, in the coordinates of the zone.

## Steps

`steps(list, options)` draws a row of named steps with one of them lit: the chapters of an argument, the stages of a process, or a list of options that the film goes through one by one. The lit step has a bright border, and its label is in ink. The steps before it are dim. The steps after it are weaker, and a viewer can still read them. `strip.go(index)` moves the light, and the states of the other steps follow.

```film paired label="A strip of four steps lights one step after another, and a note under each step gives its price"
import { film, steps } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const strip = steps([
        { label: 'batching', note: 'price: none' },
        { label: 'SQPOLL', note: 'price: a CPU' },
        { label: 'register', note: 'price: pinned memory' },
        { label: 'I/O polling', note: 'price: a CPU' },
    ], { width: 1700, numbered: true, size: 40, font: 'text-serif' }).at(0, -60)
    s.play(strip.enter(), { duration: 1.2 })
    for (const index of [0, 1, 2, 3]) {
        s.play(strip.go(index))
        s.wait(0.9)
    }
    s.wait(0.6)
})
```

A step is a label, or `{ label, note }`. A label is one line, and a line break in a label is an error. The note is a short text under the box, such as the price of the step. It has one line, or two with a line break. A note has the state of its step: it is in ink under the lit step, in dim under a done step, and as weak as the label under a step that is ahead. `numbered: true` writes the number of each step before its label.

`current` is the index of the step that is lit at the start. Without it, or with `current: null`, no step is lit, and every step is dim and readable: the look for a frame that shows the whole list. `strip.go(null)` puts the light off again. `strip.current` is the index of the lit step after the moves that the film has played so far, and `strip.stateOf(index)` is `'current'`, `'done'`, or `'ahead'`. An index that the strip does not have, or that is not a number, is an error where the film writes the move. A `go` on a strip that is not on the stage brings the strip: it shows at the start of the move, in the state before the move.

`width` is the width of the whole row. The boxes share it: they have one width, with `gap` between them. `.at()` places the middle of the row of boxes, and the notes are under it. `height` is the height of a box, `size` the text size of the labels, `noteSize` the size of the notes, and `color` the border of the lit step. A `height` with no room for a letter with a tail is an error, and the message gives the smallest height that works. A `color` that is not a color is an error when the strip is made. A label that is too wide for its box makes all the labels smaller, so the strip keeps one text size. They go down to 0.7 of `size`. A label that still does not fit is an error, and the message gives the width of a box and the least `width` that is enough. The notes follow the same rule, with their own size.

`direction: 'column'` puts the steps one under the other, for a list at the left of a frame. Then `width` is the width of each box, and the labels are at the left of their boxes. With `numbered`, the numbers are a column of their own: they end at one x, so the names start at one x, also from step 9 to step 10. Each note is between its box and the next one, and every box is further from the next by the room of the longest note. In a row, each label is in the middle of its box, with its number.

```ts
import { connector, film, rect, steps } from 'vizmatic/stage'

export default film((s) => {
    const list = s.add(steps(['slow first request', 'huge page spikes', 'the host runs out', 'one lock'], { direction: 'column', width: 420, numbered: true, current: 2 }).at(-690, 0))
    const picture = s.add(rect(900, 560, { radius: 16, stroke: 'dim', fill: 'surface' }).at(380, 0))
    // The point is in the coordinates of the object. `toWorld` gives its place on the stage.
    s.add(connector(list.toWorld(...list.p(2)), picture, { color: 'dim' }))
    s.wait(2)
})
```

`strip.p(index, edge)` is the middle of an edge of the box of a step, for a line to the picture of the step. The edge is `'top'`, `'bottom'`, `'left'`, or `'right'`. Without it, the point is at the bottom in a row, and at the right side in a column. The bottom point of a step that has a note is under the note, 0.3 of the note size under the tails of its letters, so the line does not touch the note. The points are in the coordinates of the object, and `strip.toWorld(x, y)` gives the place on the stage. `strip.enter()` brings the steps in from the first to the last. `strip.boxes`, `strip.labels`, and `strip.notes` are the parts, and `strip.items` holds one node per step, with its box, its label, and its note.

## Boundaries

`boundary(options)` draws an open line between two sides, such as user space and the kernel, and counts what crosses it. Use it when a film compares designs by their number of crossings: 10,000 system calls, then 313, then 1. A `zone` is a closed border around a group. A boundary is a line that marks cross.

```film paired label="Three interfaces side by side: 10,000 system calls, 313, and 1"
import { boundary, film, lagged } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const shared = { width: 560, size: 30, above: 'user space', below: 'kernel', tally: ['system call', 'system calls'], tallySide: 'over', tickScale: 250 } as const
    const reads = boundary({ ...shared, label: 'read()' }).at(-620, 0)
    const batches = boundary({ ...shared, label: 'batches of 32', color: 'teal' }).at(0, 0)
    const polling = boundary({ ...shared, label: 'polling', color: 'green' }).at(620, 0)
    s.play(lagged([reads, batches, polling].map((line) => line.enter()), { lag: 0.4 }), { duration: 1.6 })
    s.play(reads.cross(reads.x(0), { direction: 'round', label: 'read()' }), { duration: 1.4 })
    s.play(reads.addCrossings(9999), { duration: 2 })
    s.play(batches.cross(batches.x(0), { direction: 'round', label: '32 at a time' }), { duration: 1.4 })
    s.play(batches.addCrossings(312), { duration: 1 })
    s.play(polling.cross(polling.x(0.5), { direction: 'round' }), { duration: 1.4 })
    s.wait(1)
})
```

`.at()` places the middle of the line, and `width` is its length. The `label` names the line, over its left end. `above` and `below` name the two sides, next to the line. `tally` shows the count: `true` for the number alone, a word, or a pair with the word for one and the word for more, such as `['system call', 'system calls']`. `tallySize` sets the text size of the tally, and `tallyColor` the color of its number. `weight` is the width of the stroke, so a wall that is harder to cross can be heavier, and `dash: true` draws a dashed line. No text touches the line.

`line.cross(x)` sends a mark through the line. Where the mark passes, the line lights for a moment and a tick stays. The tally goes up at the moment the mark is on the line. `x` is a place in the coordinates of the line, and `line.x(part)` gives one: 0 is the first place after the names, and 1 is the last place before the tally. A part outside 0 to 1 is an error, and so is an `x` that is not on the line. The `direction` is `'down'`, `'up'`, or `'round'`. A round trip goes down and comes back, as a system call does, and counts once. `reach` is how far from the line the mark starts and ends: 2.7 text sizes by default, which is 70 at size 26. `color` sets the mark and its tick. `counts` is how much the tally goes up, for one mark that carries a batch. `label` is a short text beside the place where the mark starts. It stays there and fades with the mark, so give a crossing with a long text a longer `duration`. It goes on the right of the mark, or on the left when the right has no room, and a text with no room on either side is an error.

`crossThrough([calls, wall], x, options)` sends one mark through several lines, one under the other, such as a system call line and the wall of a virtual machine. Give the lines in the order that the mark meets them, and `x` as a place on the first line. Each line lights, keeps a tick, and counts at the moment the mark is on it.

### Ticks that agree with the tally

A tick is one crossing. `line.addCrossings(count)` runs the tally up with no mark, for a number that is too large to draw, and puts one tick on the line for each of those crossings while the number runs. The ticks go from the left into the places that have no tick, at one spacing of 6 or a little more, and wider on a heavy line. The number runs through whole values and ends exact, and its digits keep their places. The word for one shows where the tally stays at 1 for the time that a viewer needs to read it: half a second, or one second for 20 characters. A tally that only passes 1 keeps the word for more: a number that runs, or the first of several fast crossings. When the count is larger than the number of places on the line, the line is full, and a note under the right end of the line says what one tick stands for, such as "each tick: about 40". So a full line says "many", and the note says how many.

The tick of a crossing with a mark stays where the mark crossed. So for a large number, draw a few crossings and give the rest to `addCrossings`: hundreds of drawn crossings make a band as long as the film spreads them, which says nothing about their number.

To compare lines, or the rounds of one line, give them one `tickScale`: the number of crossings that one tick stands for. A line then has one tick for each `tickScale` crossings, rounded up, whatever way the count grew. With a scale of 250, 10,000 crossings are 40 ticks, 313 are 2, and 1 is 1. Without a scale, each count that is larger than the line fills the line, so 10,000 and 313 look the same but for the note. A crossing with a mark leaves a tick only when the count needs one more. The note shows on each line where a tick stands for more than one crossing. A count that needs more ticks than the line has places is an error that gives the least scale. A line holds 400 ticks, and one more is an error that names `addCrossings`.

`line.clear()` fades the ticks and the note and takes the tally back to 0, for the next round of a comparison. Crossings chain in one `lagged` or `seq`, and `line.count` is the tally after the changes that are scheduled so far.

### How wide a line must be

With `tallySide: 'end'`, the default, the tally is over the right end of the line, next to it, and crossings stay between the names and the tally. The line needs the width of its widest name, the width of the word of its tally, and about 8 text sizes, before it has room for a crossing. With `tallySide: 'over'`, the tally is on a row of its own, over the place where a mark starts, and crossings have the line up to its right end. The line then needs its widest name and about 3 text sizes. With the names "user space" and "kernel" at size 26, a line of 560 keeps 77 for crossings with the tally at the end, and 355 with the tally over. Use `'over'` for lines side by side. A line with no room for a crossing is an error. Under a tally that is over, a mark may not start higher than the default `reach`.

`tallyDigits` is the number of digits that the tally has room for, 6 by default. `x(1)` stays clear of the widest tally, and a count with more digits is an error that says which `tallyDigits` to give.

The bounds of a line hold the way of a mark with the default `reach`, on both sides. With the tally over, the note is under the way of a mark, and the bounds hold it too. So a `zone` or a `card` around a line has room for its crossings. A copy of a line has its own tally and its own ticks, also when `clone()` is called on a group or a zone that holds the line.

`line.line`, `line.labelNode`, `line.sides`, `line.tallyNode`, `line.ticks`, and `line.noteNode` are the parts. The tally is one node: an emphasis such as `indicate(line.tallyNode)` tints the digits and the word. The animation that `cross()` returns has the `mark`. `line.enter()` draws the line from the left, then brings the names, the tally, and the ticks.

## Tags

`tag(word, options)` draws a word in a pill, with a `note` beside it. Use it to say what kind of claim is on the screen and where it comes from: measured, plan, judgment, with the source and its date. `.at(x, y)` places the left end of the pill, so tags with words of different lengths start at one x. `anchor: 'right'` places the right end of the tag, for a tag at the right edge of the frame, and `anchor: 'center'` its middle.

`tagTrack(states, { until })` is a tag that changes with time, at one place. Each state has the time when it starts. One state is on screen at a time: a state fades out before the next one fades in. States that are out of order, or too near to each other for the two fades, are an error.

```film paired label="A tag in the corner changes from a plan to a result when the chart arrives"
import { barChart, fadeIn, fadeOut, film, tagTrack, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    s.add(tagTrack([
        { at: 0, word: 'PLAN', color: 'blue', note: 'the design of March' },
        { at: 2.4, word: 'MEASURED', color: 'green', note: 'the run of June, on 926 questions' },
    ], { until: 5.4, size: 36 }).at(-900, -470))
    const plan = text('Does the new format cost fewer tokens?', { font: 'text-serif', size: 64 })
    s.play(fadeIn(plan), { duration: 0.8 })
    s.wait(1)
    s.play(fadeOut(plan), { duration: 0.5 })
    const chart = barChart([{ label: 'old', value: 21 }, { label: 'new', value: 4 }], { width: 900, height: 560 }).at(0, 60)
    s.play(fadeIn(chart, { shift: [0, 24] }), { duration: 0.8 })
    s.wait(1.8)
})
```

Place a track as any node. It does not know the size of the frame: `.at(-912, -490)` is the top left of a 1920 by 1080 frame. A track is pinned to the screen, so a move or a zoom of the camera does not move it. `tag.pill`, `tag.word`, and `tag.note` are the parts of a tag, and `tag.color(c)` recolors the border and the word.

## Quotes

`quote(words, options)` draws the exact words of a source between quotation marks, with a rule at their left. One line under the words says who said them, when, and where. Use it for a sentence of a paper, of a documentation page, or of a company about itself. Do not write the quotation marks around the words: the object adds them.

```film paired label="A sentence of a source arrives line by line, and then one phrase takes the color of the rule"
import { film, quote, recolor } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const said = quote('the agent loop lives in Temporal rather than on the VM itself', {
        by: 'Cursor', when: '2026-06-02', where: 'What we’ve learned building cloud agents',
        width: 1400, size: 60, color: 'orange',
    }).at(-700, -150)
    s.play(said.enter(), { duration: 1.6 })
    s.wait(0.6)
    // The glyphs of the phrase that the voice says now.
    s.play(...said.find('lives in Temporal').map((glyph) => recolor(glyph, 'orange')), { duration: 0.4 })
    s.wait(2.4)
})
```

`by`, `when`, and `where` make the source line, in that order, with a comma between them. Each one is optional, and the object writes each one as the film gives it. With none of them, the object has no source line. A source line that is wider than the object wraps at a space, and after a `/` of a web address. A part of it with no space and no `/` that is wider than the object is an error. The message names the option, such as `where`: give a shorter text there.

`width` is the width of the object, from the left edge of the rule to the place where the words wrap. No letter passes it. A line has the room of its ink, and an italic f leans past its own place, so such a line can break one word earlier. A line breaks at a space. A no-break space (`\u00a0`) keeps two words on one line, as in `'4\u00a0of\u00a010'`. A line break in the words starts a new line. `size` is the text size of the words, `sourceSize` the size of the source line, and `leading` the height of a line as a multiple of `size`. The words are in the italic of the serif text font, and `italic: false` sets them upright. `font` sets the font of the words and of the source line.

`.at(x, y)` places the top end of the rule, so quotes of different lengths start at one corner. The object is as high as its lines need: read `said.height` to place what comes under it. A film needs two more places. Beside a picture with its middle at the height `cy`, `said.at(x, cy - said.height / 2)` puts the middle of the quote at that height. For a quote that is centered on a point, `said.moveTo([cx, cy])` puts the middle of the rule and the words there.

`color` is the color of the rule. `mark` names one part of the words, or a list of parts, and the object sets them in the color of the rule, or in `markColor`. A part is matched letter for letter. Spaces do not count, and a part may run over the end of a line. A part starts and ends at the borders of words: `mark: 'not'` is the word "not", and not the first letters of "nothing". A part that is in the words more than once is marked at all its places. For one place only, give a longer part, such as `'is not safe'`. To color a part at the moment when the voice says it, leave `mark` out and use `said.find(part)`, as in the example. It gives the glyphs of the part at all its places, with the same rule for the borders of words. For a part that is only inside longer words, `find` gives those places, and `mark` is an error.

A double quotation mark inside the words is a quotation inside the quotation. The object draws it as a single curved mark, the open one at the start of a word and the closed one at any other place: `quote('he said "it is safe"')` shows “he said ‘it is safe’”. After a digit, a straight mark is the sign for inches, and it stays. `mark` and `find` take the words as the film wrote them, with the double marks.

The words are the words of the source. When the film leaves words out, write `[...]` at each such place and set `cut: true`. The object adds no `[...]` by itself, because it cannot know where the missing words were. With `cut`, each `[...]` is in dim, so the viewer sees that it is not a word of the source. A quote with `cut` and no `[...]` is an error.

`said.enter()` brings the quote in: the rule grows down from the top, the words arrive line by line, and then the source line. `said.words`, `said.source`, and `said.rule` are the parts. `said.baseline` is the y of the base line of the first line, and `said.lineEnd(n)` is the x where the ink of line `n` ends. Both are in the coordinates of the object, for a label beside the quote. Empty words, a `mark` that is not in the words, a `width` that cannot hold the longest word, and a `lag` or a `duration` that is not a number are errors. The message for the width names the word and the least width. Words that no-break spaces join count as one word.

A viewer reads about 20 characters in one second, and reads the words and the source line. So a quote stays up for the time of both together: a quote of 100 characters with a source line of 20 characters must stay up for 6 seconds. `said.reading` is the words and the source line as one text, and `readingSeconds(said.reading)` gives that time. The film check reads the words as one text and the source line as a second text, each with its own time. `vizmatic check --motion` reports each one that leaves before its time, as `film.text_brief`. So a quote can pass the check and still leave before the viewer has read the source line.

For a panel behind a quote, put the quote in a `zone` with a fill. The plate is the quote with `padding` at each side, and `.at()` of a zone places its middle:

```ts
import { fadeIn, film, quote, zone } from 'vizmatic/stage'

export default film((s) => {
    const said = quote('the write is durable when the log is on two disks', { by: 'the design document', width: 700, size: 36, color: 'teal' })
    const panel = zone(said, { color: 'gridStrong', fill: 'surface', fillOpacity: 1, padding: 40 }).at(0, 0)
    // The plate fades in while the quote arrives inside it.
    s.play(fadeIn(panel), said.enter())
    s.wait(4)
})
```

`quotePair(first, second, options)` puts two quotes side by side, for two sources that disagree. Each quote is its `words` and its own options. The two have one width and one top line: `width` is the width of the pair, `gap` the room between the two quotes, and each quote has half of the rest. An option of the pair, such as `size`, is for both quotes, and a quote can have its own. Without `gap`, the gap is 3 times the size, or 3 times the larger of two sizes.

`versus` is a word between the two quotes, such as "but". It has the same room at both sides: from the end of the first line of the first quote, and to the rule of the second quote. So beside a short first quote, the word is not in the middle of the gap, where it would read as a part of the second quote. With two sizes, the word has the smaller one, and it stands on the first base line of the quote with that size. Nothing of a pair is over its top line. The room at each side of the word is the height of its letters at the least. A `gap` that leaves less is an error, and the message gives the gap that is enough.

`pair.enter()` brings the first quote, then the word, then the second quote. `pair.quotes` holds the two quotes, and `pair.versus` the word.

```ts
import { film, quotePair } from 'vizmatic/stage'

export default film((s) => {
    const pair = quotePair(
        { words: 'the cache makes every request faster', by: 'the design document', when: '2026-03-02', color: 'blue' },
        { words: 'with the cache, 4 of 10 requests were slower', by: 'the load test', when: '2026-06-11', color: 'red', mark: '4 of 10' },
        { width: 1700, gap: 240, versus: 'but', size: 44 },
    ).at(-850, -120)
    s.play(pair.enter())
    s.wait(4)
})
```

## Chips and named boxes

`chip(label, options)` draws a short label in a box that fits it: a name, a state, a unit. The box takes its width from the label, with room on every side, so a chip is never smaller than its text. `.at(x, y)` places the left end of the box, as for a tag and a row of chips: the three take their width from their text, and they have one rule. `anchor: 'center'` places the middle of the box, and `anchor: 'right'` its right end. `minWidth` gives the chips of a column one width, `round` makes a pill, `room` sets the room at the sides of the label, and `dash` is for a thing that is absent or only planned.

`chipRow(items, options)` lays chips out in a row. The row starts a new line at `maxWidth`, and without `maxWidth` it is one line, however long. `.at(x, y)` places the left end of the first line, and not its middle. With `anchor: 'center'`, each line has its middle at x, and with `anchor: 'right'`, each line ends at x. An item is a label, or `{ text, color, stroke }` for one chip with its own colors.

`namedBox(name, { width, height })` draws a box of a given size with a name in its middle: a component, an actor, a file. A name that is too wide is set smaller, so a name is never larger than its box. `sub` is a second, smaller line under the name. Boxes of one size that stand side by side take `group`, the names of all of them: each box then gets the size at which the longest name fits, so twin boxes do not have names of two sizes. For the stages of a process with one of them lit, use [`steps`](#steps): it gives the boxes one width and moves the light.

```film paired label="Two named boxes, and a row of chips that wraps under them"
import { chipRow, fadeIn, film, lagged, namedBox } from 'vizmatic/stage'

// The film names its font once, and each name and each chip has it.
export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const look = { width: 620, height: 170, size: 56 } as const
    const monitor = namedBox('virtual machine monitor', { ...look, color: 'blue', fill: 'blue', fillOpacity: 0.12, sub: 'one process for each microVM' }).at(-350, -170)
    const kernel = namedBox('host kernel', { ...look, color: 'teal', sub: 'Linux 6.1' }).at(350, -170)
    const walls = s.add(chipRow(['KVM', 'seccomp', 'cgroups', 'namespaces', { text: 'virtio', color: 'green', stroke: 'green' }, 'a jailer', 'rate limiters', 'snapshots'], { maxWidth: 1320, size: 44 }).at(-660, 80))
    // The row is on the stage, so each chip waits hidden for its turn.
    for (const made of walls.chips) made.hide()
    s.play(fadeIn(monitor), fadeIn(kernel), { duration: 0.7 })
    s.play(lagged(walls.chips.map((made) => fadeIn(made, { shift: [0, 16] })), { lag: 0.3 }), { duration: 1.6 })
    s.wait(1.2)
})
```

A name or a second line that would need less than 0.6 of its size is an error, because nobody can read it: shorten the text, or make the box larger. A chip that is wider than its row is an error too. `fitSize(text, width, size, { font })` gives the size at which a line fits a width, for a label in a shape of your own, `textWidth(text, size, { font })` gives its width, and `capHeight(size)` is the room to keep between a text and a line. The two measures need the font, because a width in another font than the text is drawn in is a wrong width.

`chip.frame` and `chip.text` are the parts of a chip, and `chip.box` is its border in the coordinates of the chip. `row.chips` has each chip of a row, and `row.box` is the area of all its lines. `namedBox.frame`, `namedBox.name`, and `namedBox.sub` are the parts of a named box.

A film with many scenes makes these in one font, at sizes that follow the one size of the film, with `sceneKit()`: the `chip`, `chipRow`, `namedBox`, `fitSize` and `textWidth` of a kit are these functions with the font of the film. [Narrated films](narrated-films.md) describes it.

## State grids

`stateGrid(options)` draws a grid of cells, and each cell is in a named state: the pages of a memory, the blocks of a disk, the bits of a bitmap, the hosts of a fleet. The state sets the look of a cell. `grid.change(which, state)` moves cells to another state, one after another in index order, so the viewer sees a sweep.

```film paired label="Pages arrive, a sweep reads most of them into memory, and some of those get dirty"
import { fadeIn, film, stateGrid } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const pages = stateGrid({ columns: 24, rows: 10, cell: 56, initial: 'absent' }).at(0, -40)
    const key = pages.legend([['absent', 'not in memory'], ['present', 'in memory'], ['dirty', 'changed since the last write']], { size: 36, font: 'text-serif' })
    key.at(pages.left[0], 370)
    s.play(pages.enter(), fadeIn(key), { duration: 1.2 })
    s.play(pages.change((index) => index < 168, 'present'), { duration: 1.6 })
    s.play(pages.change((index, state) => state === 'present' && index % 5 === 2, 'dirty'), { duration: 1.2 })
    s.wait(0.8)
})
```

`columns` and `rows` set the shape, `cell` the side of one cell, and `gap` the room between two cells. `.at()` places the middle of the grid. With a `cell` and a `gap` that are whole numbers, the edges of the cells are on whole pixels. The cells are numbered row by row from the top left, so the cell of a row and a column has the index `row * columns + column`. `initial` gives the first states: one name for every cell, a list with one name per cell, or a function of the index. A grid of more than 5,000 cells is an error: let one cell stand for more than one unit, and say so in a label.

A state has a `color`, a `fill`, and a `dash`. `fill` is the opacity of the fill: 0.7 by default, and 0 draws the outline only. `dash: true` draws a dashed outline, for a thing that is not there. Without `states`, the grid has the states of `PAGE_STATES`, for pages of memory: `absent`, `zero`, `present`, `dirty`, `shared`, `copied`, `file`, and `swapped`. For another subject, give your own record, such as `states: { healthy: { color: 'green' }, draining: { color: 'yellow', fill: 0.3 }, down: { color: 'red', fill: 0, dash: true } }`. Without `initial`, every cell starts in the first state of the record.

In `grid.change(which, state)`, `which` is an index, a list of indexes, or a function of the index and the state of a cell. The grid calls the function when the film plays the change. So in `seq(grid.change([0, 1, 2], 'dirty'), grid.change((_, state) => state === 'dirty', 'copied'))`, the second change finds the cells that the first one made dirty. The fill, its opacity, and the outline fade to the new look, and the dashes switch half way. The whole change takes `duration`. By default, each cell takes three tenths of it, so the cells overlap and the sweep is smooth. `lag` sets the delay between two cells, as a fraction of the time of one cell. A cell that already has the state does not change and takes no time. An unknown state and an index outside the grid are errors where the film makes the change.

`grid.stateOf(index)`, `grid.count(state)`, and `grid.indexes(state)` read the states after the changes that the film has played so far, so a label can show a true count, such as `${grid.count('dirty')} dirty pages`. `grid.enter()` brings the cells in row by row. `grid.cells` holds one node per cell, and `grid.p(index)` gives the middle of a cell in the coordinates of the grid, for an arrow or a note.

`grid.legend(items)` makes a key: one sample cell and one name for each state, in one row. The key is a node of its own, so add it to the stage and place it. `.at(x, y)` places the left end of the row, and `y` is the middle line of the cells and the names. An item is the name of a state, or a `[state, label]` pair for a display name. Without `items`, the key lists the states that the grid has now, in the order of `states`. `size`, `gap`, and `font` set the look. The key does not wrap, so make two keys for many long names.

## Event logs

`eventLog(rows, options)` draws a list of records that grows: the event history of a workflow, the steps of an agent, the life of a sandbox. A row has an `id`, a `name` in mono, one short `detail`, and a `state` that sets its color and its mark. Rows arrive at the bottom. When the window is full, the oldest rows leave at the top, and the first line says how many records are above.

```film paired label="A workflow history grows, one record waits, and a replay gets its answers from the history"
import { eventLog, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const log = eventLog([
        { id: 1, name: 'WorkflowExecutionStarted', detail: 'order' },
        { ids: [2, 3, 4], name: 'workflow task', detail: 'worker 71293' },
        { id: 5, name: 'ActivityTaskScheduled', detail: 'chargeCard' },
    ], { title: 'event history', footer: (count) => `${count} events`, visible: 8, size: 34, width: 1000 })
    s.play(log.enter(), { duration: 1 })
    s.play(log.append([
        { id: 6, name: 'ActivityTaskStarted', detail: 'attempt 1', state: 'new' },
        { id: 7, name: 'ActivityTaskCompleted', detail: '"ch_1002"', state: 'new' },
        { ids: [8, 9, 10], name: 'workflow task', detail: 'worker 71293', state: 'new' },
        { id: 11, name: 'ActivityTaskScheduled', detail: 'reserveStock', state: 'waiting' },
    ]), { duration: 3.2 })
    s.play(log.mark((row) => row.state === 'new', 'stored'), log.focus(11), { duration: 0.6 })
    s.wait(0.8)
    for (const id of [5, 7]) {
        s.play(log.focus(id), log.mark(id, 'answered'), { duration: 0.5 })
        s.wait(0.6)
    }
    s.wait(0.6)
})
```

A row has one `id`, a number or a text, and an id is in the list once. The list knows an id by its text, so `7` and `'7'` are one id. A row with `ids` stands for several records that follow each other, such as the three events of one workflow task. Such a row is a fold. It shows its first and its last id, as "2 to 4", and it has a name, a detail, and a state of its own. Give a fold its `rows`, one for each id, when the film opens it later. `time` is a short text at the right end of a row, in mono, such as `+6.01 s`. A `detail` or a `time` that is a number is taken as its text. `family` is a word that the list does not draw: the film reads it to pick rows.

`visible` is the number of lines of the window, and the panel has the height of that many lines from the start. So the panel does not grow while rows arrive, and `.at()` places its middle. When the list has more lines than `visible`, the first line of the window is the count of the records above it, such as "8 earlier", and the other lines show the newest rows. A list that is made with more rows than lines starts at its end, or at the last row that shows when the rows after it wait for `show`. A count is of the records that show: a fold counts each record that it holds, a row that waits for `show` counts none, and a count of 0 draws nothing. `title` is a line over the rows, and `footer` is a function of the count that writes the line under them. `log.count` is the number of records that show, and `log.ids` holds the ids of all records. Both count each record of a fold: 18 rows can hold 26 events.

`log.append(rows)` adds rows at the bottom, one after another. In a full window, all rows move up as one, a row that leaves fades before it reaches the count, and a new row shows when it reaches the window. `lag: 0` brings the rows of one call together, as a group. The default time is 0.4 s for each row, and 0.5 s at least: one row takes 0.5 s, and five rows take 2 s.

The list changes its rows one change at a time. `append`, `fold`, `unfold`, and `scrollTo` are changes of the rows: each starts from the places that the change before it left. Two of them whose times overlap are an error that names the two calls and their times, and gives the advice that fits the two: one `append` with all the rows and the `lag` and the `duration` that keep the pace of the film, a `seq` for two folds, or a shorter `duration` for the first of two cues. A `scrollTo` of a row that shows already moves nothing, so it is free. `mark`, `focus`, `show`, and `enter` move no row, so they play with any change: `s.play(log.append(row), log.focus(row.id), log.mark(5, 'answered'))`. The list takes the calls of one play in their order. So name the `append` before the `focus` or the `mark` of its row, and the `scrollTo` before the `focus` of a row that it brings in: the error of the other order says so.

How fast can rows arrive? A viewer reads about 20 characters in one second, and a row has 20 to 40 characters. At one row per second, the viewer reads each row. At two or three rows per second, the viewer sees each row arrive and reads the names that matter. Above about four rows per second, the list reads as a scroll, not as rows. The film check reports a row that leaves too soon, and its limit is higher than these rates. In a full window a row stays for `(visible - 1) / rate` seconds, and a name that comes once needs its characters divided by 20, in seconds. So the check accepts about 5 rows per second for `visible: 10` and a name of 32 characters, and about 3 for `visible: 6`. For a long history, do not raise the rate. Fold what repeats, such as the three events of each workflow task. Or append in groups: one `append` with `lag: 0` for the rows of one sentence of the voice, and a pause after it. A group with more rows than `visible - 1` sends rows through the window that nobody can read, so keep a group smaller than the window. Or give the old rows to `eventLog()` itself, and append only the rows that the film talks about.

`log.mark(which, state)` changes the state of rows: the color of the name cross-fades, and so does the mark at the left. `which` is an id, a list of ids, or a function of a row. The list calls the function when the film plays the change, so in `seq(log.mark(7, 'answered'), log.mark((row) => row.state === 'answered', 'stored'))` the second change finds the row of the first. The function gets a row as the list shows it, with its `id`, its `ids`, its `state`, and its `family`. `lag` makes the rows change one after another. `log.find(test)` gives the ids of the rows that a function picks: one id for a row, and each id of a fold. So `log.mark(log.find((row) => row.family === 'activity'), 'answered')` changes the same records as the function itself in `mark`. For `row`, `p`, and `focus`, any id of a fold names the fold.

An id names one record, also in a closed fold. `log.mark(7, 'answered')` in a closed fold of 5 to 10 sets the state of record 7 only. The fold then shows the look of the record that was marked last, so the viewer sees the answer. After `unfold`, each record has its own state. To mark a whole fold, give all its ids, as `log.find` does, or a function that picks the fold: `log.mark((row) => row.id === 5, 'answered')`. A function sees a fold as one row, and a fold that it picks takes the state with all its records.

`log.fold(ids, label)` puts rows that follow each other into one fold. The label is the name of the fold, or its fields: `{ name, detail, time, state, family }`. Without a state, the fold has the state of its first row. `log.unfold(firstId)` opens a fold into its rows, and `log.fold(ids)` with no label closes it again as it was. A fold that was made with `ids` and no `rows` has nothing to open into, so `unfold` of it is an error. A fold is one line of the window. So a fold in a full window makes room, and rows come back from above. An unfold in a full window pushes the oldest rows out.

`log.scrollTo(id)` moves the window to a row that is out of it, for a replay that answers an early event of a long history. A row that was above becomes the first row of the window, and a row that was under becomes its last row. The first line says how many records are above, and the last line says how many are under, such as "14 later". A row that shows already moves nothing. A fold or an unfold keeps the window where the film put it, and `append` brings it back to the end first, in the first three tenths of its time. `scrollTo` needs a window of three lines or more. `log.mark` of a row that is out of the window changes its state and moves nothing: the row has the new look when it shows. `log.focus`, `log.row`, and `log.p` of such a row are errors that name the rows that show, so call `scrollTo` first.

`log.focus(id)` puts one outline around a row, and it stays there until the next `focus`. `log.focus(null)` takes it away. The outline is with its row at every frame. It moves with a row that scrolls, and it arrives with a row that arrives, so `s.play(log.append(row), log.focus(row.id))` lights a row as it lands. It leaves with a row that leaves the window, and it does not come back with that row. On its way to another row it fades out at the first row and comes in at the second, so its lines do not cross the text of the rows between the two. `focusLook: 'band'` draws the focus as a faint band behind the row, with no line, for a list where an outline is too loud. `log.outline` is the node of the outline or of the band: set its `stroke` or its `fill` for another color. Its place and how much of it shows belong to `focus`. Each `focus` takes them back from its time on, so a film that fades the node itself does not lose the next focus.

`log.row(id)` is the node of the line that shows a record, and `log.p(id, side)` is the point where a connector to it ends: on the left or the right border of the panel, at the middle height of the row, in the coordinates of the list. For a record in a fold, both give the line of the fold, so any id of a fold works. `log.rows` holds the nodes of the lines in the window. A line has the parts `mark`, `idText`, `range` (the "to 4" of a fold), `name`, `detail`, and `time`. All of these follow the changes that the film has played so far.

`log.p(id)` is the place of the row after the changes that the film has played so far. It is a point, and it does not follow the row: after the next `append` in a full window, another row is there. So a line to a row leaves before the row moves:

```ts
import { connector, eventLog, fadeOut, film, rect } from 'vizmatic/stage'

export default film((s) => {
    const worker = s.add(rect(220, 120, { radius: 14, stroke: 'yellow' }).at(-720, 0))
    const log = s.add(eventLog([
        { id: 6, name: 'ActivityTaskStarted', detail: 'attempt 1' },
        { id: 7, name: 'ActivityTaskCompleted', detail: '"ch_1002"' },
    ], { visible: 4, width: 900 }).at(200, 0))
    // The point is in the coordinates of the list. `toWorld` gives its place on the stage.
    const link = s.add(connector(worker, log.toWorld(...log.p(7, 'left')), { color: 'yellow' }))
    s.wait(1.2)
    s.play(fadeOut(link), { duration: 0.3 })
    s.play(log.append([{ id: 8, name: 'WorkflowTaskScheduled' }, { id: 9, name: 'WorkflowTaskStarted' }, { id: 10, name: 'WorkflowTaskCompleted' }]))
    s.wait(1.2)
})
```

A connector to the node, `connector(worker, log.row(7))`, follows the row while it moves. When the row leaves the window, its node stops on the line of the count that stands for it, so the connector ends on "8 earlier", inside the panel, and not on another row.

The columns are set once, from the first rows, so they line up over every row that comes later. The ids end at one x, and have the room of the longest id of the first rows, two digits at least. The names have the room of the longest name of the first rows, 60% of the width at most. A name or a detail that is too long is cut with an ellipsis, and it is never drawn over the next column. With `ellipsis: false`, a text that does not fit is an error. One error lists every name and every detail that does not fit, and gives the `nameWidth` and the `width` that fit them all, so one change of the numbers is enough. The name of a row with no detail may go on into the room of the details. The list has a column for the times when one of its first rows has a time. `idWidth`, `nameWidth`, and `timeWidth` set these three rooms: use them for a list that starts with few rows, or with none. An id or a time that is wider than its room is an error, because a part of an id names another row. A detail needs room for 8 characters. With less, the list is an error that says how many characters fit, and names the `width` and the `nameWidth` that work. A list with no detail in its first rows gives that room to the names.

`shown: false` on a row gives the row its place from the start and does not draw it, for a list whose lines must not move, such as the eight turns of one run. `log.show(which)` brings such rows in at their places, as the rows of `append` arrive, and `which` is an id, a list of ids, or a function of a row. The footer, the two counts of the window, and `log.count` count the rows that show. A list with more lines than `visible` starts where rows show: the last row that shows is the last row of the window, and the rows that wait after it have their places under it. `show` does not move the window. A row that shows out of the window changes the count of its side, so call `scrollTo` first for a row that the viewer must see arrive. `log.find` gives such a row with `shown: false`. `log.mark` of it changes its state, and the row arrives with that state. `log.focus` of it puts the outline at its place, and the outline shows when the row does. A row that does not show yet cannot go into a fold.

Without `states`, a row has one of the states of `LOG_STATES`, for a history that is written and then replayed: `stored`, `new`, `answered`, `waiting`, and `failed`. Each state has a `mark`, the shape at the left of the row, so that color is not the only sign: a dot for `stored`, a dot in the color of the text for `new`, a check for `answered`, a ring for `waiting`, and a cross for `failed`. For another subject, give your own record, such as `states: { done: { color: 'teal', mark: 'check' }, running: { color: 'yellow', mark: 'ring' }, planned: { color: 'ink', dim: true } }`. A mark is `'dot'`, `'ring'`, `'check'`, or `'cross'`, and a state with no mark has a dot. `dim: true` draws the whole row dim, for a record that is old or not reached. A row with no state starts in the first state of the record.

`log.enter()` brings the panel, the title, and the footer, and then the rows of the window as one. `log.frame`, `log.title`, `log.footer`, `log.rules` (the two lines under the title and over the footer), `log.earlier` and `log.later` (the two lines with a count), and `log.outline` are the parts. `size` is the text size, and `leading` is the height of a row as a part of it. By default, a row is as tall as the outline of the focus needs: the ink of the text, and 0.3 of the text size of clear room between that ink and the outline, at its two sides. That is about 1.9 of `size`, or 1.75 with the details in mono. A list with `focusLook: 'band'`, or with no focus, can take lower rows, such as `leading: 1.5`: the band has no line. With the outline, a `leading` under what the outline needs is an error at the first `focus`, and the error names the least value. `log.pitch` is the distance from one row to the next, so a `codeBlock` beside the list lines up with `leading: log.pitch / size`. `font` is the font of the title, the footer, and the details, and `detailFont` sets the font of the details alone: use `detailFont: 'mono'` for a detail that is data, such as a line of output. `titleSize` sets the text size of the title and the footer, which is 0.85 of `size` by default. The ids, the names, and the times are in mono.

## Bit fields

`bitField(fields, options)` draws a word that is split into named fields: a row of boxes, one per field, with the bit numbers over them. Use it for a virtual address and its table indexes, for the flags of a register or of a page table entry, and for the layout of a structure. A field has its `bits`, a `label`, and a `color`. The first field is at the left, and it holds the highest bits.

```film paired label="A virtual address splits into four table indexes and an offset, and one index points at its table"
import { bitField, connector, draw, fade, fadeIn, film, group, rect, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const address = bitField([
        { bits: 16, label: 'sign extension', unused: true },
        { bits: 9, label: 'PGD', color: 'blue' },
        { bits: 9, label: 'PUD', color: 'teal' },
        { bits: 9, label: 'PMD', color: 'green' },
        { bits: 9, label: 'PTE', color: 'orange' },
        { bits: 12, label: 'offset', color: 'purple' },
    ], { width: 1600, size: 40 }).at(0, -200)
    s.play(address.enter(), { duration: 1.6 })
    // The point is in the coordinates of the object. `toWorld` gives its place on the stage.
    const from = address.toWorld(...address.p('PTE'))
    const table = group(
        rect(420, 240, { radius: 14, stroke: 'orange', fill: 'surface', width: 4 }),
        text('page table', { size: 44, font: 'text-serif', color: 'orange' }),
    ).at(from[0], 250)
    const others = address.fields.filter((field) => field !== address.field('PTE'))
    s.play(...others.map((field) => fade(field, 0.35)), fadeIn(table, { shift: [0, 24] }), draw(connector(from, table, { color: 'orange', width: 4 })), { duration: 0.9 })
    s.wait(0.8)
})
```

A field with a `value`, such as `'0x1fe'`, shows the value inside its box, in mono, and its label under the box. An empty text, `value: ''`, is a value too: an empty box with its label under it. A label and a value are one line each. `unused: true` is for a field that carries nothing, such as reserved bits: a faint box with a hatch.

`word.setValue('PROT', '1')` changes a value in place, such as a flag that goes from 0 to 1. The text in the box fades out, then the new text fades in, so no moment shows two texts. It works on a field that was built with a `value`, because the layout does not change. The new text follows the same rule as the first one: it is set smaller when it is too wide, and a text that cannot fit is an error. `word.values` then holds the new text. A film may play one such animation twice: the second play changes nothing while its text is in the box.

```ts
import { bitField, film } from 'vizmatic/stage'

export default film((s) => {
    // The five low bits of the error code of a page fault on x86. Each one is a flag: bit 3 says that a reserved
    // bit was set in a page table entry. The fault was on a page that is present, so the lowest bit goes to 1.
    const code = s.add(bitField([
        { bits: 1, label: 'INSTR', value: '0', color: 'purple' },
        { bits: 1, label: 'RSVD', value: '0', color: 'blue' },
        { bits: 1, label: 'USER', value: '1', color: 'teal' },
        { bits: 1, label: 'WRITE', value: '1', color: 'orange' },
        { bits: 1, label: 'PROT', value: '0', color: 'red' },
    ], { width: 1100, scale: 'even', size: 40 }))
    s.wait(0.6)
    s.play(code.setValue('PROT', '1'))
    s.wait(0.8)
})
```

`width` is the width of a full row of boxes, and `.at()` places its middle. The width of a box shows the bits of its field: a field starts at the place of its highest bit. `minWidth` is the least width of a box, so that a field of one bit can hold a name, and the wider fields share the rest. `scale: 'even'` gives every field of a row the same width, for a row of flags. Fields that cannot have the least width are an error. `size` is the size of the labels and the values, `height` the height of the boxes, `color` the color of a field that has none of its own, and `font` the font of the labels.

A text that is too wide for its box is set in a smaller size, down to 0.6 of `size`. A text that still does not fit is an error. The message gives the width of the box and what to change, with one `minWidth` that is enough for every field that is too narrow. So no text leaves its box, and two labels under the boxes never meet. Each text takes its own size, so give a smaller `size` when the labels of a row must have one size.

`numbers: 'bits'` is the default. It writes the high bit of each field over its left end and the low bit over its right end, and one number over a field of one bit. `numbers: 'offsets'` counts up from 0 at the left, for the bytes of a structure: each boundary shows one offset, and the right end shows the total. `numbers: false` writes nothing. When two numbers would meet, one of them is not drawn: the number of a field of one bit goes before a number of a wider field, and the low bit of a field goes before its high bit. Three numbers go last, and only one of them can take the place of another: bit 0, the offset at the start of a row, and the total.

`wrap` is the number of bits, or of bytes, in one row. The fields then fill rows from the top, for the layout of a structure, and a row of that many bits is `width` wide. A field that would cross the end of a row is an error: split the field, or change `wrap`. With `numbers: 'offsets'`, each row starts with its own offset. `rowGap` is the room between two rows. Without it, the rows have the room that the numbers and the labels under the boxes need.

With the proportional scale, a field starts at the place of its bit in every row, so the boundaries of the rows are in line. This holds too when `minWidth` widens a narrow field: the bits under it or over it, in the other rows, are as much wider. A last row with fewer bits is as much shorter, and it starts at the left end of a full row, also when it is the only row. So `.at()` places the middle of a full row, and of all rows from the top to the bottom, and two structures with one `wrap` and one `width` have one scale. With `scale: 'even'`, each row shares the whole `width` among its own fields, so the boundaries of two rows are not in line, and a last row is as long as the others.

The example is `struct io_uring_sqe` of Linux 6.12, from `include/uapi/linux/io_uring.h`. A union is shown by its first member.

```film paired label="The 64 bytes of a structure arrive in four rows of 16 bytes, with the offset of each field over it"
import { bitField, film } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const entry = bitField([
        { bits: 1, label: 'opcode', color: 'orange' }, { bits: 1, label: 'flags', color: 'orange' }, { bits: 2, label: 'ioprio' }, { bits: 4, label: 'fd', color: 'teal' }, { bits: 8, label: 'off' },
        { bits: 8, label: 'addr', color: 'green' }, { bits: 4, label: 'len', color: 'green' }, { bits: 4, label: 'rw_flags' },
        { bits: 8, label: 'user_data', color: 'purple' }, { bits: 2, label: 'buf_index' }, { bits: 2, label: 'personality' }, { bits: 4, label: 'splice_fd_in' },
        { bits: 8, label: 'addr3' }, { bits: 8, label: '__pad2', unused: true },
    ], { width: 1600, wrap: 16, numbers: 'offsets', size: 28 })
    s.play(entry.enter(), { duration: 2.4 })
    s.wait(0.8)
})
```

`word.field('PTE')` is the node of one field, by its label or by its index. It holds the box, the texts and the numbers of the field, so fade the other fields to light one. `word.p('PTE')` is the middle of the bottom edge of its box, and `word.p('PTE', 'top')` the middle of the top edge, in any row. A line to a table starts there. `'left'` and `'right'` give the middles of the side edges, for the field at an end of a row. The points are in the coordinates of the object, and `word.toWorld(x, y)` gives the place on the stage. When the label is under the box, start the line from the top edge. A point from `p()` is fixed: it does not follow the object when the object or its group moves later. `connector(word.boxes[i], node)` takes the box itself, so that line follows. `word.range('PTE')` gives the high and the low bit of a field, or its first and its last offset. `word.total` is the sum of the bits, and `word.enter()` brings the fields in from the left, row by row. `word.fields`, `word.boxes`, `word.labels`, `word.values`, and `word.numbers` are the parts. Two fields may have one label, such as "reserved". Name such a field by its index.

## Token strips

`tokens(items, options)` draws a strip of cells, one for each token, word, character or byte: the text as a language model reads it. Put IDs or training targets in rows below the tokens. Use a bracket to name a span, or slide a window across the strip. When you split or merge tokens, their values, brackets, and window move with them.

```film paired label="Shift next-token targets left and exclude the four prompt targets from the loss"
import { fadeIn, film, lagged, text, tokens } from 'vizmatic/stage'

const WORDS = ['<s>', 'user', 'Sit', '!', 'bot', 'Good', 'dog', '</s>']

export default film({ fps: 30 }, (s) => {
    const chat = tokens(WORDS, {
        size: 44, even: true, label: 'input',
        rows: { position: WORDS.map((_, index) => index), target: WORDS },
        spans: [{ from: 1, to: 3, label: 'user turn', color: 'orange' }, { from: 4, to: 7, label: 'assistant turn', color: 'green' }],
    }).at(90, -70)
    s.play(chat.enter(), { duration: 1.6 })
    s.wait(0.6)
    // Each position predicts the token after it, so the row of targets moves one cell to the left.
    s.play(chat.shiftRow('target', -1), { duration: 1.4 })
    s.wait(1)
    // The loss counts what the assistant writes. The four targets that the prompt gives get the label -100.
    const prompt = [0, 1, 2, 3]
    s.play(chat.mark(prompt, 'masked'), lagged(prompt.map((index) => chat.setValue('target', index, '-100')), { lag: 0.5 }), { duration: 1.8 })
    s.play(fadeIn(text(`the loss counts ${chat.count - 1 - prompt.length} of ${chat.count - 1} targets`, { size: 44 }).at(0, 260)), { duration: 0.5 })
    s.wait(1.5)
})
```

A token is a text, or an object with its `text`: `{ text: ' cat', state: 'generated', color: 'teal', values: { id: 3797 } }`. A space in a token shows as a middle dot, as a tokenizer shows it. An empty string leaves a cell blank. For a line break in an annotated strip, use a visible token such as `\\n`. `color` is the color of the cells, `colors` a ramp of colors across the strip, `gap` the room between two cells, and `radius` the corners.

`size` is the text size of the tokens. It is 22 when the film gives none, as it always was: a size for a figure in a document. For a film at 1080p, give `size: 32` or more. The values of the rows, the names of the rows and the labels of the brackets are 0.82 of `size`, which is 26 px at `size: 32`, and `rowSize` sets them. The tokens and the values are in mono, and `font` is the font of the tokens. The names and the labels are in the font of the film.

A cell is as wide as its text and its values need. `minWidth` is the least width of a cell, and `even: true` gives every cell the width of the widest one, so the columns are a grid. `width` is the room of the strip on one line: the first token is at the left end of the room, `.at()` places the middle of the room, and the layout measures the room, so `fitted(region, (width) => tokens(words, { width }))` fills a region. Tokens that do not fit in the room are an error that names the width that fits. Without `width`, the strip is as wide as its tokens, and `.at()` places their middle. The left edge stays fixed as the strip grows or shrinks. A split or merge can move a token center when its width changes.

A token has one of the states of `TOKEN_STATES`: `kept`, `masked`, `generated`, `cached`, and `dropped`. A kept token has a plain outline. Hatching marks a masked cell, a bottom bar marks a generated token, and a corner dot marks a cached token. A dropped token has a dashed outline and a line through its text. For another subject, give your own record, such as `states: { ...TOKEN_STATES, accepted: { color: 'green', mark: 'check' }, rejected: { color: 'red', mark: 'cross', dim: true } }`. A state has a `color` (without one, the cell keeps its own color), a `fill` opacity, a `dash` outline, a `dim` text, and a `mark`: `'hatch'`, `'strike'`, `'bar'`, `'dot'`, `'check'`, or `'cross'`. A token with no state is in the first state of the record.

`strip.mark(which, state)` changes the state of tokens, one after another from the left. `which` is an index, a list of indexes, or a function of a token and its index. The strip calls the function when the film plays the change, so in `seq(strip.mark([0, 1], 'cached'), strip.mark((token) => token.state === 'cached', 'dropped'))` the second change finds the tokens of the first. `strip.stateOf(index)`, `strip.count`, `strip.texts`, and `strip.find(test)` read the strip after the changes that the film has played so far. `find` takes the text of a token, or a function, and gives indexes: `strip.find('the')`, `strip.find((token) => token.state === 'masked')`.

`rows` gives the rows of values under the cells, by name: `rows: { position: [0, 1, 2], id: [464, 3797, 3332] }`. A value is a text or a number, and each value is under the middle of its token. The name of a row is at its left, and `label` names the line of cells in the same way. `strip.setValue(row, index, value)` changes one value in place: the old text fades out, then the new one fades in. `strip.shiftRow(row, by)` moves the values of a row by whole cells: with -1, each value goes under the token before its own, as the targets of a language model are under its inputs, and the value that leaves the strip fades out. A value that is too wide for its cell is an error that names the `minWidth` that fits, so give `even: true` to a strip whose values change cells. `strip.value(row, index)` reads a value. `strip.row(name)` is the node of a row, with its `name` and its `values`, and `strip.column(index)` is the cell of a token with its value in each row, so `indicate(strip.column(5))` lights one column through all rows. A strip with rows has no `sub` under a chip: `sub` is the one line of the old row of chips, and a row takes its place.

`spans` gives the brackets over runs of tokens: `spans: [{ from: 0, to: 4, label: 'system prompt', color: 'purple' }]`. A bracket goes from the first cell of its run to the last, with its label over its middle. A bracket whose line or label would meet another one is a level higher. `strip.span(id, from, to, { label, color })` draws a new bracket by its id, with the id as its label unless `label` gives another. A later call with the same id slides the bracket to other tokens, and a new `label` takes the place of the old one. `strip.span(id, null)` takes it away. A bracket that would move onto another one is an error that names the two. `strip.window(from, to)` puts one outline around a run of cells. The next call slides it and changes its size, and `strip.window(null)` takes it away. `strip.windowRange` and `strip.spanRange(id)` give the first and the last token of each.

```film paired label="Split two words into ASCII bytes and merge a repeated pair in both words"
import { fadeIn, film, text, tokens } from 'vizmatic/stage'

// Each character in these two ASCII words occupies one byte.
const bytes = (ascii: string) => [...ascii].map((letter) => ({ text: letter, values: { id: letter.charCodeAt(0) } }))

export default film({ fps: 30 }, (s) => {
    // The room is for the ten bytes: the strip is at its widest after the split.
    const strip = tokens(['rain', ' train'], { size: 56, width: 1100, rows: { id: [] } }).at(40, -80)
    s.play(strip.enter(), { duration: 0.8 })
    s.wait(0.6)
    // The later word splits first, so the index of the first one stays.
    s.play(strip.split(1, bytes(' train')), strip.split(0, bytes('rain')), { duration: 1.2 })
    s.wait(0.5)
    const byteCount = strip.count
    // Count each pair of neighbors: a window of two cells goes along the strip.
    for (let index = 0; index + 1 < strip.count; index++) s.play(strip.window(index, index + 1), { duration: index === 0 ? 0.4 : 0.22 })
    s.play(strip.window(null), { duration: 0.3 })
    // Merge each occurrence of the chosen pair and assign the same ID to both results.
    const mergeAll = (left: string, right: string, id: number) => {
        const starts = strip.find((token, index) => token.text === left && strip.texts[index + 1] === right)
        // From the right, so that a merge does not change the index of a pair that is still to come.
        s.play(...starts.reverse().map((index) => strip.merge(index, index + 1, { values: { id } })), { duration: 1.1 })
    }
    mergeAll('r', 'a', 256)
    mergeAll('ra', 'i', 257)
    mergeAll('rai', 'n', 258)
    s.play(fadeIn(text(`${byteCount} bytes become ${strip.count} tokens`, { size: 44 }).at(0, 200)))
    s.wait(2)
})
```

`strip.append(token)` adds a token at the end, or a list of tokens one after another, and the tokens that are there do not move. `from` is a node or a point of the stage: the token starts there and flies to its place, such as the bar of the candidate that the model picked. `strip.split(index, pieces)` cuts one token into two pieces or more, and `strip.merge(from, to, token)` joins the tokens from `from` to `to` into one. Without `token`, the new text is the old texts, joined. A piece has the state and the color of its token unless it names its own, and the new token of a merge has the color of the first old one, and their state when they share one. A piece and a new token give their `values`, and the values of the old tokens leave. When the pieces spell the token, each letter keeps its place and moves to its piece, and the box is cut between two letters. With another text, such as a character that becomes its bytes, the old text leaves before the new one comes.

The indexes of a change are those of the strip when the film plays the change: after the changes before it in the same play. So merge pairs from the right, as the example does, or play one change after another. An index that the strip does not have then is an error that names the tokens that it has. Changes to different tokens can share one play. Schedule marks on the same token in time order. Each mark must finish before the next one starts. Use `seq` or separate calls to `s.play` if their times overlap. A `split` or a `merge` of a token that the change before it still brings in is an error that says to play them one after the other. A strip with `maxWidth` wraps and is a plain row of chips: its tokens take states, and it takes no rows, brackets, window, or change of its tokens.

`strip.token(index)` is the cell of a token, with its `box`, its `text` and the marks of its state. `strip.p(index, edge)` is the middle of an edge of the cell, in the coordinates of the strip: `'bottom'` by default, and `'top'`, `'left'` or `'right'`. The bottom point is under the rows of values and the top point is over the brackets, so a line from it crosses no text of the strip. `strip.region({ from, to, row })` is the box of a run of cells in stage pixels, or of the part of a row under them, for `place` and `beside` of the layout. These places are fixed: read them again after a change moves a token. `strip.arcs(from, weights)` draws curved lines from one token to others of the same strip, for attention. `strip.links(other, pairs)` draws lines to the tokens of another strip, one for each pair of indexes, from under the upper token to over the lower one: a source and its translation, a question and the words of a passage. A pair with a third number, a weight from 0 to 1, has a wider and brighter line for a weight near 1. Create the lines after placing both strips. Recreate the lines after moving their endpoints. The two strips are one over the other, with a room of 1.5 of `size` or more from under the values of the upper one to over the brackets of the lower one: with less, the call is an error that says to move the strips apart.

```film paired label="Reuse a cached prefix and append the generated answer one token at a time"
import { draw, fade, fadeIn, film, namedBox, tokens } from 'vizmatic/stage'

const SYSTEM = ['You', ' are', ' a', ' helpful', ' bot', '.']

export default film({ fps: 30 }, (s) => {
    const first = tokens([...SYSTEM, ' Hi'], { size: 40, label: 'request 1', width: 1300 }).at(110, -300)
    const second = tokens([...SYSTEM, ' Bye'], { size: 40, label: 'request 2', width: 1300, color: 'purple' }).at(110, 0)
    s.play(first.enter(), { duration: 1 })
    s.play(second.enter(), { duration: 1 })
    // A line joins each pair of tokens that are the same, from the left.
    const same = first.links(second, SYSTEM.map((_, index) => [index, index] as const), { color: 'yellow' })
    s.play(draw(same, { lag: 0.35 }), { duration: 1.8 })
    s.wait(0.6)
    // The model has the state of these tokens: it reads them from the cache.
    s.play(second.mark((_, index) => index < SYSTEM.length, 'cached'), fade(same, 0), fade(first, 0.35), { duration: 1.2 })
    s.play(second.span('prefix', 0, SYSTEM.length - 1, { label: 'read from the cache', color: 'yellow' }), { duration: 0.7 })
    // The model writes the answer one token at a time. Each token flies from over the model to the end of the strip.
    const model = namedBox('model', { width: 260, height: 110, color: 'green' }).at(540, 300)
    s.play(fadeIn(model), { duration: 0.4 })
    for (const word of [' See', ' you', '!']) {
        s.play(second.append({ text: word, state: 'generated' }, { from: [model.top[0], model.top[1] - 50] }), { duration: 0.8 })
        s.wait(0.25)
    }
    s.play(second.span('answer', SYSTEM.length + 1, second.count - 1, { label: 'written by the model', color: 'green' }), { duration: 0.7 })
    s.wait(1.5)
})
```

`strip.enter()` brings the chips in from the left, each with its values, and the names, the brackets and the window with them. `strip.chips`, `strip.rows`, `strip.spans`, `strip.frame` (the outline of the window) and `strip.caption` (the name of the line of cells) are the parts, after the changes that the film has played so far. While a window slides, its outline passes over the token text. A motion scan can report these frames as `film.text_crossed`. Check that the outline clears the text when the window settles.

## Code and tokens

`codeBlock(source)` draws syntax-colored code as glyphs. `morphCode(a, b)` morphs one version into another, and tokens that stayed travel to their new places. `tokens(items)` draws a strip of cells for the tokens of a language model: see [Token strips](#token-strips). `attentionMatrix` draws a heatmap with labels.

`block.find(fragment)` returns the glyphs of a piece of the code, to color them or to move them. A fragment that is one token, such as `lo`, matches every such token. Any other fragment, such as `lo + hi`, matches as text inside a line, and spaces do not count. Pass a line, counted from 0, as the second argument to search that line only.

```ts
import { codeBlock, film } from 'vizmatic/stage'

export default film((s) => {
    const block = s.add(codeBlock('const mid = (lo + hi) / 2', { size: 60 }))
    for (const glyph of block.find('lo + hi')) glyph.color('red')
    s.wait(1)
})
```

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

The `language` option names the syntax. The languages are `ts`, `python`, `rust`, `go`, `java`, `c`, `sql`, `bash`, and `plain`, and four languages for specifications and proofs: `tla` for TLA+, `dafny`, `lean`, and `smt` for SMT-LIB. In those four, a prime such as the one in `x'` is part of the code and does not start a string. An unknown name uses the TypeScript rules.

`arrayCells(values)` draws a row of cells for algorithms, and `neuralNet(layers)` draws a layered network whose edges you can pulse.

## Terminal output

`terminal(lines, options)` draws the output of a real program as a terminal shows it: a panel, a bar with a `title` at the left and a dim `note` at the right, and the lines in the mono font. Use it when the viewer must see that a number comes from a real run. The title names the file or the host, and the note says where and when the program ran. A line is a string, which is a line of output, or `{ text, kind, color }`. The kind `'command'` draws the prompt before the text. The kind `'note'` is a dim line that the film adds, such as `[...]` for lines that it left out.

```film paired label="A command is typed, its output prints, and one number of the output lights"
import { film, recolor, terminal } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const run = terminal([
        { text: './one-byte', kind: 'command' },
        'mapped 1 GiB at 0xffff7c000000',
        'Rss before the write:      0 kB',
        'Rss after the write:       4 kB',
        'minor faults:              1',
    ], { title: 'data/runs/01-one-byte.txt', note: 'Linux 7.0, arm64, 2026-11-08', size: 44 })
    s.play(run.enter(), { duration: 0.6 })
    s.play(run.type(0), { duration: 0.8 })
    s.play(run.print(), { duration: 1.2 })
    s.wait(0.6)
    s.play(recolor(run.find('4 kB'), 'yellow'), { duration: 0.4 })
    s.wait(1.6)
})
```

The text is drawn with the exact characters that you give, and each character has its own column, so the columns of a table stay aligned. The spaces at the start of a line and inside it keep their columns. The spaces at the end of a line are not content: they are not drawn, and they do not count for the width or for `columns`. A tab is an error: expand the tabs to spaces first. A line break inside a line and a control character, such as a part of a color code, are errors too. An empty string is an empty line.

A character that the mono font does not have comes from another font of the library. It stands in the middle of its column, and it is drawn smaller when it is too wide for the column. A glyph that is wider than 1.2 columns is an error that names the character: replace it. A character that no font has is drawn as an empty box, and `vizmatic check` reports it. Box drawing characters join along a line. They do not join from one line to the next, because the lines are 1.5 text sizes apart.

The panel sizes itself. Its width follows `columns`, the number of characters in one line, and its height follows the number of lines. Without `columns`, the panel is as wide as its longest line, or wider when the title and the note need the room. With `columns`, a title and a note that do not fit in the bar are an error, and so is a line that is longer. `clip: true` cuts such a line and ends it with a dim ellipsis. `.at()` places the middle of the panel. `size` is the text size, `prompt` is the text before a command, and `color` is the color of the border and the bar.

A terminal holds 40 lines at most. The frame holds fewer at most sizes: a panel of n lines is `size × (1.5 × n + 2.7)` tall. So a frame of 1080 holds 38 lines at size 18, 25 lines at size 26, and 20 lines at size 32, with no room above or below the panel. The terminal does not know the frame. `vizmatic check` reports the lines of a panel that are off the frame. For a longer output, leave lines out and put a note line in their place.

By default a terminal shows all its lines, for a picture that does not move. A film that types and prints starts empty: give `shown: false`, or play `run.enter()`. `run.enter()` brings the panel and the bar, with no line. `run.type(line)` types a command character by character, after its prompt. A command that is already shown is an error. `run.print()` brings the next block of lines, one after another, each line at once. A block starts at the first line that is not yet shown, and it ends before the next command that is not yet shown. A command at the start of a block arrives whole. So `run.type(0)` then `run.print()` types the command and prints its output. `run.print()` alone shows the command and its output, for a film that does not want the typing, and a second `run.print()` goes on with the next block. `run.print({ from: 1, to: 3 })` prints lines 1, 2 and 3, whatever their kind. `run.showLines()` fades in all the lines that are left, together, for a film that does not want the typing.

The terminal keeps a record of the lines that are shown, so two prints in one `seq` follow each other. `run.enter()` in the same `play` as a `type` or a `print` keeps the lines that they show, in both orders. A terminal that is not on the stage at its first `type` or `print` comes with its panel and no other line. A terminal in a group or a zone that is not on the stage brings that group, and keeps its place in it.

`run.find(text, occurrence)` returns one node that holds the glyphs of a part of a line: color it, `indicate` it, or point a `callout` at it. It matches the exact characters, spaces included, in the commands, the output and the notes. `occurrence` counts the matches from 0, from the first line to the last. A text that is not there is an error, which says so when `clip` cut the text off. `codeBlock.find` is different: it returns the glyphs of every match as a list, and spaces do not count there. The second argument of `run.find` is an occurrence, and the second argument of `codeBlock.find` is a line. `run.p(line)` is the start of a line and `run.p(line, 'right')` is its end, in the coordinates of the panel, so `run.toWorld(...run.p(4, 'right'))` is that point on the stage. `run.frame`, `run.bar`, `run.title`, `run.note`, `run.lines`, and `run.prompts` are the parts.

## One font for a film

`film({ font })` sets the font of every text of the film that names no font. Set it once, and no object needs its own `font`.

```film paired label="A card, a bar chart and a note in the serif text font, with the values in mono"
import { barChart, card, film, pictogram, text } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    s.add(card({ title: 'the CPU', figure: pictogram('core', { size: 170 }), caption: 'one core, one thread', width: 560, titleSize: 60 }).at(-520, -30))
    s.add(barChart([{ label: 'minor faults', value: 412 }, { label: 'major faults', value: 37 }], { width: 640, height: 400, labelSize: 40 }).at(380, -110))
    s.add(text('the page faults of one run', { size: 44, color: 'dim' }).at(380, 250))
    s.add(text('perf stat -e faults', { size: 40, font: 'mono', color: 'dim' }).at(380, 330))
    s.wait(2)
})
```

The font is one of the families of `text()`: `'sans'`, `'serif'`, `'text-serif'`, `'mono'`, or `'noto'`. A film with no `font` looks as it did before: a text with no font is sans.

| Text | Font |
|---|---|
| A `text()` with no `font`. | The font of the film. |
| A label, a title, a note, a caption, the name of a lane or a row, a key, and the numbers on an axis of a chart, of `lanes`, and of `axes3d`. | The font of the film. |
| A `text()` or an object with its own `font`. | That font. |
| Code, a value, an address, and an id: `codeBlock`, `terminal`, `arrayCells`, `tokens`, `counter`, `decimal`, the values and the bit numbers of a `bitField`, the value over a bar, the values in a `heatmap`, the subtitle, the values, the badge and the tags of an `infoBox`, and the word of a `tag`. | Mono. |
| The label of a `connector`, and the label of an edge of a `graph`. | The font that the film names. Mono in a film with no `font`, as before. |
| The text of an SVG from `fromSvg`. | The font that the film names, and mono for text that the SVG sets in a monospace family. Sans in a film with no `font`, as before. |
| The words and the source line of a `quote`. | The serif text font, in every film. |
| `tex`, and each label that is math: the numbers and the labels of `axes` and `numberLine`, `matrix`, `angleMark`, the names of `axes3d`, a `braceLabel` or a `labeledDot` without `plain: true`, and a `label3d` without `math: false`. | The math font. |
| The center label of a `donut`. | The display serif. |

Each object that draws a label in the font of the film takes `font`, and that option wins: `barChart(data, { font: 'sans' })`. For a `tag`, `font` is the font of the word and `noteFont` is the font of the note. For a `graph`, `font` is the font of the node labels and `edgeFont` is the font of the edge labels. For `arrayCells`, `tokens`, `counter` and `decimal`, `font` replaces mono. In a strip of `tokens`, `font` is the font of the tokens: the values of its rows stay in mono, and the names of its rows and the labels of its brackets are in the font of the film. `font: 'sans'` is a font that the film names: the label of a connector is then sans, not mono.

The layout follows the font. A text measures its glyphs when it is made, so a card wraps its caption and a zone opens its border for the title with the widths of the font of the film. `'sans'` and `'text-serif'` have a semibold for `weight: 600`, so the title of an `infoBox` or of a `callout` is heavier than its body in both. `'serif'`, `'mono'` and `'noto'` have one weight, and such a title is regular there.

The film sets its font while its callback runs and while a frame is drawn. So a scene in its own function has it, and so has a `dynamic` drawing. Make each node inside the callback. The film loads its fonts while the callback runs, so a text at the top of a film file fails when the file loads, and the error says to move it into the callback. A text that is made outside a callback when its font is loaded, such as in a second film of one run, is in sans. A figure from `fromComponent` keeps the fonts of its component.

Two films can compile at the same time, as the film elements of one page do, and each has its own font. One case is not safe: the callbacks of both films await, and one of them makes a text after its `await` and before its next call to the stage. That text can have the font of the other film. Compile such films one after the other, or call the stage first, for example `s.wait(0)`.

## Images

Prepare an image once, then place it with the existing `image` stage primitive.
Preparation validates its encoded bytes, dimensions and optional SHA-256 digest.
The returned asset is immutable and embeds its pixels, so a rendered film does
not depend on a filename or a network request.

```ts
import { fileURLToPath } from 'node:url'
import { film, image, resolveImageAsset } from 'vizmatic/stage'

const figure = await resolveImageAsset('./assets/figure.png', {
    baseDir: fileURLToPath(new URL('.', import.meta.url)),
    id: 'figure-1',
})

export default film((s) => {
    s.add(image(figure, { width: 1200, height: 700 }).at(0, -40))
    s.wait(2)
})
```

`resolveImageAsset` accepts a local filename in Node, a `Uint8Array`, or a PNG
base64 data URI. Browser callers pass embedded bytes or a data URI. It awaits
browser decoding before returning. It does not fetch remote URLs.

The supported format is a noninterlaced, 8-bit PNG, including RGB, RGBA,
grayscale and palette images. Transparency is retained. Encoded input is limited
to 16 MiB and decoded dimensions to 16,777,216 pixels. Animated PNGs and compressed
color profiles are rejected. Convert other image formats or PDF pages to a local
PNG before preparing them.

For a pinned asset manifest, pass `sha256`, `mediaType: 'image/png'`, `width` and
`height` in the preparation options. Width and height here are the expected
intrinsic pixel dimensions. The resolved asset reports its actual digest and
dimensions. A missing file, invalid PNG, wrong media type, dimension mismatch or
digest mismatch throws `ImageAssetError`.

### Fit, crop and transform

`image(asset, options)` returns a node centered on its origin. Its normal node
methods move, rotate, scale and fade it. `opacity` remains an image option too.

- `width` and `height` describe the destination box in stage units. A single
  dimension preserves the image proportions.
- `fit: 'contain'` is the default. It fits inside that box without stretching.
- `fit: 'cover'` fills the box by cropping the center of the source region.
- `crop: { x, y, width, height }` selects intrinsic source pixels before fitting.
  The crop must stay inside the image.

```ts
import { image, resolveImageAsset } from 'vizmatic/stage'
const figure = await resolveImageAsset('./assets/figure.png')
const detail = image(figure, {
    width: 900,
    height: 500,
    crop: { x: 100, y: 80, width: 800, height: 400 },
    fit: 'contain',
    opacity: 0.9,
})
```

The existing `image(src, { width, height, opacity })` constructor remains
available. Compilation awaits and embeds PNG, JPEG and GIF sources. GIF playback uses the first decoded frame for export. Relative local
filenames use the process working directory; explicit preparation with `baseDir`
makes the dependency clearer. Use a prepared asset for fit and crop options.
HTTP and HTTPS image strings remain supported and are fetched once during compilation. Set `imageNetwork: 'deny'` on the film or in compile overrides to require offline inputs. Node also honors `VIZMATIC_DISABLE_NETWORK=1` and `VIZMATIC_OFFLINE=1`. Requests have a ten-second timeout and the same encoded-byte limit. Missing files, failed HTTP requests and decoder errors are fatal. Use prepared PNG assets for reproducible local inputs.

### Migrating browser URL images in 0.8

Browser URL images must be fetchable under CORS. A cross-origin server must
permit the film's origin so compilation can read, validate and embed its bytes.
Earlier players could display a non-CORS image while tainting the canvas. That
display-only path now fails with a loading error. Copy the image into local
assets or embed its bytes and call `resolveImageAsset` for a reproducible film.
Use `imageNetwork: 'deny'` when the film must stay offline.

### Preflight and checks

Compilation awaits static and keyed image sources, including hidden pictures.
Use prepared assets when constructing nodes inside dynamic drawing callbacks.
An image discovered by a later dynamic frame uses the same awaited asset path
as other deferred stage resources, rather than painting an empty placeholder.

SVG and Node exports carry the embedded bytes. Browser playback uses the decoded
asset before its first paint. `paintFrame` outside a browser needs an `ImageLookup`
that supplies decoded pixels; an absent source throws instead of silently
dropping the image.

`checkFilm` reports an image preparation failure as `film.image_asset`, an error.
Image destination bounds now participate in `frameInkBounds`, blank-content
checks and `film.off_canvas` diagnostics. Fully transparent PNGs and crops do not
count as visible content; opaque white paper does. Legacy PNGs retain 16-bit and
Adam7 support with the same bounded scanline preflight. The checks inspect the image rectangle;
they do not read text inside raster pixels. Keep citations and captions as stage
text so ordinary text checks can inspect them.

Asset discovery and source citation belong to the calling application. Include
the image bytes and any source-document or preprocessing manifest in its render
fingerprint. Preparing an asset establishes its pixel identity, not permission to
use a source or the correctness of its caption.
