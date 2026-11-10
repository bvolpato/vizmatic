---
title: Layout
nav: Layout
section: Motion
order: 6
description: Lay out a scene with no typed coordinate. Regions, rows, columns and grids that measure their items, placing by relation, and the timing defaults of a narrated scene.
---

A scene types no x and no y. It cuts its area into regions, lets a container measure its nodes and place them, and puts a node in a region or beside another one. On the clock of a narrated scene, `c.show`, `c.hide` and `c.swap` have one lead and one fade, so a scene types no time for them. Each call gives a right picture, or an error that says what to do. The template of `vizmatic new --template narrated` is written this way.

## The pieces

| Piece | What it does |
|---|---|
| `area` of the kit, or `sceneArea()` | The area for content, as a `Box`: `left`, `right`, `top`, `bottom`, `cx`, `cy`, `width`, `height`. |
| `box.columns(2)`, `box.columns([2, 1])`, `box.rows(3)` | Cut a region by a count or by shares. The gap between two parts is `wide` by default. |
| `box.inset(gap)`, `box.grow(gap)` | A margin inside or outside each edge. A second gap is for the top and the bottom. |
| `box.beside(thing, 'under')` | The part of a region on one side of a thing: `left`, `right`, `above` or `under`. It stays inside the region. |
| `box.point('top right')` | A corner, the middle of an edge, or the middle, as `[x, y]`: the end of a line or an arrow. |
| `row(items, { gap, align })` | Measure the items and lay them out from left to right. The middles are on one line, and texts of any size and font stand on one base line. `align` is `baseline`, `top`, `center` or `bottom`. |
| `column(items, { gap, align })` | From top to bottom. The left edges are on one line. `align` is `left`, `center` or `right`. |
| `grid(items, { columns, gap, align, even })` | A table, row by row. `null` is an empty cell. `align` is one value, or one for each column. `even` gives every row the height of the highest one. |
| `place(item, region, 'top left')` | Put an item at the middle, an edge or a corner of a region. |
| `beside(item, other, 'right', gap, align)` | Put an item beside a node, a block, a region or a point. `align` lines up an edge. |
| `beside(item, object, 'right', gap, part)` | A note on a part of an object: beside the whole object, at the height of the part. For `above` and `under`, at the x of the part. |
| `fitted(region, (width) => lanes(names, events, { width }))` | Build an object so that all of it, with its names and labels, is as wide as a region. |
| `boxOf(thing)`, `between(a, b)` | The measure of a node, a block or a list, and the room between two things, each as a `Box`. |
| `passage(text, { width }).region(part)` | Measure the selected words in stage coordinates. After `diff()` or `accept()`, `boxOf(page)` measures the new height. |
| `lanes(...).region({ lane, between, from, to, at })` | The box of a part of a `lanes` object: a lane, the room between two lanes, a stretch of time. |
| `numberLine(...).region({ at, from, to, band })` | The box around one value, a range of values, or a threshold band on a number line. |
| `scatter(...).region({ x, y })` | The box around the selected data ranges on a scatter plot. Omit both ranges for the whole plot. |
| `tokens(...).region({ from, to, row })` | The box of a run of token cells, or of their values in one named row. Read it again after a change moves the tokens. |

An item is a node, a block that a container returned, or a list of nodes that keep their places and move as one. A container skips an item that is `null` or `false`, so `tag && chip(tag)` is an item. Containers nest. A node is in a layout one time: a node that is two times in a container, or in it with a group that holds it, stops the build.

A container returns a block, not a node. It moves the nodes and leaves each one where it is in the tree, so a film still shows and fades each node by itself. Where a film gives nodes, a block stands for its nodes: `s.add(block)`, `fadeIn(block)`, `to(block, ...)`, `c.show(cue, block)`. A call that takes one node, such as an end of a `connector`, stops and says what to give. `block.nodes` lists them, and `block.box` measures them. A new block is around the middle of the stage until `place` or `beside` moves it.

Make each text with no place: `label('requests')`, `para(words, width)`, `note('our run')` and `display('160 times faster')` of the kit, or `text()`. `heading()` and `source()` have their own places outside the area: do not place them.

## Gaps and measures

