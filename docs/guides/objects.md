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

`riemann`, `areaUnder`, `tangentLine`, and `secantLine` work with an `Axes`. `numberLine` draws one axis alone: see [Number lines](#number-lines).

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
| `matrix(rows)` | A bracketed matrix of numbers or TeX, for a formula. For cells that light and change, use `heatmap` with a `size`. |
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

`barChart`, `histogram`, `scatter`, `lineChart`, `pie`, `donut`, and `heatmap` take data and expose their parts for animation. `scatter` also has points with a name, a search for the nearest points, and areas that shade: see [Scatter planes](#scatter-planes).

For slices, masks, or image patches, see [Tensor grids](#tensor-grids).

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

Two spans that overlap on one lane are an error, because a lane does one thing at a time. A span may start at the time where another one ends. A span that is a part of another span is a child span, with `inside`: see "Child spans" below. A `pitch` with no room for an arrow between two bars is an error when the object has a handoff, and the message names the least pitch.

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

`.at()` places the middle of the time area. The names are outside it, at the left, so a long name needs room there. `width` is the width of the time area, `barHeight` the height of a bar, `pitch` the distance from one lane to the next, and `size` the text size. `flow.names`, `flow.rails` (the line of each lane), `flow.events`, `flow.axis`, and `flow.cursor` are the parts. `flow.spans`, `flow.handoffs`, `flow.marks`, `flow.links`, and `flow.brackets` hold the same events by kind. An event has a `shape` (its bar, its arrow, its dot, or the line of its bracket), a `text` (its label, or null), a `tip` (the arrow head of an open span, or null), an `edge` (the outline of an idle span or the hatch of a down span, or null), a `sign` (the sign of its outcome, or null), and an `eventId` (its `id`, or null). `flow.x(time)` and `flow.y(lane)` give a place on the object for a brace or a note.

The object draws rails and ordinary bars first, followed by brackets, boundaries, deadlines, arrows, and links. A span with an outcome draws above the bar that starts at its end, so the whole outcome sign stays visible. Marks draw last. The cursor is under all of them, and it passes behind the labels: each label, each bar and each arrow of dashes has a patch under it, in the color of `backing`. The default `backing` is the background of the look, which fits an object on the background of the film. On a panel of another color, set `backing` to the color of the panel. Where no one color is behind the object, set `backing: null`: inside a zone with a fill, over a picture, or in a film that is rendered with `--background none`. Then the object draws no patch, the line of a lane shows through its bars, and the cursor passes through the labels. So with `backing: null`, also set `cursor: false`.

### A deadline, and the time that is left

`deadline` draws a line of dashes at one time, over all lanes: the time that a request must beat. Its `label` is over the top of the line. With `drain: true`, a bar over the lanes shows the time that is left. The bar ends at the deadline. While its clock runs, the other end follows the cursor. The bar empties at the deadline. A `label` that is a function gets the time that is left and returns the text, so the text counts down.

```film paired label="Two failed attempts and a backoff leave 3.5 seconds for a proposed six-second retry"
import { assertEqual, beside, fadeIn, film, lanes, place, sceneArea, text } from 'vizmatic/stage'

export default film({ title: 'Can the caller afford another retry?', fps: 30 }, (s) => {
    const budget = 20, attempt = 6, backoff = 2
    const firstStart = 0.5, firstEnd = firstStart + attempt
    const secondStart = firstEnd + backoff, secondEnd = secondStart + attempt
    const retryAt = secondEnd + backoff, wouldFinish = retryAt + attempt
    const flow = place(lanes(['caller', { name: 'provider', color: 'teal' }], [
        { lane: 'caller', start: 0, end: retryAt, idle: true, label: 'waiting for an answer', outcome: 'cancelled' },
        { from: 'caller', to: 'provider', at: firstStart, label: 'request' },
        { lane: 'provider', start: firstStart, end: firstEnd, id: 'first', label: 'attempt 1', outcome: 'failed' },
        { from: 'provider', to: 'provider', at: [firstEnd, secondStart], label: 'retry' },
        { lane: 'provider', start: secondStart, end: secondEnd, id: 'second', label: 'attempt 2', outcome: 'failed' },
        { lane: 'provider', start: secondEnd, end: retryAt, idle: true, id: 'backoff', label: 'wait' },
        { bracket: [retryAt, wouldFinish], lane: 'provider', labelSide: 'under', id: 'next', label: `retry (${attempt} s)` },
    ], {
        domain: [0, 24], width: 1440, pitch: 180, barHeight: 60, size: 32,
        ticks: [0, 4, 8, 12, 16, 20, 24], format: (t) => `${t} s`,
        deadline: { at: budget, drain: true, label: (left) => left > 0 ? `${left.toFixed(1)} s left` : 'deadline' },
    }), sceneArea())
    s.add(beside(text('Can the caller afford another retry?', { size: 64 }), flow, 'above', 'loose'))
    s.play(flow.enter())
    s.play(flow.advance('first'), { duration: 2.4 })
    s.wait(1)
    s.play(flow.advance('second'), { duration: 2.8 })
    s.wait(1)
    s.play(flow.advance('backoff'), { duration: 1.2 })
    const left = flow.remaining()
    assertEqual(left, 3.5, 'time left after backoff')
    const note = beside(text(`At ${retryAt} s, the caller has ${left} s left for a ${attempt} s retry.`, { size: 38 }), flow, 'under', 'loose')
    s.play(fadeIn(note), { duration: 0.4 })
    s.wait(2)
    // Only the bracket advances through the proposed attempt.
    s.play(flow.advance('next'), { duration: 2.8 })
    assertEqual(flow.remaining(), -2.5, 'time past the deadline if the caller retries')
    s.wait(2.5)
})
```

`flow.remaining()` is the time that is left to the deadline at the time of the cursor. After the deadline it is less than 0, and so is the value that a `label` function gets. `drain: { from: 4 }` starts the clock of the bar at a time that is not the first end of the domain. `deadline` also takes a list, such as a timeout and a later limit. Then `flow.remaining(1)` or `flow.remaining('give up')` names one deadline, by its index or by its label. Drain bars share one row, so give them separate time windows when several deadlines have bars. Keep the countdown text short at every value, including negative values. Deadline labels share a row. If two labels touch, use shorter text or move the deadlines farther apart. The line defaults to red. Without a `domain`, the domain holds the deadlines. A deadline comes in with `flow.enter()`. `flow.deadlines` holds one node per deadline: its line, then the two bars when it drains, then its text.

The line starts over the room that a label takes over the first lane. No label of an event is on the line: a label takes a place that is clear of the line, and when it has none, `lanes()` throws. The drain follows the horizontal position of the cursor. The cursor stops below the labels over the first lane. A line with no `drain` serves any time that matters, such as a cutoff or a kill time. Use a bracket to compare a proposed attempt with the deadline. In the film above, the caller stops after the backoff. The bracket shows when another attempt would finish.

### Outcomes, and a lane that is down

An event that does not end well takes `outcome`. `'failed'` is an error or a timeout, and its sign is a cross on a red disc. `'cancelled'` is a stop on purpose, and its sign is a square on an orange disc. The shape says the outcome, so the sign reads without its color. A span has the sign on its end, and the sign arrives when the cursor reaches that end. A mark with an outcome is the sign, in place of the dot. A handoff with an outcome shows a lost message. Its line ends at the sign on the sending side of the boundary. The lanes leave enough room for the shaft and sign at small pitches. It crosses no boundary, so no counter counts it. An `idle` span with `outcome: 'failed'` is a wait that runs out. An `open` span has no end, so it takes no outcome.

`down: true` is a span where the lane is not there: an outage, a GPU that is lost, a worker in quarantine. It is a hatched block with a faint fill, in red unless it has a `color`. The hatch says the state without the color. Its label is over the block, because the hatch would cross a text inside it. A lane that is down does no work, so a down span and a work span that overlap are an error, and a down span takes no `outcome` and no `inside`. With `open`, the lane stays down to the end.

### Links and brackets

A link is an arrow from a time on one lane to another time on a lane: `{ from: 'R3', to: 'R1', at: [50, 40] }`. `at` has two times, the time on `from` and the time on `to`. Use it for a retry, for a cache hit that points at the write that made the entry, or for one record on two clocks. The arrow can point back in time. The link shows when the cursor reaches the later of its two times. Between two lanes it is a straight line. On one lane it is an arc above the top row, with its label over the arc. If a bracket would cross that arc, put the bracket below the lane with `labelSide: 'under'`. The endpoints refer to lanes. Use a mark with `inside` to point to a particular child span. An end of a link is on the edge of the bar that the lane has at that time. With no bar there, it is near the line of the lane, where a dot would be. No control passes with a link, so it crosses no boundary. `dashed: true` draws it with dashes.

A bracket names a window of time: `{ bracket: [0, 280], label: 'time to first token: 280 ms' }`. It is over its `lane`, or under it with `labelSide: 'under'`. Without a lane, it is over the first lane or under the last one. It starts when the cursor leaves its first time, its line grows with the cursor, and it gets its second end and its name when the cursor reaches its last time. A name that is wider than its bracket stays at the middle. Beside a line at one end of the bracket, such as a deadline, the name starts a little after that end. Two brackets at one side of a lane may meet at one time, as the gaps between tokens do. Two that overlap are an error: put one of them at the other side, or on another lane.

```film paired label="A GPU fails. The process and its requests end with their signs, the reply is lost, one request runs again on the other GPU, and the first GPU stays out"
import { beside, fadeIn, film, lanes, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const fleet = lanes(
        [{ name: 'router', color: 'dim' }, { name: 'GPU-0', color: 'blue' }, { name: 'GPU-1', color: 'teal' }],
        [
            { lane: 'GPU-0', start: 0, end: 22, id: 'process', label: 'process 4117', outcome: 'failed' },
            { lane: 'GPU-0', start: 2, end: 22, inside: 'process', label: 'R1', outcome: 'cancelled' },
            { lane: 'GPU-0', start: 8, end: 22, inside: 'process', label: 'R2', outcome: 'failed' },
            { from: 'GPU-0', to: 'router', at: 22, label: 'reply', outcome: 'failed' },
            { lane: 'GPU-0', start: 22, end: 50, down: true, label: 'quarantine' },
            { lane: 'GPU-0', start: 50, end: 60, open: true, label: 'readmitted' },
            { lane: 'GPU-1', start: 4, end: 18, label: 'R3' },
            { from: 'GPU-0', to: 'GPU-1', at: [22, 27], id: 'retry', label: 'R2 again' },
            { lane: 'GPU-1', start: 27, end: 41, label: 'R2' },
            { lane: 'GPU-1', start: 44, end: 56, label: 'R4' },
            { bracket: [22, 50], lane: 'GPU-1', labelSide: 'under', label: 'GPU-0 out for 28 min' },
        ],
        { width: 1400, size: 30, barHeight: 52, pitch: 190, ticks: [0, 10, 20, 30, 40, 50, 60], format: (time) => `${time} min`, domain: [0, 60] },
    ).at(110, 0)
    s.play(fleet.enter(), { duration: 1 })
    // The cursor stops where the process fails, and a note names the cause over that time.
    s.play(fleet.advance('process'), { duration: 2.6 })
    const note = beside(text('a CUDA error: the process is not safe', { size: 30, color: 'yellow' }), fleet, 'above', 'normal', fleet.region({ lane: 'GPU-0', at: 22 }))
    s.play(fadeIn(note), { duration: 0.5 })
    s.wait(1.8)
    s.play(fleet.advance('retry'), { duration: 1.6 })
    s.wait(1)
    s.play(fleet.showAll(), { duration: 3.2 })
    s.wait(2)
})
```

One lane for each clock makes a timeline of two clocks: the time of an event, and the time when its record became readable. A link joins the two marks of one record, a deadline with no bar is the cutoff, and a bracket is the window:

```ts
import { film, lanes } from 'vizmatic/stage'

export default film((s) => {
    const clocks = lanes(['event time', 'readable at'], [
        { lane: 'event time', at: 8, label: 'H1', labelSide: 'right' },
        { lane: 'readable at', at: 8.2, label: 'H1', labelSide: 'under' },
        { from: 'event time', to: 'readable at', at: [8, 8.2] },
        { lane: 'event time', at: 8.5, label: 'H2', labelSide: 'right' },
        { lane: 'readable at', at: 10.5, label: 'H2', labelSide: 'under' },
        { from: 'event time', to: 'readable at', at: [8.5, 10.5], label: 'arrives 2 h late' },
        { bracket: [8, 9], lane: 'event time', label: 'window 08:00 to 09:00' },
    ], { width: 1300, pitch: 200, domain: [7.5, 11], ticks: [8, 9, 10, 11], format: (time) => `${time}:00`, deadline: { at: 9, label: 'predict now' } })
    s.play(clocks.enter())
    // At the cutoff, H2 happened and is not readable yet.
    s.play(clocks.advance(9))
    s.play(clocks.showAll())
})
```

### Child spans: the trace of a request

A span with `inside` is a child of the span with that `id`, on the same lane: retrieval inside an answer, a tool call inside a turn. A child has a row of its own under its parent, as high as the parent and close under it, so the lane reads as the trace of a request. Each child takes the first free row below its parent. Children that overlap in time need separate rows, so the row number can exceed the nesting depth. The lanes under a lane with children move down by its rows.

```film paired label="The trace of request 205: retrieval, generation and a tool call inside the answer. The cursor stops at the first token"
import { beside, fadeIn, fadeOut, film, lanes, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const trace = lanes(
        [{ name: 'request 205', color: 'blue' }, { name: 'model API', color: 'purple' }],
        [
            { lane: 'request 205', start: 0, end: 430, id: 'answer', label: 'answer' },
            { lane: 'request 205', start: 0, end: 90, inside: 'answer', id: 'retrieval', label: 'retrieval', color: 'teal' },
            { lane: 'request 205', start: 90, end: 380, inside: 'answer', id: 'generation', label: 'generation', color: 'purple' },
            { lane: 'request 205', start: 150, end: 230, inside: 'generation', id: 'tool', label: 'tool call', color: 'orange' },
            { lane: 'request 205', at: 280, inside: 'generation', id: 'first-token', label: 'first token' },
            { lane: 'request 205', start: 380, end: 430, inside: 'answer', label: 'gate', color: 'green' },
            { from: 'request 205', to: 'model API', at: 90, label: 'prompt' },
            { lane: 'model API', start: 90, end: 380, label: 'streams 120 tokens' },
            { bracket: [0, 280], label: 'time to first token: 280 ms' },
        ],
        { width: 1400, size: 30, barHeight: 52, ticks: [0, 100, 200, 300, 400], format: (time) => `${time} ms`, domain: [0, 440] },
    ).at(120, 20)
    s.play(trace.enter(), { duration: 1 })
    s.play(trace.advance('retrieval'), { duration: 1.6 })
    s.wait(0.6)
    s.play(trace.advance('tool'), { duration: 2 })
    s.wait(0.6)
    // The cursor stops at the first token, and a note points at it.
    s.play(trace.advance('first-token'), { duration: 1.4 })
    const note = beside(text('the user sees nothing before this', { size: 30, color: 'yellow' }), trace, 'above', 'normal', trace.region({ event: 'first-token' }))
    s.play(fadeIn(note), { duration: 0.5 })
    s.wait(2)
    s.play(fadeOut(note), { duration: 0.4 })
    s.play(trace.showAll(), { duration: 2.2 })
    s.wait(2)
})
```

A child is in the time of its parent and on the lane of its parent: a child that is outside either one is an error, and so is an `inside` that names no span. The label of a child is in its bar, or beside its bar in its row, because its parent is over it. A mark with `inside` is on the bar of that span, and its label can be on that bar, beside the dot. A handoff between a lane with children and a lane under it meets the lowest bar that the lane has at that time, so its arrow passes through no child. `flow.y(lane)` is the middle of the first row of a lane, and `flow.region({ lane })` holds all its rows.

### Stop at an event, and point at it

An event takes an `id`. `flow.advance('first-token')` moves the cursor to the time of that event and stops there: the end of a span or a bracket, the time of a mark or a handoff, the later time of a link. Events through that time appear together. Use consecutive plays or `seq` for advances on one cursor. A clone starts at the visible cursor position and can advance independently. `flow.region({ event: id })` is the box of the event on the stage, for a note: `beside(note, flow, 'above', 'normal', flow.region({ event: 'first-token' }))` puts the note over the whole object, at the x of the event. `flow.p(id)` is the middle of the top of the event, in the coordinates of the object, for the end of an arrow from a note. It takes `'bottom'`, `'left'`, or `'right'` for another edge, and `flow.toWorld(...flow.p(id))` is that point on the stage. Both give the place of the complete event, also before the cursor reaches it.

`flow.find(id)` is the node of an event, so `spotlight(flow.find('retrieval').shape)` lights one bar with its label. `flow.timeOf(id)` is the time where `advance(id)` stops, and `flow.timeOf(id, 'start')` is the start of a span or a bracket. `flow.stateOf(id)` says where the event is at the time of the cursor: `'ahead'`, `'running'` for a span or a bracket that the cursor is in, and `'done'`. An event with an outcome is `'failed'` or `'cancelled'` in place of `'done'`. `find`, `timeOf`, `stateOf`, `region`, and `p` also take the index of the event in the list in place of an id. A number is a time for `advance`. Two events with one id are an error, and so is an id that no event has. The message lists the ids.

For a typed list of the original spans, handoffs, and marks, use `LaneEvent[]`. Use `LaneTimelineEvent[]` for a list that also contains links or brackets. Both lists work with `lanes()`.

Every text of the object has the size `size`, 26 by default: the names of the lanes, the labels, the ticks, the text of a deadline, and the name of a bracket. A mark or handoff uses a sign as wide as `size`. A span with a short bar uses a smaller sign.

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

## Request queues

`requestQueue(items, options)` moves identifiable requests from waiting lines into server slots. Use it to show how a batch refills, why a request misses its deadline, or what happens when two tenants share a block pool.

```film paired label="Five requests share three batch slots across six decode steps"
import { beside, countUp, counter, film, fitted, linear, place, requestQueue, sceneKit } from 'vizmatic/stage'

// Work is the number of decode iterations the request needs.
const REQUESTS = [
    { id: 'A', work: 2, color: 'blue' }, { id: 'B', work: 4, color: 'teal' }, { id: 'C', work: 6, color: 'purple' },
    { id: 'D', work: 4, color: 'orange' }, { id: 'E', work: 2, color: 'green' },
]

export default film({ fps: 30, font: 'text-serif', title: 'Continuous batching refills each free slot' }, (s) => {
    const { area, heading } = sceneKit()
    const queue = place(fitted(area, (width) => requestQueue(REQUESTS, { width, slots: 3, size: 36, names: { slots: 'batch slots' } })), area)
    // Count completed work across all requests, including those that have left the batch.
    const totalWork = REQUESTS.reduce((sum, request) => sum + request.work, 0)
    const done = () => queue.ids.reduce<number>((sum, id) => sum + queue.stateOf(id).work! - queue.stateOf(id).left!, 0)
    const steps = beside(counter(0, { size: 40, font: 'text-serif', suffix: ` of ${totalWork} decode steps complete` }), queue, 'under', 'loose')
    s.add(heading('Continuous batching refills each free slot'))
    s.play(queue.enter(), { duration: 1 })
    s.play(queue.admit(queue.next(3)), { duration: 2.4 })
    s.add(steps)
    s.wait(0.4)
    // Refill the first free slot after each pair of iterations.
    for (let round = 0; round < 3; round++) {
        const units = queue.find((item) => item.state === 'running').reduce<number>((sum, id) => sum + Math.min(2, queue.stateOf(id).left!), 0)
        s.play(queue.run(2), countUp(steps, done() + units), { duration: 1.6, ease: linear })
        s.play(queue.finish(), ...(queue.count('waiting') > 0 ? [queue.admit()] : []), { duration: 1.2 })
        s.wait(0.4)
    }
    s.wait(1)
})
```

An item has an `id`, a text or a number, and an id is in the queue once. The queue knows an id by its text, so `7` and `'7'` are one id. `work` is the size of the item in units of work: decode steps, tokens, seconds. It is a whole number. An item with `work` shows the units that are left at its right end, and a bar fills it from the left as it runs. An item with no `work` has no number and no bar, and its id is in the middle. `color` sets the color of the border and the bar. `running: true` on an item of the first list puts it in a slot from the start.

The texts are large enough for a lesson at 1080p. With the default `size` of 28, an id is 28 px and bold, and the names, the counts, the numbers of work, the waits and the statuses are 26 px. All of them follow `size`, and they are in the font of the film. `idFont: 'mono'` sets the ids in mono. All items have one width, `itemWidth`. Without it, the width has room for the longest id of the first items with its number, and it is 4.3 text sizes at the least. An id that is too wide for an item is set smaller, down to 0.6 of `size`. An id that is still too wide is an error that gives the `itemWidth` to set.

`width` is the width of the whole object, and `.at()` places its middle. The slots are one column at the right, and the lines get the places that fit: `queue.places`. An item enters from behind the items already in line, and an item that leaves a slot goes out at the right by one place, so the object has that room at its two ends. The layout measures the object at its full `width`, also while no item is there, so `fitted(region, (width) => requestQueue(items, { width }))` fills a region. A line with more items than places draws the first ones, and three dots at its far end stand for the others. The count over the line is of all its items. A width with no room for one place is an error that gives the least width.

Each line has its name and its count over its head, such as "waiting 4". The slots have theirs over the first slot, such as "running 2 / 3". Two more counts come with the first item that they count: "done" under the slots, and "rejected" under the lines. `names` sets the three words, and `null` for `done` or `rejected` draws no count there. `counts: false` leaves the names alone. `queue.enter()` brings the lines, the slots and the names, and then the items.

`queue.admit()` takes the head of the first line that has an item, and gives it the first free slot. The item leaves its line by one place, crosses to the height of its slot, and comes into the slot by one place. It changes its height only in the room between the lines and the slots, so it meets no item of another line and no item in a slot. Its line closes up behind it. With an id, `admit` takes that item, and with a list it takes the items one after another, each in its own part of the time. `queue.next(count)` gives the ids that `admit()` takes next, so `queue.admit(queue.next(queue.freeSlots))` fills the free slots. A line serves its head first: an id that is not the head of its line is an error, and so is an `admit` with no free slot.

`queue.run(units)` lets every item in a slot work for a number of units. The bar grows and the number counts down, at one speed. An item never does more than its work. `queue.finish()` drains the slots: with no argument, each item that has no work left goes out at the right and fades, and its slot shows its outline again. `queue.finish(which)` takes an id, a list of ids, or a function of an item. Use it for an item with no `work`. An item that has work left is an error: `run` it first.

A batch that refills is one play: `s.play(queue.finish(), queue.admit())`. Name the `finish` first. The slot that the item leaves is then free for the next one, and the new item comes in behind the one that leaves: it is never nearer to the slot than that one is to its way out. The `finish` must end no later than the `admit`.

`queue.reject(which, status)` sends waiting items away with a status, such as `'503'`, `'429'` or `'timeout'`. In the first fifth of the time the border of the item turns red with dashes, and a cross and the status show under it. The item stays for the viewer to read it. It fades from 0.6 to 0.8 of the time, and its line closes up in the last fifth, when the place is empty. `which` is an id, a list of ids, or a function of an item, which the queue calls when the film plays the change: `queue.reject((item) => item.late, 'timeout')`. Only an item that waits can be rejected. A status that is wider than the room under an item is an error.

`queue.wait(which, value)` runs the wait of waiting items to a value, as a number under each item. The value is in the unit of the film, and `format` writes it. With a `deadline`, the number turns red and bold when the wait reaches it, and the border of the item turns red with dashes. `queue.stateOf(id).late` is true while the item waits at or past its deadline. When the item leaves the line, the flag clears and `stateOf(id).wait` retains its last wait.

```film paired label="Request R-105 exceeds its wait budget and receives a 503"
import { beside, fadeIn, film, fitted, place, requestQueue, sceneKit } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif', title: 'R-105 runs out of time in the queue' }, (s) => {
    const { area, heading, note } = sceneKit()
    const queue = place(fitted(area, (width) => requestQueue([
        { id: 'R-103', work: 4, running: true }, { id: 'R-104', work: 5 },
    ], { width, slots: 1, size: 36, idFont: 'mono', deadline: 250, format: (ms) => `${Math.round(ms)} ms`, names: { slots: 'model worker', rejected: 'refused' } })), area)
    const budget = beside(note('Queue wait budget: 250 ms'), queue, 'above', 'loose', queue.region({ line: 0 }))
    s.add(heading('R-105 runs out of time in the queue'))
    s.play(queue.enter(), fadeIn(budget), { duration: 1 })
    s.play(queue.arrive([{ id: 'R-105', work: 3 }, { id: 'R-106', work: 2 }]), { duration: 1.2 })
    s.wait(0.4)
    // The worker is busy, and the two waits run.
    s.play(queue.run(4), queue.wait('R-104', 190), queue.wait('R-105', 130), { duration: 2.4 })
    // R-104 is in time: the worker is free 60 ms before its budget ends.
    s.play(queue.finish(), queue.admit(), { duration: 1.2 })
    s.wait(0.4)
    // R-105 crosses its deadline while R-104 is still running.
    s.play(queue.run(3), queue.wait('R-105', 310), { duration: 2.6 })
    s.wait(0.6)
    s.play(queue.reject((item) => item.late, '503'), { duration: 2 })
    s.wait(1.2)
})
```

`lines` gives the queue more than one waiting line, from the top: a line is a name, or `{ name, color }`. Use it for a second tenant, or for a priority. An item names its line by its name or its index, and takes the color of its line. `queue.admit()` serves the first line that has an item, so the order of the lines is their priority. A scheduler of the film that picks another line names the head of that line: `queue.admit('B-1')`. With two lines or more, two slots are as far apart as half of two lines, so a line is at the height of a slot or in the middle between two slots.

`pool` adds a pool of fixed blocks under the slots, such as the pages of a KV cache: a number of blocks, or `{ blocks, name, columns }`. An item with `blocks` takes that many when it comes into its slot, and gives them back when it finishes. `queue.take(id, count)` gives an item in a slot more blocks, as a request whose cache grows with each token. An item takes the first free blocks by index, so the next item uses again the blocks that another gave back. A free block is an outline of dashes, and a block that is taken has the color of its owner. The name over the pool shows the count, such as "KV blocks 6 / 8", and `queue.freeBlocks` gives the free ones. An `admit` or a `take` for more blocks than are free is an error. So a film reads the state first, and shows why a request waits:

```film paired label="Tenant B gets a slot when tenant A releases its KV blocks"
import { beside, fadeIn, fadeOut, film, fitted, place, requestQueue, sceneKit } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif', title: 'A free GPU slot still needs KV blocks' }, (s) => {
    const { area, heading, note } = sceneKit()
    const queue = place(fitted(area, (width) => requestQueue([
        { id: 'A-1', line: 'tenant A', work: 2, blocks: 3, running: true },
        { id: 'A-2', line: 'tenant A', work: 3, blocks: 2 },
        { id: 'B-1', line: 'tenant B', work: 2, blocks: 4 }, { id: 'B-2', line: 'tenant B', work: 2, blocks: 2 },
    ], { width, slots: 3, size: 34, lines: [{ name: 'tenant A', color: 'teal' }, { name: 'tenant B', color: 'orange' }], names: { slots: 'GPU slots' }, pool: { blocks: 8, name: 'KV blocks' } })), area)
    s.add(heading('A free GPU slot still needs KV blocks'))
    s.play(queue.enter(), { duration: 1 })
    s.play(queue.admit('A-2'), { duration: 1.2 })
    s.wait(0.4)
    // A seat is free for B-1, and the pool is short: the film reads both from the queue.
    const needs = queue.stateOf('B-1').blocks, free = queue.freeBlocks
    const short = beside(note(`B-1 needs ${needs} blocks, and ${free} are free`, { color: 'ink' }), queue, 'under', 'normal', queue.region({ line: 'tenant B' }))
    s.play(fadeIn(short), { duration: 0.5 })
    s.wait(1)
    s.play(queue.run(2), { duration: 1.4 })
    // A-1 ends. Its three blocks go back to the pool, and B-1 takes them and one more.
    s.play(queue.finish(), queue.admit('B-1'), fadeOut(short), { duration: 1.6 })
    s.wait(0.6)
    // The cache of A-2 grows by two blocks, and the pool is full.
    s.play(queue.take('A-2', 2), { duration: 0.8 })
    s.wait(1.6)
})
```

`queue.arrive(items)` takes one item or a list. The items of a list arrive one after another, and `lag` sets how much later each one starts, as a part of the time of one. An id that the queue has is an error. An item is all there at the middle of its way in.

Each animation leaves the queue in the state that the next one starts from, and the queue changes its bookkeeping when the film plays an animation. So in `seq(queue.arrive({ id: 'N' }), queue.admit('N'))` the second call finds the item of the first. `queue.stateOf(id)` gives what an item is and where: its `state` (`'waiting'`, `'running'`, `'done'` or `'rejected'`), its `line`, its `place` in the line from 0 at the head, its `slot`, its `work` and the units that are `left`, its `blocks`, its `wait`, `late`, and the `status` that it left with. `queue.find(test)` gives the ids that a function picks, `queue.count(state, line)` counts the items in a state, and `queue.ids` holds all ids in the order of arrival. `queue.freeSlots` is the number of free slots.

A rejected call leaves the queue ready to retry. The queue takes the calls of one play in their order, and the calls of a film in the order of their times: a call that starts before a call that the film made earlier is an error. Some calls cannot share their time:

- An item takes one change of its state at a time: it arrives, then it goes to a slot, then it leaves.
- The slots take one `admit` at a time, so that no two items cross. Give one `admit` all the items, as a list.
- A line takes one change of its order at a time: an `admit` from it, or a `reject` from it.
- An `arrive` can share its time with an `admit` or a `reject` of its line, and with another `arrive`. The item that arrives stays behind the items that move, so it must be in its place no sooner than they are.
- Call `run` or `take` after the request reaches its slot. Wait for its work and block allocation to end before calling `finish` on it. A `wait` in the line can run alongside work in a slot.

A call that breaks one of these is an error that names the two calls and their times, and says what to change. An ease that goes back, or past its end, does not move an item back: the queue takes the furthest point that the ease has reached.

`queue.item(id)` is the node of one item: its box, its bar, its id and its numbers. Fade it, light it or circle it as one node, and a connector to it follows the item. The queue moves the item, so do not move that node. `queue.p(part, edge)` is a point of a part in the coordinates of the object, and `queue.region(part)` is its box on the stage, for `place` and `beside` of the layout. A region encloses all four corners, including when a parent rotates or scales the queue. A part is `{ line }` for the row of a line, `{ line, place }` for one place, `{ slot }`, `{ block }`, `'slots'` or `'pool'`. `queue.rails` (the line of each waiting line), `queue.captions`, `queue.more` (the three dots), `queue.seats`, `queue.slotsCaption`, `queue.doneTally`, `queue.rejectedTally`, `queue.blocks`, `queue.poolCaption` and `queue.chips` are the parts. A queue has 1 to 12 slots, 1 to 4 lines, and a pool of 256 blocks at the most.

Each state has a sign beside its color. An item that waits is in a line, and one that runs is in a slot with its bar. A late item has dashes and a red number, and a rejected one has dashes, a cross and its status. A free slot and a free block are outlines of dashes.

Use `ringBuffer` where the lesson is about the ring: two indexes that wrap. Use `requestQueue` for admission, batching and scheduling. For a population of a hundred requests or more, draw one mark for each with `unitChart` or `stateGrid`, and keep the queue for the few that the viewer follows.

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

## Number lines

`numberLine(options)` places values on a single axis. `range` sets the endpoints and `length` sets the distance between them in stage pixels. Use `step` for regular ticks or `ticks` for a list of representable values.

```film paired label="Unequal ticks show the rounding error for two inputs"
import { assertEqual, fadeIn, film, numberLine, sceneKit } from 'vizmatic/stage'

const GRID = [1, 2, 4].flatMap((power) => Array.from({ length: 8 }, (_, k) => power * (1 + k / 8))).concat(8)
export default film({ fps: 24 }, (s) => {
    const { heading, source } = sceneKit({ size: 40 })
    s.add(heading('The distance to the nearest tick is the rounding error'), source('Three fraction bits give eight steps between each power of two and the next.'))
    const ruler = numberLine({
        ticks: GRID, tickLabels: [1, 2, 4, 5.5, 8], length: 1600, size: 40,
        points: [{ name: 'a', value: 1.04, label: 'input a: 1.04', color: 'teal' }, { name: 'b', value: 5.3, label: 'input b: 5.30', color: 'orange' }],
    }).at(0, 20)
    s.play(ruler.enter(), { duration: 1.5 })
    s.wait(2.5)
    for (const name of ['a', 'b']) {
        const lost = ruler.bracket(ruler.value(name), name, { label: (gap) => `error: ${gap.toFixed(2)}` })
        s.play(ruler.snap(name), fadeIn(lost), { duration: 1.5 })
        s.wait(2.5)
    }
    assertEqual(ruler.value('a'), 1, 'rounded a')
    assertEqual(ruler.value('b'), 5.5, 'rounded b')
    s.wait(2)
})
```

With two or more custom `ticks`, the smallest and largest values set the range unless you supply `range`. Set `labels: false` to hide every tick label. Use `tickLabels` to label selected ticks when the full set would be too dense. Ticks outside that selection are shorter. If the labels on a custom tick list touch, the error suggests ticks with room for labels. `format` writes a value: under a tick, at a threshold, and in a bracket. With `format`, the numbers under the ticks are plain text in the font of the film, so a function such as `(value) => value + ' ms'` adds a unit. Without it, they are math, as the numbers of `axes` are.

`size` sets the point names, threshold labels, band names, and brackets. The default is 28 px. Tick labels default to 6/7 of that size (24 px), and `labelSize` overrides it. For text of at least 26 px at 1080p, set `size: 32` or larger. Plain text uses `font` or the film font.

Give each point a unique `name` and a `value`. `line.move('a', 2.4)` moves one point. `line.move({ a: 2.4, b: 1.3 })` moves several together. `line.insert(point, { from })` brings a new point from an optional stage position or node, and `line.remove(name)` takes it away.

`line.snap('a')` moves a point to `line.nearestTick(value)`. Omit the name to snap every point. A ring marks the original position and a red segment shows the distance to the tick until the next move. Pass `{ trace: false }` as the second argument to omit the trace. At a midpoint, `nearestTick` chooses the tick with the even index in the sorted `tickValues` list.

A point label defaults to its name. Set `label: false` to draw just the mark. `levels` sets how many rows of names the line can use (two by default). When names cannot fit, the error suggests more room or another row.

```film paired label="A moving cutoff changes which requests need review"
import { assertEqual, film, numberLine, sceneKit } from 'vizmatic/stage'

const SCORES = [0.48, 0.56, 0.63, 0.69, 0.74, 0.81, 0.87, 0.94]
export default film({ fps: 24 }, (s) => {
    const { heading, source } = sceneKit({ size: 40 })
    s.add(heading('A stricter cutoff sends more cases to review'), source('Eight fixed scores. Rings wait for a person. Dots pass the gate.'))
    const strip = numberLine({
        range: [0.4, 1], step: 0.1, length: 1600, size: 40, format: (score) => score.toFixed(2),
        points: SCORES.map((value, i) => ({ name: `request ${i + 1}`, value, label: i === 3 ? 'request 4' : false as const })),
        thresholds: [{ at: 0.7, label: 'cutoff' }],
        bands: [{ name: 'human review', color: 'orange', hollow: true }, { name: 'served at once', color: 'teal' }], counts: true,
    }).at(0, 40)
    s.play(strip.enter(), { duration: 1.5 })
    s.wait(2.5)
    for (const cutoff of [0.9, 0.5, 0.7]) {
        s.play(strip.moveThreshold(cutoff), { duration: 1.5 })
        const expected = SCORES.filter((score) => score < cutoff).length
        assertEqual(strip.count(0), expected, 'requests in review')
        assertEqual(strip.count(1), SCORES.length - expected, 'requests served')
        s.wait(2.5)
    }
})
```

Supply `thresholds` in increasing order. Each cut is a number or an object with `at`, `label`, `color`, `ties`, and `readout`. The label follows the moving cut and shows its current value unless `readout` is false. The cuts divide the line into bands. Each band can have a name and color. `hollow: true` uses rings for its points. Set `counts: true` to show each population under the line.

`line.moveThreshold(to, { which })` moves a cut. Use its index or label for `which`, or omit it for the first cut. A point that meets the cut belongs to the upper band by default. Set `ties: 'under'` for the lower band. The fill, point marks, and counts follow the crossing as it happens. Thresholds must stay in increasing order throughout the motion.

Use `line.value(name)`, `line.bandOf(name)`, `line.count(band)`, and `line.find(test)` to read the state after a scheduled change. `line.names` lists active points and `line.thresholds` lists the current cut values.

`line.bracket(from, to)` follows two values or named points. By default, it shows the gap below the axis. `label` accepts text or a function of the gap and both values. Set `side: 'over'` or use `offset` to make room for another bracket. A bracket, marker, or interval joins the line when you create it. Use `fadeIn` to introduce it later. `line.marker(value)` also accepts a function for a continuously changing value.

Sequence changes to the same point. Changes to distinct points can run together, and a point can move while a threshold moves.

`.at()` places the center of the axis. `line.p(value)` gives a local coordinate and `line.world(value)` gives a stage coordinate. `line.point(name)` and `line.threshold(which)` return nodes for connectors or emphasis. `line.region({ at })`, `line.region({ from, to })`, and `line.region({ band })` give stage boxes for layout. Use `fitted(region, (length) => numberLine({ length, points }))` to include the arrow tips and text when fitting the line.

## Scatter planes

`scatter(points, options)` draws points on two axes. Each point needs `x` and `y`. Give it a `name` to move it by name and a `group` to share a color and shape. A search grows a ring from a point to its nearest points, and a hull, a cell, or a span of the axes is an area that shades. Use it for an embedding plane, a nearest neighbor search, an index of cells, k-means, or a decision region.

```film paired label="A second probe finds a nearer vector across a cell border"
import { assertEqual, fadeIn, film, scatter, sceneKit } from 'vizmatic/stage'

export default film({ fps: 24 }, (s) => {
    const { heading, source } = sceneKit({ size: 40 })
    s.add(heading('The nearest vector can be across a cell border'), source('One probe misses B. Two probes recover the true nearest pair A and B.'))
    const plane = scatter([
        { x: 1, y: 1, group: 'left' }, { x: 1.5, y: 7, group: 'left' }, { x: 3, y: 8, group: 'left' },
        { x: 8, y: 1, group: 'right' }, { x: 8.5, y: 7, group: 'right' }, { x: 7, y: 8, group: 'right' },
        { x: 4.4, y: 5.6, name: 'A', group: 'left', side: 'over' },
        { x: 5.2, y: 4.6, name: 'B', group: 'right', side: 'right' },
        { x: 2.5, y: 5, name: 'c1', group: 'centers', side: 'left' },
        { x: 7.5, y: 5, name: 'c2', group: 'centers', side: 'right' },
    ], {
        x: [0, 10], y: [0, 10], width: 760, height: 760, labelSize: 26, nameSize: 32, radius: 9, groupLabels: false,
        groups: { left: { color: 'blue', shape: 'dot' }, right: { color: 'purple', shape: 'square' }, centers: { color: 'ink', shape: 'ring' }, found: { color: 'green', shape: 'diamond' } },
    }).at(0, 10)
    s.play(plane.enter(), { duration: 1.5 })
    s.wait(1.5)
    const cells = plane.cells(['c1', 'c2'])
    s.play(fadeIn(cells), { duration: 0.6 })
    s.play(plane.insert({ x: 4.8, y: 5, name: 'q', query: true, side: 'under' }), { duration: 0.9 })
    const first = cells.find((cell) => cell.holds('q'))!, other = cells.find((cell) => !cell.holds('q'))!
    s.play(first.shade(), plane.nearest('q', 2, { among: first.points }), { duration: 1.5 })
    assertEqual(plane.neighbors.includes(plane.indexOf('B')), false, 'one probe finds B')
    s.wait(3)
    s.play(other.shade(), plane.nearest('q', 2, { among: [...first.points, ...other.points] }), { duration: 1.5 })
    assertEqual(plane.neighbors[0], plane.indexOf('B'), 'nearest vector')
    assertEqual(plane.neighbors[1], plane.indexOf('A'), 'second nearest vector')
    s.play(plane.assign(plane.neighbors, 'found'), { duration: 0.8 })
    s.wait(3.5)
})
```

`width` and `height` set the plot dimensions. Axis numbers sit outside the plot. By default, `x` and `y` span the initial points. When starting empty, give both ranges to draw labeled axes for points that will arrive later.

A point label defaults to its name. Set `label` for different text or `label: false` to hide it. The chart chooses a place inside the plot. Set `side` to `right`, `left`, `over`, or `under` to request a particular place. The default `nameSize` is 26 px. Axis numbers default to 18 px. Use `labelSize: 26` for a lesson at 1080p.

Points in one group share a color and a label. Set `groups` to give each group a color or `{ color, shape, label }`. The shapes are `dot`, `ring`, `square`, `diamond`, and `triangle`. Set `label: false` to hide that group name. Declare groups with no initial members before assigning points to them. `query: true` draws a target and excludes that point from search results.

`chart.move('q', [4, 5])` moves a point in data units. Use `chart.move({ q: [4, 5], c1: [2, 3] })` to move several at once. `insert(point, { from })` brings in a new point from an optional stage position or node. `remove(which)` takes points away. `assign(which, group)` changes the color and shape of the selected marks. Choose points by index, name, a list of either, or a predicate such as `(point) => point.group === 'left'`.

`chart.nearest('q', 3)` draws a ring to the third nearest neighbor and links the query to the selected points. Distances are Euclidean in data units, so the ring looks circular when the axes use the same number of pixels per unit. The search follows later point movements. Use `among` to restrict candidates, change `k` to resize the search, or set `k` to zero to end it.

`chart.hull(group)` follows the outline of a group as its membership changes. `chart.cells(centers)` partitions the plot by distance to each center. Give a point index, a name, or a coordinate pair for each center. `chart.span({ x: [0, 3.35] })` selects a vertical strip. Add a `y` range for a rectangle. Infinity denotes the corresponding edge of the axis. Each area joins the chart when you create it.

`area.shade()` adds fill and emphasizes the outline. `area.shade(false)` returns to the resting appearance. A hull starts shaded. `area.points` returns the indexes of data points in the area. It excludes queries and, for a cell, the listed center points. `area.holds('q')` tests the location of a query too.

`positionOf(which)`, `groupOf(which)`, `count(group)`, and `find(test)` read the state after the changes played so far. `nearestTo('q', 2)` returns neighbors with their distances. `neighbors` returns the indexes selected by the active search.

A point can move and change group together. Sequence two position changes to the same point, two changes to its group, or two changes to the search. Moves and inserts need coordinates inside the axes.

`chart.point(which)` returns a mark for a connector or emphasis. `chart.p(x, y)` gives local coordinates. `chart.region({ x: [0, 5] })` gives a stage box for part of the plot. `fitted(region, (width) => scatter(points, { width, height }))` includes axis labels in the measured width. The chart exposes `dots`, `nameLabels`, `groupLabels`, `areas`, and `axis` for animation.

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

## Passages

`passage(text, options)` displays prose that a film can annotate and revise. It wraps words at `width`, collapses consecutive spaces and tabs, and preserves line and paragraph breaks. Use a passage to cut a document into chunks, connect claims to evidence, or show how a prompt revision changes a reply. The runnable films in `examples/films/passage/` demonstrate all three uses.

```film paired label="A runbook is cut into windows of words, then with an overlap, then by sentence, and the first chunk lifts out"
import { film, passage } from 'vizmatic/stage'

const RUNBOOK = 'If the error rate stays above 2% after a deploy, roll back within 15 minutes. Then page the incident commander. Write the deploy ID in the incident channel.'

export default film({ fps: 30 }, (s) => {
    const page = passage(RUNBOOK, { width: 1500, size: 44, title: 'runbook.md' }).at(-750, -330)
    s.play(page.enter(), { duration: 1 })
    // The fact that a chunk must hold whole.
    s.play(page.mark('within 15 minutes'), { duration: 0.5 })
    // Windows of 7 words cut the fact in two. With an overlap of 2 words, one chunk holds it whole.
    s.play(page.cut({ size: 7 }), { duration: 1.2 })
    s.wait(0.8)
    s.play(page.cut({ size: 7, overlap: 2 }), { duration: 1.2 })
    s.wait(0.8)
    s.play(page.cut({ by: 'sentence' }), { duration: 1.2 })
    // The first chunk is selected, and it leaves the page as a passage of its own.
    const chunk = page.slip({ chunk: 0 }, { title: 'chunk 1 of 3', width: 820 }).at(-410, 130)
    s.play(page.select({ chunk: 0 }), page.lift(chunk), { duration: 1.2 })
    s.wait(1.2)
})
```

Use `quote` for a fixed quotation with attribution, `codeBlock` when columns and spacing matter, and `tokens` for tokenizer output. A passage keeps the same words on screen as annotations change.

`width` is the width of the object, and no letter passes it. Without a width, the text is on one line and the object is as wide as that line needs, 900 at the most. A line breaks at a space. A line break in the text starts a line, and an empty line starts a paragraph, with half a line of room. A no-break space (` `) keeps two words on one line. A word that is wider than the passage is an error, and the message gives the width that is enough. `size` is the text size, 32 by default, and `leading` is the height of a line as a multiple of it, 1.6 by default. The bands and the links need that room: a smaller `leading` is an error when a band does not fit. The words are in the font of the film, or in `font`.

`title` is one line over the words: the name of a file, or a role such as `user`. It is 0.8 of `size`, and 26 px at the least when `size` is 26 or more. `color` is the color of the border and of the title, so the sections of a prompt can each have their own. `panel: false` draws no frame, for one sentence in a picture. `.at(x, y)` places the top left corner, so passages of different lengths start at one corner. The layout measures a passage as its width and its height, with or without a frame, so it is an item of `row`, `column` and `place`, and `fitted(region, (width) => passage(text, { width }))` makes it as wide as a region.

### Parts of the text

A film names a part of the text by its words: `'within 15 minutes'`. The words are matched letter for letter, spaces do not count, and a part may run over the end of a line or of a sentence. A part starts and ends at the borders of words: `'day'` is not a part of "days". Words that are at two places name no part, and the error says so: give more of the words around the place, or `{ words: 'days', occurrence: 1 }` for the second place. `{ chunk: 0 }` is the first chunk of the last cut, and the node of a span or a chunk names its own words. Words that are not in the text are an error that shows how the text starts.

### Spans and kinds

`page.mark(words, kind)` gives a part a kind. A band in the color of the kind grows behind the words in the order of the text, with the sign of the kind. A second `mark` of the same words changes the kind: the color changes, and the old sign gives way to the new one. `page.mark(words, null)` takes the span away. A word is in one span, so words that share a word with another span are an error. Without a kind, a part takes the first kind of the passage.

A kind has a color and a sign, so that color is never the only sign. Without `kinds`, a passage has the kinds of `PASSAGE_KINDS`:

| Kind | Color | Sign | Use |
|---|---|---|---|
| `mark` | blue | a plain band | A part that the film points at: a clause, a name, a number |
| `claim` | purple | a frame around the band | A statement of an answer that is not checked yet |
| `supported` | green | a line under the words | A source says the same |
| `unsupported` | yellow | dashes under the words | No source says it |
| `contradicted` | red | a wave under the words | A source says another thing |
| `external` | orange | diagonal lines over the band | Text that came from outside, such as a web page in a prompt |
| `removed` | dim | a line through the words, which are dim | Words that the next version does not have |
| `added` | teal | two lines under the words | Words that the next version brings |

For another subject, give your own record, such as `kinds: { rule: { color: 'teal', sign: 'underline' }, fact: { color: 'blue' } }`. A sign is `'band'`, `'box'`, `'underline'`, `'double'`, `'dashed'`, `'wavy'`, `'hatch'` or `'strike'`, and a kind with none has a band. Each kind of a passage has its own sign: two kinds with one sign would differ by their color only, so they are an error that lists the signs that are free. `dim: true` sets the words of a span in dim.

`page.spans` lists the spans in the order of the text, with the words and the kind of each. `page.kindOf(words)` is the kind of a span, or null, and `page.count('supported')` counts the spans of a kind, so a label can show a true share. All of them read the state after the changes that the film has played so far.

### Chunks

`page.cut(how)` cuts the text into chunks. `{ size: 12, overlap: 3 }` makes windows of 12 words, and each window shares 3 words with the next. `{ by: 'paragraph' }` starts a chunk at each blank line. `{ by: 'sentence' }` also starts a chunk after a word that ends in a period, exclamation point, or question mark. Use an explicit list of chunks for abbreviations or other language-specific boundaries. The chunks arrive one after another as bands of two colors in turn, as high as a line, with a gap between two chunks. Over the words that two chunks share, the first chunk has the upper half of the line and the next chunk has the lower half, so the overlap shows both. A word is in two chunks at the most: an overlap of more than half of `size` is an error.

For a token budget, pass the tokenizer as the `tokens` option of `passage`, then play `page.cut({ tokens: 128 })`. The passage appends whole words and counts each candidate chunk as one string. It starts a new chunk when the next word would exceed the budget. If one word exceeds the budget on its own, the cut reports that word. For an estimated token count, label the budget as an estimate in the film.

A new cut takes the place of the old one, so each way to cut is an operation on the same page. `page.cut(null)` takes the chunks away. `page.chunks` holds the words of each chunk. `colors` gives the two colors, which are purple and orange by default. Keep them apart from the colors of the kinds that the film uses.

### The selection and its count

`page.select(part)` moves the selection, which is one frame around some words. A passage has one selection. It grows and shrinks line by line, as a selection in an editor does, and `page.select(null)` takes it away. `page.selection` is its size: `{ words, characters }`, and `tokens` when the passage has a `tokens` function. `page.measure(part)` gives the same for any part, and for the whole text with no part.

`page.counter('words')` is a number that follows the selection. It is 0 with no selection, and it runs to the new count while `select` plays. Show it with `decimal(() => page.counter('words').value, { digits: 0, suffix: ' words' })`, or give it to a bar. A passage has no tokenizer of its own. For tokens, give `passage(text, { tokens })` the function of the film that counts them, or an estimate such as `(text) => Math.ceil(text.length / 4)`, and say on the screen that it is an estimate.

### A part that lifts out

`page.slip(part, options)` makes a passage of its own from a span, a chunk or any words, with the same size and font. It is not on the stage yet. Give it its place, and play `page.lift(slip)`: a copy of each letter leaves the page and lands in the slip, and the frame of the slip arrives. The words stay in the page too. The options are those of `passage`, such as a `title` and a `width`. Without a width, a slip is as wide as its words need, and as wide as the page at the most. A slip is a passage, so a film can mark it, link it, and lift a part out of it.

### Links

`answer.link(words, target)` makes a line from a part of a passage to a node: the span of another passage (`source.span('Closed on Sunday.')`), a slip, or any node of the film. The line leaves under the end of the part, runs in the room between two lines of text to the side of the passage, goes up or down between the passage and the target, and reaches the span of the target the same way. So it crosses no word. A part on two lines has an end on each, and the line takes the end that is nearest to its side. The line is drawn on every frame: it follows the two when they move, and it follows a span whose words a `diff` changes.

`link.enter()` draws the line from the part to the target. `link.break()` is for a tie that does not hold: a gap opens between the two with a cross in it, the line becomes dashes, and it turns red. `link.broken` says so. For a claim that no source supports, play no link, and mark the claim `unsupported`. The line goes up or down in the middle of the room between the two, and `shift` moves that part sideways by so many pixels, so that two links do not share it. For a target over or under the passage, the line goes around both by the right side, or by the left one with `side: 'left'`. Two links that leave under one line of text share the room under it: let one of them leave by the other side, or mark parts on two lines. A node that arrives later is drawn over a link, so call `link.zIndex(1)` for a line that must stay over a panel.

The film in `examples/films/passage/evidence.ts` compares four claims with two sources. It draws a solid link for each supported claim, breaks the link for a contradicted claim, and leaves the unsupported claim unlinked.

### The next version

`page.diff(next)` changes the text to its next version. The film gives the whole next text, and the passage finds the words that differ. The words that go get a line through them and turn dim, the rest of the text moves, and the words that come arrive beside the words that they replace, with two lines under them. Both versions are then on the screen, and `page.text` is the next version. `page.changes` is the number of places that show a change. `page.accept()` takes the old words away, and the text closes up: the passage is then laid out as a new passage of the next version.

A word that stays on its line slides to its place. A word that goes to another line fades out where it is and comes back at its place, so that no word flies across the lines between the two. A replacement inside one span stays in that span. When one replacement covers several entire spans, `accept()` removes those spans. Links follow the words that remain.

The frame is as high as its text, so a `diff` that adds a line makes the frame higher. `lines` is the least number of lines that the frame holds. With it, the frame has one height from the start, and a `diff` that needs more lines is an error that gives the number. One change is on the screen at a time: a second `diff` before `accept` is an error, and so is a `diff` of a passage with chunks, because a chunk is a part of one version. The words move in one change at a time. A `diff` and an `accept` whose times overlap are an error, and so is a `mark`, a `cut`, a `select` or a `lift` that plays while the words move. Play them in a `seq`, or one after the other.

To display a version number beside an edit, place a `tagTrack` beside the passage and start its next state when the edit is accepted.

The film in `examples/films/passage/prompt.ts` links a prompt to two JSON fields. When the prompt specifies a deadline, `diff()` marks the edit and `morphCode()` updates the reply. The unchanged deploy identifier stays visible.

### Places, parts and time

`page.span(words)` is the node of a span, and `page.chunk(index)` the node of a chunk: the bands behind the words. Give one to `beside` as the part of an object, to a light, or to `link` as a target. `page.region(part)` is the box of the band of a part on the stage, for `place` and `beside`. With no part it is the room of the text, and `{ line: 1 }` is the row of one line. `page.p(part, edge)` is a point on the band in the coordinates of the object: the middle of the bottom of its last line by default, or `'top'`, `'left'` and `'right'`. `page.leader(part, side)` gives the three points of the way of a line out of the passage, for a line of your own. These places are for the text after the changes that the film has played so far, and they do not follow a later change. `page.find(words)` gives the glyphs of some words, to color them with `recolor`. `page.frame`, `page.title` and `page.words` are the parts, `page.text` is the text of now, and `page.lineCount` is the number of its lines.

A clone has its own text, spans, selection, and counters. In a `seq`, each verb resolves its words and chunks when it plays. For example, `seq(page.cut({ size: 7 }), page.select({ chunk: 0 }))` selects the first chunk created by that cut.

`page.enter()` brings the frame and the title, and then the words in the order of the text. With a long duration, the words arrive as a reply that a model writes. A verb that is played on a passage that is not on the stage brings the passage. A viewer reads about 20 characters in one second, and the film check reads a passage as one text. So a passage of 160 characters stays up for 8 seconds: `readingSeconds(page.text)` gives that time. A slip is a text of its own for the check.

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

## Tensor grids

`heatmap(rows, options)` shades each cell by its value. Use it to show how the same tensor changes through an operation. In the example, the outline selects one word. The bias row then stays in view as the film adds its four values to each word.

```film paired label="A tensor with three named axes: the row of one word lights, and a bias is added to each row in place"
import { beside, fadeIn, fadeOut, film, heatmap, text } from 'vizmatic/stage'

const X = [[0.2, -0.4, 0.9, 0.1], [0.5, 0.3, -0.7, 0.6], [-0.1, 0.8, 0.4, -0.5]]
const BIAS = [0.1, -0.2, 0.3, 0.1]

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const x = heatmap(X, {
        size: 34, values: true, rowLabels: ['Birds', 'migrate', 'south'], axes: ['batch', 'seq', 'd'], depth: 2, name: 'x',
        domain: [-1, 1.5], colors: ['orange', 'surface', 'blue'],
    }).at(-330, -40)
    const slice = text('x[0, 1, :]', { size: 48, font: 'mono', color: 'yellow' }).at(480, -40)
    const bias = heatmap([BIAS], { size: 34, values: true, name: 'bias', domain: [-1, 1.5], colors: ['orange', 'surface', 'blue'] }).at(480, -40)
    const sum = beside(text('Add to every row', { size: 44, color: 'yellow' }), bias, 'above', 'wide')
    s.play(x.enter(), { duration: 1.4 })
    s.play(x.light({ row: 1 }), fadeIn(slice), { duration: 0.6 })
    s.wait(1.4)
    s.play(x.light(null), fadeOut(slice), { duration: 0.5 })
    s.play(fadeIn(sum), fadeIn(bias), { duration: 0.4 })
    // One row of four values is added to each of the three rows.
    for (const row of [0, 1, 2]) {
        s.play(x.light({ row }), x.setValue({ row }, (_row, col, old) => old + BIAS[col]!, { lag: 0.5 }), { duration: 1.1 })
    }
    s.play(x.light(null), { duration: 0.4 })
    s.wait(2.4)
})
```

Choose the object that matches the operation.

| Need | Object |
|---|---|
| Cells with a number and a shade, names, braces, a shape, a lit slice, a window, patches, growth, a state over a cell | `heatmap` |
| The same grid between a column of query tokens and a row of key tokens | `attentionMatrix`, which is a `heatmap` with tilted token names and a causal mask |
| Two operands and their product, with a row paired with a column | `matrixProduct`, which is three `heatmap` grids |
| A matrix in a formula, with brackets, in the type of the math | `matrix` |
| Cells that are only in a state, with no value and no name, by the thousand | `stateGrid` |
| One row of boxes whose items swap places | `arrayCells` |

`size` controls cell numbers, labels, braces, and the shape caption. It defaults to 28 when you give `width`, `axes`, `name`, `depth`, `states`, `initial`, `shown`, or `values: 'lit'`. For a 1080p lesson, use at least 26. A heatmap with only the original chart options keeps its 44-pixel cells and 16-pixel labels.

`values: true` prints numbers in a monospaced font. In tensor mode, the default cell fits the widest number and leaves room for a four-character value such as `0.25`. Set `cell` for square cells or use `cellWidth` and `cellHeight`. `width` sets the combined width of the columns. To include labels and braces in a width budget, use `fitted(region, width => heatmap(rows, { width, rowLabels }))`. If a number or label does not fit, the error gives a minimum size. You can also shorten a number with `format` or tilt a column label with `columnLabelAngle: -Math.PI / 4`. `.at()` places the center of the cells.

`axes` names each axis from outermost to innermost. For example, `axes: ['batch', 'seq', 'd']` and `depth: 2` draw two sheets and label the shape `[2, 3, 4]` for three rows of four values. The values supplied to `heatmap` describe the front sheet. The stack shows up to four sheets, and the depth label gives the full batch size. `name` adds a name to the shape. `grid.axis('seq')` returns the brace and its label for an animation such as `indicate`. `grid.shape` returns the dimensions.

`grid.light(slice)` outlines a row, column, cell, or block. Indices start at zero and ranges include both ends. For example, `{ row: 1 }` selects the second row, `{ row: 1, col: 2 }` selects one cell, and `{ row: [0, 2], col: [1, 3] }` selects a 3-by-3 block. A second `light` moves the outline to the next slice and brightens its labels. If every cell displays a number, the outline fades between slices to keep the numbers clear. Set `color` to change the outline. `grid.lit` returns the selection, and `grid.light(null)` clears it.

`values: 'lit'` prints the numbers of the lit slice only. Use it for an image, where a number in each pixel is too much: the window shows the numbers that it reads. A number leaves before the outline passes its cell and comes in after it, so no line crosses a number.

`grid.setValue(cells, values)` updates the selected cells. Supply a single number, a list in row order, a matrix, or a function of `(row, col, oldValue)`. The old number fades out before its replacement appears. `lag` staggers the cells. `grid.value(row, col)` reads one value, and `grid.values(slice)` reads the rows of a slice. To update the same cells twice, play the changes in sequence. Set `domain` when later values can fall outside the initial range. Values outside an explicit domain take the nearest endpoint color.

`grid.update(rows)` changes the supplied cells together. On a tensor grid it updates both their shades and their printed values. On a chart that uses only the original heatmap options, `update` recolors cells and keeps their existing labels.

An `open` cell shows its value. `grid.mark(cells, state)` hides it behind a mark. The built-in states use different shapes in both looks. `empty` draws an outline, `masked` a cross, `future` diagonal lines, and `padding` a dashed outline. Mark a cell `open` to reveal it again. Use `initial` for the starting states and `states` for a custom set, such as `{ ignored: { mark: 'cross', color: 'red' } }`. Available marks are `none`, `cross`, `hatch`, and `dash`. Both `mark` and `setValue` accept a slice or a predicate on `(row, col, value, state)`. Predicates run when the animation plays, so the second step in a sequence sees the first step’s changes. `grid.stateOf(row, col)` reads one state. `grid.count(state)` and `grid.find(test)` inspect the visible rows and columns.

`setValue` takes a `state` too. `grid.setValue({ row: 0, col: 1 }, 3, { state: 'open' })` writes a value and opens the cell in one motion, which fills a cell of an output grid that started `empty`.

```film paired label="A window slides over an image, and each sum fills one cell of the map"
import { film, heatmap, text } from 'vizmatic/stage'

// An image with one vertical edge: dark at the left, bright from column 3 on.
const IMAGE = Array.from({ length: 6 }, () => [0, 0, 0, 1, 1, 1])

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const image = s.add(heatmap(IMAGE, { size: 30, cell: 96, values: 'lit', domain: [0, 1], colors: ['surface', 'teal'], name: 'image' }).at(-420, -30))
    // The kernel takes the right column of the window and subtracts the left one.
    const places = image.windows(3)
    const edge = (slice: (typeof places)[number][number]) => image.values(slice).reduce((sum, row) => sum + row[2]! - row[0]!, 0)
    const map = s.add(heatmap(places.map((line) => line.map(edge)), { size: 30, cell: 96, values: true, initial: 'empty', domain: [0, 3], colors: ['surface', 'orange'], name: 'map' }).at(480, -30))
    s.add(text('sum(right) − sum(left)', { size: 34, color: 'dim' }).at(480, 310))
    s.wait(0.6)
    // Three slow steps: the window moves one column, and its sum lands in the map.
    for (const col of [0, 1, 2]) {
        s.play(image.light(places[0]![col]!), { duration: 0.7 })
        s.play(map.mark({ row: 0, col }, 'open'), map.light({ row: 0, col }), { duration: 0.5 })
        s.wait(0.4)
    }
    // Then the scan runs fast over the other places.
    for (let row = 0; row < places.length; row++) {
        for (let col = row === 0 ? 3 : 0; col < places[row]!.length; col++) {
            s.play(image.light(places[row]![col]!), map.mark({ row, col }, 'open'), map.light({ row, col }), { duration: 0.28 })
        }
    }
    s.play(image.light(null), map.light({ col: [1, 2] }, { color: 'yellow' }), { duration: 0.6 })
    s.wait(1.2)
})
```

`grid.windows(size, { stride })` returns a matrix of slices in output order. Use it to drive convolution or pooling. Give a single size or stride for both axes, or a `[rows, columns]` pair. To show padding, include the border in the input and mark those cells `padding`.

`shown: { rows, columns }` sets the initial visible shape. Supply the full matrix at construction so the layout can reserve its final size. `grid.grow({ columns: 1 })` reveals the next column. Add both `rows` and `columns` to grow a square attention matrix. The braces and shape caption follow the visible cells. Read `grid.shownRows` and `grid.shownCols` for the current dimensions. Reveal a cell before highlighting it. Value and state updates can include hidden cells, so marking a padding column applies to future rows too.

`grid.cut(rows, cols)` divides an image into patches of that many rows and columns. Each patch dimension must divide its image dimension evenly. `gap` sets the space between patches. With `unroll: true`, each patch becomes a row containing the same cells in row order. A vision model can use these rows as inputs to a patch projection. The whole-image labels disappear while the grid is cut. `grid.light({ patch: 2 })` highlights the third patch, and `grid.region({ patch: 2 })` gives its current box. `grid.join()` restores the image. Allow room for both arrangements.

`grid.p(row, col)` returns the cell center in grid coordinates. Pass `'top'`, `'right'`, `'bottom'`, or `'left'` for an edge. `grid.region(slice)` returns a box in stage coordinates for `place` or `beside`. For example, `beside(note, grid, 'right', 'wide', grid.cell(1, 0))` aligns a note with the second row. `grid.cell`, `grid.row`, and `grid.col` return cell nodes. `grid.numbers`, `grid.rowLabels`, `grid.columnLabels`, `grid.slabs`, `grid.caption`, and `grid.frame` expose the other parts. A `spotlight` on a cell includes its number.

## Matrix products

`matrixProduct(a, b, options)` draws both operands and their result with the same cell size. The shapes above the grids highlight the two dimensions that must match. The result starts empty. In the example, the first row meets the first column to produce `1 × 7 + 2 × 8 + 3 × 9 = 50`.

```film paired label="One cell of a product: a row meets a column, each pair of numbers adds to the sum, and the sum goes to its cell"
import { film, matrixProduct } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const product = matrixProduct([[1, 2, 3], [4, 5, 6]], [[7, 4], [8, 5], [9, 6]], { size: 40 }).at(0, -30)
    s.play(product.enter(), { duration: 1.4 })
    // The first cell, one term at a time.
    s.play(product.pair(0, 0), { duration: 0.8 })
    for (let term = 0; term < 3; term++) {
        s.play(product.addTerm(), { duration: 0.8 })
        s.wait(0.3)
    }
    s.play(product.store(), { duration: 0.9 })
    s.wait(0.6)
    // The next cell in one play, and then the cells that are left.
    s.play(product.compute(0, 1), { duration: 3 })
    s.play(product.complete(), { duration: 1.2 })
    s.wait(1.2)
})
```

`product.pair(row, col)` selects one row of the left operand, one column of the right operand, and their result cell. `product.addTerm()` highlights the next pair of source cells and adds their product to the running sum. `product.addTerm(3)` takes three terms in sequence. After the final term, `product.store()` moves the sum into the result cell. `product.compute(row, col)` plays the whole sequence for one cell, and `product.complete()` reveals the remaining results.

`product.lit` gives the selected result cell, `product.terms` counts its accumulated terms, and `product.sum` gives the subtotal. `product.filled` counts the visible results. `product.result(row, col)` gives a numerical result even before the film reveals it. `product.shape` returns all three shapes. Play the steps in sequence. The product reports an error if the steps overlap, the film adds too many terms, or it stores an incomplete sum.

A row vector and a column vector make a dot product. For example, `matrixProduct([[1, 2]], [[3], [4]])` produces one result cell with the value 11. For every product, the number of columns in the first operand must equal the number of rows in the second. The calculation uses the input numbers at full precision. The default formatter displays up to two decimal places. Use `format` for a different precision.

`size` sets the text size and defaults to 30. `cell` sets the side of each cell across all three grids. `names` labels the grids, `colors` selects the two operand highlights, and `filled: true` starts with the result visible. Use `width` in a fitted layout. Extra width goes between the grids. Each grid and the longest line of arithmetic reserve their space from the start. If the text and cells need more room, the error gives the minimum width.

`product.a`, `product.b`, and `product.c` are the three grids. Use `product.c.p(row, col)` or `product.a.region({ row: 0 })` to anchor a note. The product computes its results from the original operands. To show a different multiplication, create a new product. `product.signs`, `product.captions`, and `product.line` are the other parts.

## Attention matrices

`attentionMatrix(rows, columns, weights, options)` labels the rows of a heatmap with query tokens and the columns with key tokens. With `mask: 'causal'`, diagonal lines cover the future keys for each query. The grid retains their numbers under the mask. The film chooses which scores enter the softmax.

```film paired label="A token reads the tokens before it: its row of scores becomes weights, and the grid gains a token"
import { attentionMatrix, fadeIn, fadeOut, film, text } from 'vizmatic/stage'

const TOKENS = ['function', 'returns', 'the', 'result']
const third = [2, 5, 3].map(Math.log)
const fourth = [1, 2, 3, 4].map(Math.log)
// Earlier queries already have weights. The current and next queries start with scores.
const initial = [[1, 0, 0, 0], [0.25, 0.75, 0, 0], [...third, 0], fourth]
const softmax = (row: readonly number[]) => {
    const parts = row.map(Math.exp), whole = parts.reduce((sum, part) => sum + part, 0)
    return parts.map((part) => part / whole)
}

export default film({ fps: 30, font: 'text-serif' }, (s) => {
    const grid = s.add(attentionMatrix(TOKENS, TOKENS, initial, {
        size: 34, values: true, mask: 'causal', domain: [0, 2], axes: ['queries', 'keys'], shown: { rows: 3, columns: 3 },
    }).at(-140, 20))
    const scores = s.add(text('Scores for “the”', { size: 44, color: 'dim' }).at(600, -40))
    const weights = text('Row weights sum to 1', { size: 44, color: 'yellow' }).at(600, -40)
    s.wait(0.8)
    // The query "the": its row of scores, and then its row of weights.
    s.play(grid.light({ row: 2 }), { duration: 0.6 })
    s.play(grid.setValue({ row: 2, col: [0, 2] }, softmax(third), { lag: 0.6 }), fadeOut(scores), { duration: 1.8 })
    s.play(fadeIn(weights), { duration: 0.4 })
    s.wait(1.2)
    // The model writes "result": the grid gains a row and a column, and the new query reads every key.
    s.play(grid.light(null), fadeOut(weights), { duration: 0.4 })
    s.play(grid.grow({ rows: 1, columns: 1 }), { duration: 1.2 })
    s.play(grid.light({ row: 3 }), { duration: 0.6 })
    s.play(grid.setValue({ row: 3 }, softmax(fourth), { lag: 0.6 }), { duration: 2 })
    s.play(fadeIn(weights), { duration: 0.4 })
    s.wait(1.2)
})
```

`mask: 'causal'` allows keys up to and including the query’s own position. For a custom mask, supply `initial` instead. For example, `initial: (row, col) => col === 0 ? 'padding' : col > row ? 'future' : 'open'` also masks a leading padding token. Use `grid.mark({ col: 0 }, 'padding')` to apply padding later. `grid.count('future')` counts blocked future cells in the part of the grid on screen.

`grid.setValue({ row: 2 }, weights, { lag: 0.6 })` sweeps one row from its scores to its weights, from the left. The film computes the weights: the grid shows numbers, and it does not know which cells a softmax reads. `grid.light({ row: 2, col: 1 })` lights one cell, and the names of its two tokens go bright. `grid.light({ row: [0, 1], col: [0, 1] })` lights a tile. `shown` and `grid.grow({ rows: 1, columns: 1 })` add a token, as for any grid.

Without tensor options, `attentionMatrix` uses its original 42-pixel cells, 18-pixel labels, and a color range from zero to the largest weight. With tensor options, the default range is 0 to 1. Use `domain` to compare scores or weights on a fixed scale. Column labels tilt in both modes.

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

## Layer stacks

`layerStack(layers, options)` draws a model from its input at the bottom to its output at the top. A block transforms values on the main path. A branch reads those values and joins the main path at a plus sign. Use the same diagram across scenes to show where each step happens.

```film paired label="A token goes up one decoder block: each branch reads the stream, and its add puts the result back"
import { film, layerStack } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const model = layerStack([
        { label: 'embed', color: 'purple', shape: '4 numbers' },
        { repeat: 'N', label: 'block', layers: [
            { branch: [{ label: 'norm', id: 'norm 1', color: 'yellow' }, { label: 'attention', color: 'orange' }] },
            { branch: [{ label: 'norm', id: 'norm 2', color: 'yellow' }, { label: 'feed forward', color: 'blue' }] },
        ] },
        { label: 'unembed', color: 'green', shape: '4 scores' },
    ], { shape: 'token "the"', size: 30 })
    s.play(model.enter(), { duration: 1.6 })
    s.play(model.feed([0.6, -0.2, 0.1, 0.4]))
    s.play(model.pass('embed', [0.3, 0.7, -0.5, 0.1]))
    s.play(model.light('attention'))
    s.play(model.pass('attention', [0.5, 0.2, -0.1, 0.8]), { duration: 3 })
    s.play(model.light('feed forward'))
    s.play(model.pass('feed forward', [0.9, 0.1, -0.6, 0.6]), { duration: 3 })
    s.play(model.light(null), model.pass('unembed', [-0.4, 0.2, 0.9, 0.1]))
    s.wait(0.8)
})
```

The layers are a list from the foot of the stream up. A layer is one of three things. A block is a label, or `{ label, id, color, state, shape }`: it is on the stream, and the data passes through it. A branch is `{ branch: [blocks] }`: its blocks are beside the stream, from the lowest one. A line leaves the stream under the first block, goes through the blocks, and ends at an add on the stream over the last block. That is a residual connection, and `{ branch: ['norm', 'attention'] }` is a pre-norm attention layer. A group is `{ layers, repeat, label }`: a frame around its layers, for a block that repeats. `repeat` is a count, 2 or more, or a name such as `'N'`, and the frame then says "× 12" or "block × N" on its top line. A group holds blocks and branches, and no other group.

A branch can go around a block on the stream: `{ branch: ['A', 'B'], around: 'W' }`. The stream then passes through `W`, and the branch adds to what `W` writes. That is LoRA beside a frozen weight, or a shortcut with a projection in a residual network. `shown: false` gives a branch its place from the start and does not draw it, and `stack.show('A')` brings it in later: the line leaves the stream, the blocks arrive, and the add lands on the stream.

A block has an `id`, which is its label unless the film gives another. The film names a block by its id or by its index. The blocks count from the foot of the stream up. A branch counts from its first block, and the block that a branch goes around comes before the blocks of that branch. Two blocks can have one label, such as "norm". A name that two blocks have is an error that lists their indexes, so give one of them an id, or name it by its index.

`stack.feed(values)` puts a vector at the foot of the stream: a row of cells, one for each value. A cell is teal for a value over 0 and orange for a value under 0, and it is stronger for a larger value, up to 1. `stack.pass('attention', values)` sends the vector up through the layer of a block, and it leaves that layer with the new values. In a block on the stream, the vector goes behind the block and comes out changed, and the block lights for a moment. At a branch, the vector stays on the stream, and a copy of it goes through the blocks of the branch. The copy comes back with what the branch adds, which is the new values less the old ones, and stops at the add. Then the add takes the copy, and the vector goes through the add and takes the sum. So a viewer sees that a layer adds to the stream and does not replace it.

Name any block of a branch to pass the branch. A pass to a later block goes through each layer before it, and gives each one its share of the time. Without values, the vector keeps its values. When you create a pass, the destination sets its default duration. A visible branch gets 2.6 s. A block or hidden branch gets 1 s. A pass across several layers shares that duration among them. The vector does not go back: `feed` starts again at the foot, and the vector that is on the stream leaves first. Schedule changes to the same part in timeline order. Use `seq` for two operations that move the vector. Finish revealing a branch before the vector reaches it. Changes to separate parts can run together, such as lighting attention while a vector passes it. `stack.passed` is the number of layers that the vector passed, `stack.values` its values, and `stack.shape` the shape beside it. All of these follow the changes that the film has played so far.

`cells` is the number of cells, 4 by default. With `digits`, each cell shows its value with that many decimals, and a cell is as wide as a value under 10 needs:

```ts
import { barChart, film, layerStack } from 'vizmatic/stage'

export default film((s) => {
    const model = s.add(layerStack([
        { label: 'token + position', color: 'purple', shape: '4 numbers' },
        { branch: [{ label: 'masked attention', color: 'orange' }] },
        { branch: [{ label: 'MLP', color: 'blue' }] },
        { label: 'scores', color: 'green', shape: '4 scores' },
    ], { digits: 1, shape: '"Birds"' }).at(-420, 0))
    const scores = [2.1, 1.4, 0.2, 0.6]
    const bars = barChart(['fly', 'sing', 'swim', 'sleep'].map((label, index) => ({ label, value: scores[index]! })), { width: 620, height: 400, labelSize: 34 }).at(480, 0)
    s.play(model.feed([0, 0, 0, 0]))
    s.play(model.pass('token + position', [0.5, -1.2, 0.3, 0.9]))
    // The copy comes back with 0.4, 0.7, 0.0 and 0.5, and the add makes 0.9, -0.5, 0.3 and 1.4 of them.
    s.play(model.pass('masked attention', [0.9, -0.5, 0.3, 1.4]), { duration: 3.4 })
    s.play(model.pass('MLP', [1.6, -0.5, -0.4, 1.4]), { duration: 3.4 })
    s.play(model.pass('scores', scores))
    s.play(model.light('scores'), bars.enter())
})
```

The copy shows the numbers that the branch adds while it stops at the add, so give a branch three seconds or more when the viewer must read them. The numbers of the vector fade before the vector goes behind a block, and come back when it is clear of the block, so the edge of a block never cuts a number. A value that is too wide for its cell is an error that names the value. A `shape` is a short text for the data on the stream, such as `'(T, 768)'`. The option `shape` is the shape at the foot of the stream, and the `shape` of a block is the shape after that block. The shape is beside the vector, at the left of the blocks, and goes up with it. It changes when the vector passes a block that has one, so a projector that keeps 576 tokens and makes each one wider changes "576 x 1024" to "576 x 4096". Only a block on the stream has a shape, because the add of a branch keeps the shape of the stream.

`stack.light('attention')` lights the block that a scene is about: a thick border and a stronger fill. One block is lit at a time, `stack.light(null)` puts the light off, and `stack.current` is the index of the lit block. `stack.mark(which, state)` moves blocks to another state. `which` is a block, a list of blocks, or a function of a block, which the stack calls when the film plays the change. Without `states`, a block is `live` or `frozen`, from `STACK_STATES`. A frozen block is dim and has a lock at its right end, so color is not the only sign of the state. `stack.replace('norm', 'RMSNorm')` puts another block in the place of a block: the label fades out and the new one fades in. The block keeps its id, its place and its state, and `{ label, color }` gives it a new color too.

```ts
import { beside, fadeIn, film, layerStack, text } from 'vizmatic/stage'

export default film((s) => {
    const model = s.add(layerStack([
        { label: 'patch embed', color: 'purple', shape: '576 x 1024' },
        { label: 'vision encoder', color: 'purple' },
        { label: 'projector', color: 'orange', shape: '576 x 4096' },
        { branch: [{ label: 'LoRA', color: 'orange' }], around: 'LLM', shown: false },
        { label: 'answer head', color: 'green' },
    ], { shape: '576 patches' }))
    // A note beside the whole stack, at the height of one block.
    const note = beside(text('the projector trains', { size: 30, color: 'orange' }), model, 'right', 'wide', model.block('projector'))
    s.play(model.mark(['patch embed', 'vision encoder', 'LLM'], 'frozen'))
    s.play(model.feed([0.4, -0.3, 0.8, 0.1]))
    s.play(model.pass('projector', [-0.2, 0.9, 0.3, -0.6]), model.light('projector'), fadeIn(note), { duration: 2.4 })
    // The branch arrives beside the frozen model, and adds to what the model writes.
    s.play(model.show('LoRA'))
    s.play(model.pass('LoRA', [0.1, 0.6, 0.7, -0.3], { aroundValues: [0, 0.7, 0.5, -0.2] }), { duration: 3 })
})
```

For another subject, give your own states: `states: { fresh: {}, cached: { color: 'dim', mark: 'check' }, failed: { color: 'red', mark: 'cross' }, skipped: { dim: true, dash: true } }` makes the layers of a container image. A state can set a `color` to override the block color, `dim` for a block that does not run, `dash` for a border of dashes, and a `mark` at the right end of the block: `'lock'`, `'check'`, `'cross'` or `'dot'`. A block with no state starts in the first state of the record. `stack.stateOf(ref)`, `stack.labelOf(ref)` and `stack.find((block) => block.state === 'frozen')` read the blocks after the changes that the film has played so far. If the film uses only block states, it can use a small `gap`, such as 14.

`stack.open('attention', inside)` joins a block to a close-up of its inside: two lines go from the block to a frame around `inside`, and `inside` fades in. `inside` is a node of the film, a block of the layout, or a list: another stack, a grid of numbers, a formula. The film places it at the right or at the left of the stack first. One block is open at a time: `open` of another block closes the first one, and `stack.close()` closes the open block and fades its close-up out. The lines use the positions of the stack and the close-up when `open` plays. Close and reopen the detail after moving it. A clone starts closed with its own timeline, including when you clone the group that contains the stack. A close-up over the stack or under it is an error, and so is a side where the lines would cross a part of the stack: a block on the stream that has a branch beside it opens to the left, and a block of a branch opens to the right.

```ts
import { film, heatmap, layerStack, place, sceneArea } from 'vizmatic/stage'

export default film((s) => {
    const [left, right] = sceneArea().columns(2)
    const model = s.add(place(layerStack(['embed', { branch: ['norm', { label: 'attention', color: 'orange' }] }, 'unembed']), left!))
    const weights = place(heatmap([[0.2, 0.3, 0.5]], { cell: 150, values: true, valueSize: 40, labelSize: 34, rowLabels: ['the'], columnLabels: ['function', 'returns', 'the'], colors: ['surface', 'orange'], domain: [0, 1] }), right!)
    s.play(model.light('attention'), model.open('attention', weights))
    s.wait(2)
    s.play(model.close(), model.light(null))
})
```

`width` is the width of the whole object: the blocks, the frames of the groups, and the room of the shapes at the left. The layout measures that same box, also before the vector, a shape or a branch shows, so `place(stack, region)` and `fitted(region, (width) => layerStack(layers, { width }))` work with no other number. Without `width`, the stack is as wide as its labels need. A label is never set smaller: a `width` with no room for a label is an error that names the label and the least width. `.at()` places the middle of that box. In a stack with a branch, the stream is at the left, in a free way that is as wide as the vector, and the blocks of the branches are at the right. A block on the stream is as wide as both. In a stack with no branch, the blocks are around the stream.

`size` is the size of every text of the stack: the labels, the shapes, the label of a group, and the numbers. It is 28 by default, which is over the 26 px that a film of 1920 by 1080 needs. Each measure follows it. `blockHeight` is the height of a block, 1.9 of `size` by default, and `gap` is the room on the stream between two layers, where the vector rests. The default gap holds the vector with room around it. A `feed` on a stack whose `gap` is lower than the vector is an error that gives the least gap. A decoder with two branches of two blocks is about 800 px high at the default size, so give a tall model `size: 26`, or put the layers that the lesson does not name in one block. `color` is the color of a block that has none, `font` the font of every text, and `backing` the color behind the blocks, which hides the stream and the vector there. It is the background of the look by default. On a panel of another color, give the color of the panel.

`stack.block(ref)` is the node of a block, for `beside`, a `connector`, or a `spotlight`. `stack.p(ref, edge)` is the middle of an edge of a block, `'right'` by default, and `stack.foot` and `stack.head` are the two ends of the stream: a row of tokens goes under the foot, and the bars of the output go over the head. These points are in the coordinates of the object, and `stack.toWorld(x, y)` gives the place on the stage. `stack.region()` is the box of the object in stage pixels, and `stack.region(ref)` the box of one block. `stack.enter()` builds the stack from the foot up: the stream grows, and each part arrives when the stream reaches its height. `stack.blocks`, `stack.boxes`, `stack.labels`, `stack.stream`, `stack.taps`, `stack.adds`, `stack.reads`, `stack.writes`, `stack.chains`, `stack.frames`, `stack.vector`, `stack.copy`, `stack.tag` and `stack.zoom` are the parts. `stack.count` is the number of blocks, `stack.ids` their ids, and `stack.depth` the number of layers.

`neuralNet` draws neurons and the weights between them, and its motion is an activation. `steps` lights one box of a row, and nothing joins its boxes. A layer stack knows the order of its layers and what each one does to the stream, so it can send one vector through them and keep its values.

The film supplies the values at each step. The cells can show a sample of a larger tensor. The shape label describes the full tensor and travels with the sample.

For a branch around a block, pass the output of that block as `aroundValues`. The branch returns the final values minus that output. For example, if the input is 2, the frozen block produces 6, and the final value is 7, the adapter adds 1. Without `aroundValues`, the example carries the input values along the main path. A pass that keeps those values shows a zero contribution at the add.

The runnable examples in `examples/_teaching` cover a decoder block, a multimodal projector with LoRA, and a tiny GPT forward pass. In `layer-stack-recurrence.ts`, a repeated cell opens onto a second stack with one block per word. Each pass applies the same recurrence to the hidden state.

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

`codeBlock(source)` draws syntax-colored code as glyphs. `morphCode(a, b)` morphs one version into another, and tokens that stayed travel to their new places. `tokens(items)` draws a strip of cells for the tokens of a language model: see [Token strips](#token-strips). `attentionMatrix` draws a heatmap with token labels. See [Attention matrices](#attention-matrices).

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

Use `json` or `yaml` to color the fields of a tool call, model reply, or configuration file. The aliases are `jsonl` and `yml`. A key keeps its lexical `kind` and gains an optional `role: 'key'`. Set `colors: { key: 'teal' }` to change its color. YAML highlighting covers simple keys on a single line, including quoted keys, numeric keys, and keys with spaces. Complex keys, block scalars, tags, and flow collections across lines require a YAML parser. Use `language: 'ts'` explicitly to reproduce the earlier fallback coloring for these language names.

```ts
import { codeBlock, film } from 'vizmatic/stage'

export default film((s) => {
    // A tool call as the model wrote it. The line of one argument is lit.
    const call = s.add(codeBlock('{\n  "name": "get_weather",\n  "arguments": { "city": "Paris", "days": 3 }\n}', { language: 'json', size: 40 }))
    s.wait(0.6)
    s.play(call.focus(2))
    s.wait(1.2)
})
```

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
| `tex`, and each label that is math: the numbers and the labels of `axes`, the numbers of a `numberLine` with no `format` and the label of its `marker`, `matrix`, `angleMark`, the names of `axes3d`, a `braceLabel` or a `labeledDot` without `plain: true`, and a `label3d` without `math: false`. | The math font. |
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
