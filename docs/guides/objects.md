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
- Machines: `vm`, `process`, `kernel`, `memory`, `disk`, `nic`, `network`, `snapshot`, `clone`, `jail`, `wall`, `key`, `stopwatch`, `bolt`.
- Models: `model`, `tokens`, `vector`, `agent`, `spark`.
- Work: `dashboard`, `terminal`, `container`, `experiment`, `target`, `loop`, `eye`, `message`, `shield`.
- General: `document`, `code`, `gear`, `clock`, `user`, `search`, `lock`, `deploy`, `check`, `cross`, `warning`, `question`.

Use a pictogram when a card or a legend needs a picture of a kind of thing. When the picture must show real data or a real topology, use `sparkline`, `graph`, or `tree`, and size it with `fitTo`.

## Cards

`card(options)` draws a box with a `title` at the top, a `figure` in the middle, and a `caption` at the bottom. All three are optional. The title and the caption sit at fixed distances from the border. The figure is centered in the space between them, and a figure that is too large is scaled down to fit. So the cards of a row share one layout whatever they hold: give them one `width`, one `height`, and one `captionLines`, which is the number of lines of the longest caption.

```film paired label="Three cards with one layout hold three different figures"
import { card, fadeIn, film, group, lagged, pictogram, sparkline } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const values = Array.from({ length: 48 }, (_, i) => Math.sin(i / 5) + 0.4 * Math.sin(i / 1.7))
    const row = { width: 500, height: 460, captionLines: 2, font: 'text-serif' } as const
    const cards = [
        card({ title: 'Metrics', figure: sparkline(values, { width: 380, height: 150, color: 'teal', weight: 5 }), caption: 'a number every ten seconds', color: 'teal', ...row }),
        card({ title: 'Logs', figure: pictogram('logs', { size: 170, color: 'dim', accent: 'yellow' }), caption: 'one line per event', color: 'yellow', ...row }),
        card({ title: 'Traces', figure: pictogram('traces', { size: 170, color: 'dim', accent: 'purple' }), caption: 'the path of one request through the services', color: 'purple', ...row }),
    ]
    group(...cards).arrange('right', 40).moveTo([0, 0])
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

## Tags

`tag(word, options)` draws a word in a pill, with a `note` beside it. Use it to say what kind of claim is on the screen and where it comes from: measured, plan, judgment, with the source and its date. `.at(x, y)` places the left end of the pill, so tags with words of different lengths start at one x.

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

## Code and tokens

`codeBlock(source)` draws syntax-colored code as glyphs. `morphCode(a, b)` morphs one version into another, and tokens that stayed travel to their new places. `tokens(items)` draws a row of labeled cells for language models, and `attentionMatrix` draws a heatmap with labels.

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