- A gap is `'tight'` (12), `'normal'` (24), `'wide'` (48) or `'loose'` (72), or `'none'`, or a number. Use tight inside one thing, normal between the items of a list, wide between two groups, and loose between two parts of a picture.
- From `tight` to `loose`, a gap beside a text is at least 0.3 of the size of the text. That is the room that `vizmatic check --text-gap 0.3` asks for, and a text inside a block or a list has it too. The room is from the highest and the lowest letter of the font, not from the letters of the text, so texts of one font and one size give even rows. `'none'` and a number are exact: the layout adds nothing to them.
- A text measures as its line box: its advance width, and 1.2 text sizes for each line. So a column of lines has an even pitch, and a label of size 44 needs a band that is 52.8 high.
- A pictogram measures as the square of its grid. Every other node measures as its bounds, with the parts that are hidden now, because a scene lays a picture out before its parts arrive: `boxOf(group(rect(100, 60), rect(300, 300).hide()))` is 300 by 300, and `bounds()` of that group is 100 by 60.

## Timing on the clock of a scene

| Call | What it does, with no typed time |
|---|---|
| `c.show(cue, items)` | Fades nodes in. It starts 0.1 seconds before the phrase, and the fade takes 0.3 seconds. |
| `c.hide(cue, items)` | Fades out nodes that are on the screen, with the same lead and the same fade. |
| `c.swap(cue, out, in)` | The old nodes fade out, and the new ones start to fade in 0.2 seconds later, so two texts at one place are never both readable. |
| `c.on(phrase, build)` | Runs `build` at the phrase, for an `s.play(...)` of the scene's own. |

A cue is a spoken phrase, or the index of a beat for the start of that beat. A phrase that the voice says two times in the scene stops the build: use a longer phrase, or the option `beat`. The options are `{ beat, lead, fade, stagger, skipShown }`. `stagger: true` brings the items of a list 0.3 seconds apart, and nearer when the list would not end before the scene starts to leave. A list that cannot fit stops the build, and so does a stagger in seconds that does not fit. A list inside the list arrives as one item. An animation in a list plays as it is: `c.show('one host', [draw(frame), title])`.

A node shows one time. `c.show` brings a node that is not on the screen: a node that shows already at the cue stops the build, and the message names the node and the two cues. Such a node is in `s.add`, in another cue, or in two lists. `skipShown: true` leaves it as it is and brings the rest, for a block whose title is in the first picture. It sees only what the scene did in the lines above the call, so call `s.add` before it. The shell of `narrated()` opens the scene and fades out at its end all that the scene showed, so the fade of a node ends before its scene starts to leave, or the build stops.

## Example 1: a list beside a picture

```ts
import { column, grid, pictogram, place, row, sceneKit, type SceneClock, type Stage } from 'vizmatic/stage'

const { area, heading, label, note, chip } = sceneKit()
const DEVICES = [{ art: 'nic', name: 'network card', tag: 'virtio' }, { art: 'disk', name: 'disk', tag: 'virtio' }, { art: 'terminal', name: 'serial console', tag: '' }] as const

export function devices(s: Stage, c: SceneClock) {
    // The picture has the left half of the area, and the list has the right half, from its top left corner.
    const [left, right] = area.columns(2)
    const picture = place(pictogram('vm', { size: left!.height / 2, color: 'dim', accent: 'red' }), left!)
    const title = label('The guest sees three devices')
    const rows = DEVICES.map((d) => [pictogram(d.art, { size: 44 }), row([label(d.name), d.tag && chip(d.tag)])])
    const source = note('virtio: devices made for virtual machines')
    place(column([title, grid(rows.flat(), { columns: 2, gap: 'tight', even: true }), source], { gap: 'wide' }), right!, 'top left')
    s.add(heading('One microVM'), picture, title)
    DEVICES.forEach((d, i) => c.show(d.name, rows[i]!))
    c.show('made for virtual machines', source)
}
```

## Example 2: an object that fills a region, and a note on a part of an object

```ts
import { barChart, beside, eventLog, fitted, place, sceneKit, type SceneClock, type Stage } from 'vizmatic/stage'

const { area, heading, note } = sceneKit()
const ORDERS = [{ id: 1, name: 'OrderPlaced', detail: 'two books' }, { id: 2, name: 'OrderPlaced', detail: 'a lamp' }, { id: 3, name: 'OrderPlaced', detail: 'a chair' }]
const WAITS = [{ label: 'Mon', value: 3 }, { label: 'Tue', value: 9 }, { label: 'Wed', value: 4 }]

export function history(s: Stage, c: SceneClock) {
    const [upper, lower] = area.rows(2)
    // All of the log, with its border, is as wide as two thirds of the upper band. The chart is under it.
    const wide = upper!.columns([2, 1])[0]!
    const log = place(fitted(wide, (width) => eventLog(ORDERS, { width, visible: 3 })), wide)
    const chart = place(barChart(WAITS, { width: wide.width / 2, height: lower!.height / 2 }), lower!, 'bottom left')
    // A note on a part of an object: give the object, and then the part. Beside the whole log, at the height of row 3.
    const waits = beside(note('this one waits', { color: 'yellow' }), log, 'right', 'wide', log.row(3))
    // Over the whole chart, at the x of one bar.
    const worst = beside(note('the worst day'), chart, 'above', 'tight', chart.bar(1))
    s.add(heading('The log of the queue'), log, chart)
    c.show('still waits', waits)
    c.show('the worst day', worst)
}
```

`beside(note, log.row(3), 'right')` would put the note on the panel of the log, so it stops the build, and the message has the call above. To put a thing on an object on purpose, give `boxOf(part)`. `beside` looks at the box of the object and at the box of the part. It does not look at the labels that an object draws near a part, such as the value over a bar: the film check reports a note that lands on one.

## Example 3: a block that moves, a line, and a swap

```ts
import { boxOf, draw, grid, line, place, rect, row, sceneKit, to, type SceneClock, type Stage } from 'vizmatic/stage'

const { area, heading, label, display } = sceneKit()
const COSTS = [{ name: 'into the kernel and back', cycles: 1437 }, { name: 'through a monitor in user space', cycles: 6732 }]

export function costs(s: Stage, c: SceneClock) {
    const [upper, lower] = area.rows(2)
    // One scale for the bars: the longest one fills half of the area.
    const scale = area.columns(2)[0]!.width / Math.max(...COSTS.map((cost) => cost.cycles))
    const bars = COSTS.map((cost) => rect(cost.cycles * scale, 28, { radius: 6, fill: 'dim', stroke: null }))
    // A table: the names end at one right edge, and each bar has its value beside it.
    const cells = COSTS.flatMap((cost, i) => [label(cost.name), row([bars[i]!, label(`${cost.cycles} cycles`)])])
    const table = place(grid(cells, { columns: 2, align: ['right', 'left'] }), area)
    // A line is made after the nodes that it joins have their places: it holds its points.
    const span = boxOf(bars).grow('none', 'tight')
    const axis = line(span.point('top left'), span.point('bottom left'), { stroke: 'gridStrong' })
    const question = place(display('What does a crossing cost?'), lower!), thesis = place(display('A crossing costs time.'), lower!)
    s.add(heading('What a crossing costs'), question)
    c.show('about 1,400 cycles', [draw(axis), table])
    // To move a block, place it again inside `to`: every node that the change moves is animated.
    c.on('A crossing costs time', () => s.play(to(axis, () => place([table, axis], upper!))))
    // The answer takes the place of the question.
    c.swap('A crossing costs time', question, thesis)
}
```

## When an item does not fit

`place` stops the build when an item is larger than its region. The message names the item, says by how much it does not fit, and names the changes that work for this call. `place` and `beside` also stop when they would put an item off the frame of the film, and say by how much.

```text
narrated: scene "guest": place: the row with the text "one long label of words" is 14.4 too wide (614.4 in 600) for its region. What works: a smaller gap (the gaps take 24 of the 614.4), fewer items in the row, or a region that is 614.4 wide or more
```

## Rules

1. Make a line or an arrow after the nodes that it joins have their places.
2. Measure a picture at its last place. For a picture that moves, place it at the end place, cut the regions, and then place it at the start place.
3. A size or a gap that has no name is a number. Type it one time, with a comment that gives the reason.
4. A line box has more room over the letters than under them. In a low room between two marks, put the text at the edge that is free, or center its ink.
5. Two tables that show at one place at different times measure their own items. Give them one set of names when their columns must match.
6. Show an object before a part of it. A part that arrives first brings the whole object with it.
7. `group(a, b).arrange()` is still there for the films that use it. A new film uses `row` and `column`: they align left edges and base lines, they nest, and they keep each node its own.
