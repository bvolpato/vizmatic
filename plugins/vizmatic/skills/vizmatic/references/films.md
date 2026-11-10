# Vizmatic films

## Engine rules

- The stage is 1920 by 1080. (0, 0) is the center and y points down. `film({ aspect: '9:16' })` changes the shape.
- The build function runs once and may run again while fonts or math load. Keep it free of side effects and randomness that is not seeded.
- Use `font: 'text-serif'` for sentences, labels, and numbers. Use `font: 'serif'` only for short titles at a large size, because its fine strokes fade at phone size.
- Set the font once for the whole film: `film({ font: 'text-serif' }, (s) => { ... })`. Every `text()` with no `font` has it, and so has each label, title, caption and axis number that an object draws. Code, values, addresses and ids stay in mono, and `tex` stays in the math font. A text or an object with its own `font` keeps it. Make each node inside the callback: the fonts load while the callback runs, so a text at the top of a film file fails when the file loads.
- `s.add(node)` puts a node on stage now. `s.play(...)` writes animation and moves time forward. `s.wait(seconds)` holds.
- Reveal verbs such as `write`, `draw`, and `fadeIn` also add the node, so `s.add` is optional before them.
- Setters such as `.at`, `.fill`, and `.scale` apply at the current time. On a node that is not on stage, they set its initial state.
- `s.play(a, b)` runs together. Pass `{ duration, ease }` last to set both. Inside one animation, use `par`, `seq`, and `lagged`.
- Do not type an x or a y for a node. Lay the picture out: see "Layout" below. Node setters still place the origin, and `.moveTo([x, y])` moves the center of the bounds, for the one mark that follows a number of the data.
- `morph(a, b)` hides `a` and leaves `b` on stage. Later code refers to `b`.
- Reparenting is not on the timeline. Do not wrap nodes that are already on stage in `group()`. Pass an array to the verb: `fadeOut([a, b])`.

## Layout

Lay a picture out before you type a coordinate. Cut the area into regions, let a container measure the nodes, and place by relation. A typed x or y is right only for a mark at a value of the data.

```ts
const { area, heading, label, note, chip } = sceneKit()                    // or `const area = sceneArea()` with no kit
const [left, right] = area.columns([2, 1])                                 // also rows(3), inset('normal'), beside(picture, 'under')
const rows = devices.map((d) => [pictogram(d.art, { size: 44 }), row([label(d.name), d.tag && chip(d.tag)])])
const list = column([label('The guest sees four devices'), grid(rows.flat(), { columns: 2, gap: 'tight', even: true }), note('paper, 2020')], { gap: 'wide' })
place(list, right, 'top left')                                             // an item that does not fit stops the build, and says what works
beside(note('one process'), picture, 'under', 'tight')                     // beside a node, a block, a region or a point
beside(note('this one waits'), log, 'right', 'wide', log.row(3))           // a note on a part: beside the whole object, at the height of the part
const flow = place(fitted(left, (width) => lanes(names, events, { width })), left, 'top')
const wire = line(boxOf(disk).point('bottom'), boxOf(file).point('top'))   // make a line after its two ends have their places
```

- `row`, `column` and `grid` take nodes, blocks, and lists of nodes that move as one. They nest. They return a block and leave each node its own, so each node still fades by itself. `null` and `false` items are skipped. A block stands for its nodes in `s.add(block)`, `fadeIn(block)`, `to(block, ...)` and `c.show(cue, block)`, and it can be an end of a `connector`: the line meets the middle of the edge of its box. A node is in a layout one time.
- A gap is `'tight'` (12), `'normal'` (24), `'wide'` (48), `'loose'` (72), `'none'`, or a number. From `tight` to `loose`, a gap beside a text is at least 0.3 of the text size, the room that `check --text-gap 0.3` asks for. It is the same for every text of one font and one size, so rows are even. `'none'` and a number are exact.
- A text measures as its line box, 1.2 text sizes for each line. In a row, texts of any size stand on one base line. Make texts with no place: `label('requests')`, `para(words, width)`, `note('our run')`, `display('160 times faster')`.
- A part of an object gives a region: `flow.region({ lane: 'monitor', from: 0, to: 4 })`, `flow.region({ between: ['guest', 'KVM'] })`. To put a thing on an object on purpose, give the box of the part: `boxOf(card.caption)`.
- Each call gives a right picture, or an error that says what to do. Read the message: it names the changes that work.
- To move a block during a film, place it again inside `to`: `to(block, () => place(block, lower, 'top'))`.
- `group(a, b).arrange()` stays for the films that have it. Do not use it in a new film: it centers every item, it measures the ink, and one part that fades in shows the whole group.

The [layout guide](https://bvolpato.github.io/vizmatic/docs/layout.html) has the table of the pieces and three examples.

## Timing

Use `s.chapter('Name')` to mark steps. Use `s.at(time, () => ...)` to author at another time, such as a background motion behind a voiceover beat. A clip's default length suits most moves, so set `duration` only with a reason. Easing comes from the `ease` option. The default is `smooth`. `smoother` suits long camera moves, `overshoot()` and `spring()` suit arrivals, and `thereAndBack` suits emphasis.

A `duration` on `s.play` stretches every animation to fill it. A `duration` inside an animation in that call has no effect, and neither does `retime`. To give animations different lengths, leave `duration` off `s.play`, set it on each animation, and use `delay` for an offset:

```ts
// The old text is gone before the new text can be read.
s.play(fadeOut(oldText, { duration: 0.15 }), delay(fadeIn(newText, { duration: 0.25 }), 0.1))
```

Inside a `s.play` that has a `duration`, use `seq`. It gives each animation its share of the time, so the old text leaves in the first half and the new text arrives in the second:

```ts
s.play(morphMatching(eq0, eq1), seq(fadeOut(oldNote), fadeIn(newNote)), { duration: 1.3 })
```

## Sound and captions

`--audio narration.wav` adds a sound track. It is padded or trimmed to the film's length, so a film that ends early cuts off the voice. Hold to the end with `s.wait(Math.max(0, voiceLength - s.time))`. `s.caption(text, seconds)` adds a caption and draws nothing into the picture.

An MP4 carries the film's title, its chapters as markers on the player's timeline, and its captions as a track that the viewer can switch on. The same captions are also written as a WebVTT file beside the video. No second pass with FFmpeg is needed.

For a film that follows a recorded voice, use `narrated({ title, timing, scenes })`. It draws the title card from the title. It calls each scene when its picture opens, fades in what the scene adds there with `s.add`, and fades out every node of the scene at its end, so a scene types no time for that. It gives each scene the clock of its part of the voice. `c.show('a spoken phrase', nodes)` fades nodes in 0.1 seconds before the phrase, in 0.3 seconds, and `c.hide` and `c.swap(cue, out, in)` have the same defaults, so a scene types no time for them. `{ stagger: true }` brings a list one item after another, and an animation in the list plays as it is: `c.show('one host', [draw(frame), title])`. A node shows one time: `c.show` brings a node that is not on the screen, and `{ skipShown: true }` brings the rest of a block whose title is in the first picture. It sees only the lines above the call, so call `s.add` first. A thing that the voice names comes before its phrase, which is the default. A result that the voice reaches, such as a number that it computes, comes when the voice has said it: `c.show('one hundred and sixty times', number, { after: true })`, and the same option for `c.hide` and `c.swap`. `c.on('a spoken phrase', build)` runs `build` when the voice reaches that phrase, for a play of the scene's own. `c.keep(node)` holds a node for the next scene, which takes its own copy with `c.take(node)`. A phrase that the voice does not say stops the build, and so does a phrase that it says two times in the scene (use a longer phrase, or the beat), and a scene that the script or the film does not have. A play that ends after its scene stops the build too, because the film must not run past its narration: give it a shorter duration, an earlier cue, or a longer `hold` in the script. For a course, where a person reviews the script apart from the film, declare the cues in the script: a beat has `"cues": [{ "id": "result", "phrase": "one hundred and sixty times" }]`, a scene names the id where it can name a phrase, `c.show('result', number)`, and a declared cue that no scene uses stops the build. For a short film, type the phrase in the scene. Another tool can write the timing from its own sound, with a `start` for each scene: the guide has its shape. It also adds the captions and one chapter for each titled scene. `narration(s, timing)` is the layer under it, for a film that needs another order of work.

`npx vizmatic new <name> --template narrated` writes the folder of such a film. One command then brings it up to date, from the script to the movie: `npx vizmatic narrated build <folder> --draft` makes the voice on this machine, the sound mix, the layout check, and a draft movie. It runs only the steps that have work to do, and says why. Without `--draft`, it makes the delivered movie. The [narrated films guide](https://bvolpato.github.io/vizmatic/docs/narrated-films.html) covers the folder, the script, the clock, the build, the checks, and the review. `references/lessons.md` has the rules for a film that teaches.

## Worked films

`examples/films/` holds finished films with full source, and each one compiles and passes `vizmatic check`. The package includes them, so read them from `node_modules/vizmatic/examples/films/`. Read one before you write a similar film.

| Film | What to learn from it |
|---|---|
| `attention.ts` | Compute every number on screen from small real inputs. |
| `cache-miss.ts` | Run a small queueing model, and draw the system from its results. |
| `paxos.ts` | Play a protocol through a schedule of delays and losses, and send each message of the trace along a `connector` with `send`. |
| `gradient-descent.ts` | Drive motion from real iterates, and compare two runs. |
| `linear-maps.ts` | Bend a grid with `applyMatrix`, and follow what it does to area. |
| `complex-maps.ts` | Move a grid through a family of maps, and direct the camera. |
| `fourier-epicycles.ts` | Compute motion and readouts from a real transform. |
| `lorenz.ts` | Integrate a system, and read values from the result. |
| `central-limit.ts` | Use seeded randomness, so that every render shows the same counts. |
| `forecast.ts` | Move a window along a series, open a band up to a time, and count the truth against it. |
| `taylor-series.ts` | Build a result one term at a time. |
| `pythagoras.ts`, `euler-circle.ts` | Keep a short proof or a short idea to one picture. |
| `deck-example.ts` | Write a talk with one chapter per step, for `<vz-film stepped>`. |

## Patterns

Any motion driven by a number:

```ts
const t = s.value(0)
s.add(dynamic(() => dot(10, 'yellow').at(plot.world(t.value, f(t.value)))))
s.play(t.to(3, { duration: 4 }))
```

A chart of a series that moves: a window that scrolls, a line that grows, a marker for the present, and a band between two curves. Do not draw the frame, the band, and the marker by hand. A range of `axes` can be a function, and every mark on the axes then follows it. `plot` takes a function or the points of a series, `[x, y]`, and draws it up to a value. `band` fills the room between two curves. `examples/films/forecast.ts` is a whole film of it:

```ts
const now = s.value(8), ahead = s.value(0)
const graph = s.add(axes({ x: () => [now.value - 8, now.value + 4], y: [0, 10], xStep: 2, tips: false }))
band(graph, low, high, { from: 16, to: () => 16 + ahead.value, fill: 'blue' })   // each curve is a function or a series
graph.plot(points, { to: () => now.value, stroke: 'ink' })                       // a series: straight lines through its points
graph.marker({ x: () => now.value, label: 'now' })
graph.add(dynamic(() => dot(8, 'ink').at(graph.p(now.value, valueAt(points, now.value)))))
s.play(now.to(16, { ease: linear }), { duration: 3 })
s.play(ahead.to(4))
```

A derivation that keeps shared terms in place:

```ts
let current = s.add(tex('x^2 + 6x + 5 = 0', { size: 84 }))
s.play(write(current))
for (const step of ['x^2 + 6x = -5', '(x + 3)^2 = 4']) {
    const next = tex(step, { size: 84 })
    s.play(morphMatching(current, next))
    current = next
}
```

Color one term, and select it by its TeX:

```ts
const eq = s.add(tex('a^2 + b^2 = c^2', { size: 80 }))
for (const glyph of eq.part('b^2')) glyph.color('yellow')
```

A grid that bends under a matrix:

```ts
const grid = s.add(plane({ unit: 90 }))
s.play(draw(grid, { lag: 0.002 }))
s.play(applyMatrix(grid, [[1, 1], [0, 1]]), { duration: 3 })
```

A camera move, with a title that stays put:

```ts
const title = s.add(text('Zoom in', { size: 48 }).at(0, -460).pin())
s.play(to(s.camera, (camera) => camera.at(300, 100).set('sx', 2.5)), { duration: 2, ease: smoother })
```

One node in the light while the voice talks about it. Do not fade the other nodes by hand: the list of the nodes on screen gets long, and a node that the list forgets stays bright or stays dim. `spotlight` dims every other node that shows, a second `spotlight` moves the light, and `spotlight(null)` turns it off. `keep` lists what stays bright with the target, such as a heading and a source line. Give it to each call. Pinned nodes stay bright without it. `within: chart` dims only inside one node. A dim node keeps its opacity and its colors go toward the background, so it still hides what is behind it, and a `fade` under the light is still there when the light goes off. The lights follow the time of the film, so `s.at` can name them in any order. A light on `chart.bar(2)` keeps the name and the readout of that bar bright, and `dotChart` and `lanes` do the same for a dot and for the shape of an event. A light cannot dim a node while it morphs, so make the source of a morph a target or a `keep`. A node that comes to the stage with the light, or later, is not dimmed:

```ts
const keep = [heading, source]
s.play(spotlight(row3, { keep }))
s.play(spotlight([row5, total], { keep, dim: 0.25 }))
s.play(spotlight(null))
```

Code in a specification or proof language. `codeBlock` knows `tla`, `dafny`, `lean`, and `smt`, where a prime is part of the code and not a quote:

```ts
const spec = s.add(codeBlock("Expire == /\\ lease' = \"free\"", { language: 'tla', size: 40 }))
s.play(write(spec))
```

A signal along an edge. `arrow` keeps its shaft in `edge.data.shaft`:

```ts
const edge = s.add(arrow([-300, 0], [300, 0], { stroke: 'dim', width: 2 }))
s.play(pulse(edge.data['shaft'] as Node, { color: 'yellow' }))
```

A dense system box with live numbers: see `infoBox`, `connector`, and `legend` in `vizmatic objects`, and the `architecture` template.

A message between two parts of a protocol: a request, an answer, a packet. Do not move the mark along the line by hand. `link.send(mark)` grows the mark in beside the first node, carries it at one speed, and takes it into the node at the end. `reverse: true` is an answer. `lost: 0.6` stops it at that part of the way, and `refused: true` stops it before the node, each with a cross that stays for `hold` seconds. `duration` is the time on the way, so a slow message has a long one. For the trace of a simulation, play each message at its time with `s.at`:

```ts
const link = s.add(connector(client, server, { route: 'straight', tip: false }))
s.play(link.send(chip('request', { anchor: 'center' }), { duration: 1.2 }))
s.play(link.send(chip('answer', { anchor: 'center' }), { duration: 1.2, reverse: true }))
s.play(link.send(chip('request', { anchor: 'center' }), { duration: 0.8, lost: 0.6 }))
```

A small picture of a kind of thing, for a card or a legend. Do not draw these by hand. `PICTOGRAMS` lists the names, which include `series`, `forecast`, `logs`, `traces`, `graph`, `dag`, `tree`, `database`, `service`, `vm`, `process`, `kernel`, `memory`, `disk`, `snapshot`, `core`, `drive`, `server`, `thread`, `interrupt`, `syscall`, `ring`, `page`, `workflow`, `signal`, `issue`, `pullRequest`, `browser`, `model`, `tokens`, `vector`, `event`, `alert`, `check`, and `cross`:

```ts
const picture = s.add(pictogram('forecast', { size: 120, color: 'dim', accent: 'blue' }).at(-300, 0))
s.play(draw(picture))
```

A named border around a group of nodes: a host, a network, a sandbox, a boundary of trust. Do not size such a border by hand. `zone` measures its content, and zones nest. Build the content first, then the zone, then add the zone:

```ts
const guest = zone([kernel, code], { title: 'microVM', color: 'teal' })
const jail = zone([guest, devices], { title: 'jail', color: 'yellow', dash: true })
s.add(zone(jail, { title: 'host' }).at(0, 0))
```

A row of steps with one of them lit: the chapters of an argument, the stages of a process, a list of options that the film takes one by one. Do not build it from boxes and three colors in each film. `steps` gives the boxes one width, keeps one text size for all labels, and stops the build when a label cannot fit. `go(index)` moves the light: the steps before it are dim, and the steps after it are fainter. A step can have a `note` under its box, `direction: 'column'` makes a list at the left of a frame, and `strip.p(index)` is the point where a line to the picture of the step starts:

```ts
const strip = s.add(steps(['batching', 'SQPOLL', 'register', 'I/O polling'], { width: 1800, numbered: true, current: 0 }).at(0, -400))
s.play(strip.go(1))
```

A sequence over time with one lane for each actor, such as a system call, a VM exit, or a request through several services. Do not draw the bars and the arrows by hand. `lanes` places the labels, and stops the build when two labels would touch. `advance` moves the cursor to a time and stops there, so one call fits one sentence of the voice. With `ticks`, one lane is a chart of durations on a time axis. With `boundaries`, a line between two lanes counts the handoffs that cross it, such as `{ between: ['user space', 'kernel'], label: 'system call line', count: true }`, so two objects side by side compare two designs by their crossings. `idle: true` is a span where the lane waits, and `dashed: true` is a handoff whose sender does not wait. When a label has no place, `labelSide` on the event names one. On a panel or in a zone with a fill, set `backing` to the color behind the object, or `backing: null` with `cursor: false`:

```ts
const flow = s.add(lanes(['user space', 'kernel'], [
    { lane: 'user space', start: 0, end: 20, label: 'runs' },
    { from: 'user space', to: 'kernel', at: 20, label: 'read' },
    { lane: 'kernel', start: 20, end: 60, label: 'waits for the drive' },
    { from: 'kernel', to: 'user space', at: 60, label: 'returns' },
    { lane: 'user space', start: 60, end: 100, label: 'runs', open: true },
]).at(120, 0))
s.play(flow.advance(20))
s.play(flow.advance(60))
s.play(flow.showAll())
```

A request against a deadline, the trace of a request, a retry, or an outage: `lanes` has these too, so do not draw them over it by hand. `deadline: { at, label, drain: true }` is a line at a time with a bar that drains as the cursor moves, and `flow.remaining()` is the time that is left. A span with `inside: id` is a child of the span with that id, in a row under it, as in a trace. `outcome: 'failed'` or `'cancelled'` puts a cross or a square on the end of a span, makes a mark that sign, and stops a handoff on its way as a lost message. `down: true` is a hatched span where the lane is not there. A link, `{ from, to, at: [time, time] }`, joins two times, also on one lane and back in time. `{ bracket: [from, to], label }` names a window of time. Give an event an `id`: `advance(id)` stops the cursor at that event, and `flow.region({ event: id })` is its box for a note. This request trace stops at the first token. Play advances on the same cursor in sequence.

```ts
const trace = s.add(lanes(['request', 'model API'], [
    { lane: 'request', start: 0, end: 430, id: 'answer', label: 'answer' },
    { lane: 'request', start: 0, end: 90, inside: 'answer', label: 'retrieval' },
    { lane: 'request', start: 90, end: 380, inside: 'answer', id: 'generation', label: 'generation', outcome: 'failed' },
    { lane: 'request', at: 280, inside: 'generation', id: 'first-token', label: 'first token' },
    { lane: 'model API', start: 90, end: 380, label: 'streams' },
    { lane: 'model API', start: 380, end: 500, down: true, label: 'outage' },
    { bracket: [0, 280], label: 'time to first token' },
], { pitch: 200, deadline: { at: 450, label: (left) => `${Math.round(left)} ms left`, drain: true } }).at(120, 0))
s.play(trace.advance('first-token'))
const note = beside(text('nothing shows before this'), trace, 'above', 'normal', trace.region({ event: 'first-token' }))
s.play(fadeIn(note))
s.play(trace.showAll())
```

A line between two sides that counts what crosses it: user space and the kernel, a guest and its host. Do not draw the line, the ticks, and the counter by hand. `cross` sends a mark through the line and leaves a tick. `addCrossings` runs the tally up with no mark, for a number that is too large to draw, and fills the line with ticks. `clear` starts the next round. `line.x(part)` gives a place that is clear of the names and the tally. For lines that a film compares, give all of them one `tickScale`, so that their ticks compare as their counts do, and `tallySide: 'over'` when they stand side by side. `crossThrough([calls, wall], x)` sends one mark through two lines:

```ts
const line = s.add(boundary({ label: 'system call line', above: 'user space', below: 'kernel', tally: ['system call', 'system calls'] }))
s.play(line.enter())
s.play(lagged([0.2, 0.5, 0.8].map((part) => line.cross(line.x(part), { direction: 'round' })), { lag: 0.4 }))
s.play(line.addCrossings(9997), { duration: 2 })
s.play(line.clear())
```

A line of time with events at their dates: the history of a project, the releases of a kernel, who said what and when. Do not draw the line, the ticks and the stems by hand. `dateLine` puts each event at its date, writes the years, the months, or the days by the span of the line so that two texts never touch, and places the labels over the line and under it so that no two meet. It stops the build when a label has no place. `advance(date)` moves the cursor to a date and stops there, as in `lanes`, and what it passes appears. An event with no label is a mark only, as a dot, a star, or a ring. Marks that are near take rows over the line, also the marks of two events with labels a few days apart, and `record.light(index)` gives the event of the scene the accent color and a ring. An error of a layout ends with the changes that work for that line. For events with labels that are crowded in time, `scale: 'order'` puts them at equal steps and says "not to scale", and then `at` can be a version such as `'5.1'`. The bounds of the object hold the labels from the start, also while they are hidden, and `record.extent` is that room:

```ts
const record = s.add(dateLine([
    { at: 2020, label: 'the first paper' },
    { at: '2025-06-10', label: 'the newsletter', color: 'orange' },
    { at: '2026-03-24', label: 'the technical report', color: 'orange', note: 'names the system' },
], { width: 1600, from: 2020, to: 2027 }).at(0, 240))
s.play(record.advance(2021))
s.play(record.showAll())
```

One axis with values on it: a score against a cutoff, a measured value against a limit, the values that a number format can store. Do not write the comparison as a sentence, and do not draw the line, the dots and the cutoff by hand. `numberLine` takes `ticks` at any steps, `points` with a name, `thresholds`, and `bands`. `move` slides a point. `snap` takes it to the nearest tick, and leaves the error as a red line. `moveThreshold` slides a cutoff: each point takes the look of its new band at the moment of the crossing, and with `counts: true` the counts of the bands follow. `hollow: true` on a band draws its points as rings, a second sign beside the color. `bracket('A', 'B')` shows the gap between two points and follows them. `line.count(band)`, `line.bandOf(name)` and `line.value(name)` read the state, for a text beside the line. The texts are 28 px by default and the numbers 24 px, so give `size: 32` for a lesson. `length` is the width for `fitted`:

```ts
const strip = s.add(numberLine({
    range: [0.4, 1], ticks: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], format: (score) => score.toFixed(2), length: 1600, size: 32,
    thresholds: [{ at: 0.7, label: 'cutoff' }],
    bands: [{ name: 'human review', color: 'orange', hollow: true }, { name: 'served at once', color: 'green' }],
    counts: true,
    points: [{ name: 'formal', value: 0.78 }, { name: 'plain', value: 0.67 }],
}))
s.play(strip.moveThreshold(0.5))                    // both are served: strip.count('served at once') is 2
s.play(strip.move('plain', 0.45))                   // the point crosses the cutoff, and takes the look of the review side
const grid = s.add(numberLine({ ticks: [1, 1.125, 1.25, 1.5, 2, 3, 4], tickLabels: [1, 2, 4], points: [{ name: 'w', value: 1.3 }] }))
s.play(grid.snap('w'))                              // to 1.25, the nearest value that the format can store
```

Points on a plane that change: an embedding space, a nearest neighbor search, an index of cells, k-means. Do not draw a new small plot in each scene: keep one plane, and act on it. A point of `scatter` has a `name`, and a group has a color and a `shape`. `move`, `insert`, `remove` and `assign` change the points. `nearest('q', 3)` grows a ring from a point to its third nearest point, with a line to each point that the ring holds, and the search stays true while the points move. `among` keeps it to some points. `hull(group)` is the outline of a group, `cells(centers)` cuts the plot into one cell for each center, and `span({ x })` is a part of the axes. Each is an area: `shade()` lights it, `area.points` lists the points of the data in it, and `area.holds('q')` says if a point is in it. The distance is in the units of the axes, so give both axes the same pixels for one unit when the ring must be a circle. `chart.nearestTo('q', 2)` and `chart.neighbors` give the points for a table beside the plane. The names are 26 px by default and the numbers of the axes 18 px, so give `labelSize: 26` for a lesson:

```ts
const plane = s.add(scatter(points, {
    x: [0, 10], y: [0, 10], width: 800, height: 800, labelSize: 26,
    groups: { centroid: { color: 'ink', shape: 'ring' }, found: { color: 'green', shape: 'diamond' } },
}))
const cells = plane.cells(['c1', 'c2'])
s.play(plane.insert({ x: 4.8, y: 5, name: 'q', query: true }))
const first = cells.find((cell) => cell.holds('q'))!
s.play(first.shade(), plane.nearest('q', 2, { among: first.points }))   // one probe: the search scores the vectors of one cell
s.play(plane.assign(plane.neighbors, 'found'))                          // the two that it found take a group, a color and a shape
```

A mark for the kind of a claim and its source, in a corner of the frame, that changes as the film moves from a plan to a result. Do not build it from a pill and two texts in each film:

```ts
s.add(tagTrack([
    { at: 0, word: 'PLAN', color: 'blue', note: 'the design of March' },
    { at: 41.5, word: 'MEASURED', color: 'green', note: 'the run of June, on 926 questions' },
], { until: 96 }).at(-912, -490))
```

The exact words of a source, with who said them and when. Do not build a quote from a text, a line, and a second text in each film. `quote` wraps the words at `width`, adds the quotation marks, and puts the source line under the words. `mark` sets a part of the words in the color of the rule, and `said.find(part)` gives its glyphs, to color them when the voice says them. A part is whole words, at all its places in the words. Where the film leaves words out, write `[...]` and set `cut: true`: the object adds none. Hold a quote for one second for each 20 characters of its words and its source line together. For a panel behind a quote, put the quote in a `zone` with a fill. `quotePair` puts two sources that disagree side by side, with a word such as "but" between them:

```ts
const said = quote('the agent loop lives in Temporal rather than on the VM itself', {
    by: 'Cursor', when: '2026-06-02', width: 1100, size: 44, color: 'orange', mark: 'lives in Temporal',
}).at(-550, -120)
s.play(said.enter())
s.wait(readingSeconds(said.reading))
```

Use `passage` for prose that a viewer follows through an edit. Name a span by its words. Mark a claim with `mark(words, kind)`, connect it to its source with `link()`, and call `break()` on the link when the source contradicts the claim. Each kind has a color and a distinct sign. `diff(next)` displays the revision and `accept()` removes the deleted words.

For document chunking, `cut({ size: 12, overlap: 3 })` makes windows of words. Use `select({ chunk: 0 })` to move the selection, `counter('words')` for a readout, and `slip()` with `lift()` to pull a copy out. The films in `examples/films/passage/` show how to lay out a runbook, an answer with supporting sources, and a prompt with a JSON reply.

```ts
const answer = s.add(passage('The shop is closed on Sunday.\nRefunds arrive immediately.', { width: 700, title: 'answer' }).at(-800, -300))
const source = s.add(passage('Closed on Sunday. A refund is paid on the next business day.', { width: 700, title: 'source' }).at(100, -300))
s.play(answer.mark('The shop is closed on Sunday.', 'claim'), source.mark('Closed on Sunday.'))
const tie = answer.link('The shop is closed on Sunday.', source.span('Closed on Sunday.'), { color: 'green' })
s.play(tie.enter(), answer.mark('The shop is closed on Sunday.', 'supported'))
s.play(answer.mark('Refunds arrive immediately.', 'contradicted'))
s.play(source.diff('Closed on Sunday and on Monday. A refund is paid on the next business day.'))
s.play(source.accept())
```

A tool call, the reply of a model, or a configuration file as data. `codeBlock` colors `json` and `yaml` with the keys in one color, so a viewer tells the names from the values:

```ts
const call = s.add(codeBlock('{\n  "name": "get_weather",\n  "arguments": { "city": "Paris", "days": 3 }\n}', { language: 'json', size: 40 }))
s.play(call.focus(2))
```

The labels and the frame that the scenes of one film share. Do not copy label helpers from film to film. `sceneKit` makes them in one font, with the heading, the source line, and the area for content at their places in the frame. Its one `size` sets every size: the heading, the source line, the claim tag, the chips and the names of the boxes follow it. `claimTag(c, { word: 'MEASURED', note: 'our run' })` puts a tag for the kind of the claim at the right end of the source line:

```ts
const { area, heading, source, label, note, display, chip, claimTag } = sceneKit({ size: 40 })
const title = heading('One microVM')
const from = source('Firecracker docs/design.md, 2026')
const name = place(label('guest kernel', { color: 'teal' }), area, 'top left')
```

`heading` and `source` have their places in the frame. Every other text has none: `label`, `para(words, width)`, `note` for a small dim remark and `display` for the one large line of a picture. The layout places them.

A name in a box, and a short label in a box. Do not size the text by hand. `namedBox` sets a name smaller when it is too wide for its box, and `group` gives twin boxes one text size. `chip` takes its width from its label. `chipRow` wraps a list of chips only with `maxWidth`. A tag, a chip and a row of chips have one rule: `.at` places the left end, and `anchor: 'center'` or `'right'` places the middle or the right end. For the stages of a process with one of them lit, use `steps` and not a row of chips or of named boxes:

```ts
const names = ['host kernel', 'virtual machine monitor']
const boxes = names.map((name, i) => namedBox(name, { width: 320, height: 96, color: 'teal', group: names }).at(-180 + i * 360, -80))
const walls = s.add(chipRow(['KVM', 'seccomp', 'cgroups', 'namespaces'], { maxWidth: 600 }).at(-300, 80))
```

A grid of cells that change state: pages of memory, blocks of a disk, the hosts of a fleet. Do not draw the cells by hand. `stateGrid` keeps the state of each cell, sweeps a change across the cells, and counts them. `PAGE_STATES` has the states of memory pages, and `states` takes your own:

```ts
const pages = s.add(stateGrid({ columns: 16, rows: 8, cell: 56, initial: 'absent' }).at(0, -40))
s.add(pages.legend(['absent', 'present', 'dirty'], { size: 32 }).at(pages.left[0], 300))
s.play(pages.change((index) => index < 96, 'present'), { duration: 1.6 })
s.play(pages.change([3, 4, 5, 40], 'dirty'))
const count = text(`${pages.count('dirty')} dirty pages`, { font: 'text-serif', size: 40 })
```

The output of a real program: the command, the lines that it printed with their exact characters, and where and when it ran. Do not build it from a box and a `codeBlock` in each film. `find` selects one number by its exact text, to light it when the voice says it. Expand tabs to spaces, and leave lines out with a note line such as `{ text: '[...]', kind: 'note' }`. A terminal shows all its lines unless it starts with `shown: false` or with `enter()`. `print()` brings one block: the lines up to the next command, with the command itself when the film did not type it:

```ts
const run = terminal([
    { text: './one-byte', kind: 'command' },
    'Rss after the write:       4 kB',
    'minor faults:              1',
], { title: 'data/runs/01-one-byte.txt', note: 'Linux 7.0, arm64, 2026-11-08' })
s.play(run.enter())
s.play(run.type(0))
s.play(run.print())
s.play(recolor(run.find('4 kB'), 'yellow'))
```

A list of records that grows, such as the event history of a workflow, the steps of an agent, or the life of a sandbox. Do not build it from a terminal or from texts by hand. `eventLog` keeps the columns in line, scrolls a full window with a count of the records above, and gives each row a state with its own mark, a place for a connector (`log.p(id)`), and one outline that `focus` moves. A row with `ids` is a fold that stands for several records, and `unfold` opens it into its `rows`. `scrollTo(id)` brings an early row back into the window, and `show(which)` brings in a row that had its place from the start (`shown: false`). Play one change of the rows at a time: two of `append`, `fold`, `unfold`, and `scrollTo` whose times overlap are an error, and `mark`, `focus`, and `show` play with any of them. Append two or three rows per second at most, and fold what repeats in a long history:

```ts
const log = s.add(eventLog([
    { id: 1, name: 'WorkflowExecutionStarted', detail: 'order' },
    { ids: [2, 3, 4], name: 'workflow task', detail: 'worker 71293' },
], { title: 'event history', footer: (count) => `${count} events`, visible: 12 }))
s.play(log.append({ id: 5, name: 'ActivityTaskScheduled', detail: 'chargeCard', state: 'new' }), log.focus(5))
s.play(log.mark((row) => row.state === 'new', 'stored'))
s.play(log.mark(5, 'answered'))
```

A table whose rows are the data of the example: the cases of an evaluation, the candidates of a choice, the records of a ledger. Do not build it from `grid` and texts, and do not show a table that stands still. `table` keeps the columns in line, gives each row an id and a node that it keeps, and gives a cell a state with a color and a mark (`pass`, `fail`, `warn`, `pending`, `skip`, or your own). `light` moves one marker to a row, a column or a cell, `setCell` changes a value or a state in place, `append` and `remove` change the rows, and `sort` and `moveRow` move them. A column with a `total` gives a total row that follows the rows. The text size is 28 by default. The columns are set from the first rows, so give a column a `sample` when it gets a longer value later, and give a table that grows its `maxRows`. A cloned table starts its own timeline and keeps the graphics attached to its cells, including when a group contains the table. Play one change of the rows at a time: two of `append`, `remove`, `sort` and `moveRow` whose times overlap are an error, and `setCell` and `light` play with any of them:

```ts
const results = s.add(table([
    { key: 'name', label: 'incident case', total: () => 'passed' },
    { key: 'old', label: 'old prompt', align: 'center', total: (rows) => `${rows.filter((row) => row.states.old === 'pass').length}/${rows.length}` },
    { key: 'score', format: (value) => value.toFixed(2) },
], [
    { id: 'overdue', name: 'page is overdue', old: { state: 'pending' }, score: 0.4 },
    { id: 'prior', name: 'a page was sent before', old: { state: 'pending' }, score: 0.93 },
], { size: 36, maxRows: 3 }))
s.play(results.light('overdue', 'old'), results.setCell('overdue', 'old', { state: 'fail' }))
s.play(results.append({ id: 'first', name: 'first page is due', old: { state: 'pass' }, score: 0.62 }))
s.play(results.sort('score', { descending: true }), results.light('prior'))
s.add(arrow(start, results.region('prior', 'score').point('left')))
```

A box with a title, a figure, and a caption. Do not place these three by hand. `card` keeps the margins, centers the figure, and scales it down when it is too large. Give the cards of a row one `width`, one `height`, and one `captionLines` (the lines of the longest caption):

```ts
const shared = { width: 420, height: 400, captionLines: 2 }
const logs = card({ title: 'Logs', figure: pictogram('logs', { size: 140 }), caption: 'one line per event', color: 'yellow', ...shared })
const traces = card({ title: 'Traces', figure: pictogram('traces', { size: 140 }), caption: 'the path of one request through the services', color: 'purple', ...shared })
row([logs, traces], { gap: 32 })
s.add(logs, traces)
```

Values that differ by more than about a hundred times, such as 100 ns beside 10 ms. On a linear axis, all but the largest sit at zero. Give `dotChart` a log axis, and say on screen that the axis is logarithmic. The `xLabel` is the place:

```ts
const time = (ns: number) => (ns >= 1e6 ? `${ns / 1e6} ms` : ns >= 1e3 ? `${ns / 1e3} µs` : `${ns} ns`)
const chart = dotChart([{ label: 'system call', value: 100 }, { label: 'read from a spinning disk', value: 10_000_000 }], { scale: 'log', format: time, xLabel: 'time, logarithmic' })
s.play(chart.enter())
```

A word split into named fields: a virtual address and its table indexes, the flags of a register, the layout of a structure. Do not build it from boxes and texts in each film. `bitField` gives each box a width for its bits, numbers the bits, and keeps every text inside its box. `minWidth` or `scale: 'even'` gives a field of one bit room for a name, and `unused: true` marks reserved bits. For the layout of a structure, `numbers: 'offsets'` counts its bytes, and `wrap: 16` fills rows of 16 bytes. A field with a `value` shows it in its box, and `word.setValue('fd', '3')` changes it in place. `word.field('table')` is the node of one field, and `word.p('table')` is the point where a line from it starts:

```ts
const word = s.add(bitField([
    { bits: 10, label: 'directory', color: 'blue' },
    { bits: 10, label: 'table', color: 'orange' },
    { bits: 12, label: 'offset', color: 'purple' },
], { width: 1400 }).at(0, -200))
s.add(connector(word.toWorld(...word.p('table')), pageTable, { color: 'orange' }))
```

Use `tokens` for a sentence, a sequence of bytes, or the parts of a prompt. Put IDs, positions, or targets in named rows under the cells. Mark prompt tokens as masked, or append generated tokens as they arrive. A bracket names a span, and a window highlights a range. Give the strip `size: 32` or larger for a 1080p film. The default token size is 22, and the row values use 0.82 of the token size.

```ts
const words = ['<s>', 'user', 'Sit', '!', 'bot', 'Good', 'dog', '</s>']
const chat = tokens(words, { size: 44, even: true, label: 'input', rows: { target: words } })
s.play(chat.enter())
s.play(chat.shiftRow('target', -1))
const prompt = [0, 1, 2, 3]
s.play(chat.mark(prompt, 'masked'), ...prompt.map((index) => chat.setValue('target', index, -100)))
```

Use `split` and `merge` to show how a tokenizer changes its pieces. Each change reads its indexes when it plays. Merge disjoint pairs from right to left so earlier indexes stay valid. Reserve space with `width` when a strip will grow. Use `strip.p(index)` for a line endpoint and `strip.region({ from, to })` to place a note beside a range. Read these positions again after moving the tokens.

Requests that wait for a server: a queue in front of the seats of a batch, the workers of a pool, a gate with a budget. Do not move chips by hand. `requestQueue` keeps each request as one item with its id, moves it from its line into a free slot on a way that meets no other item, and counts what waits, runs, is done and is rejected. `work` gives an item a bar and a number of units that are left, `lines` adds a second line or a priority, and `pool` adds fixed blocks, such as KV pages, that an item takes while it runs:

```ts
const queue = s.add(requestQueue([{ id: 'A', work: 2 }, { id: 'B', work: 4 }, { id: 'C', work: 6 }, { id: 'D', work: 4 }], { slots: 3, deadline: 250, names: { slots: 'GPU batch' } }))
s.play(queue.admit(queue.next(3)))       // the heads of the line go to the free slots, one after another
s.play(queue.run(2))                     // each bar grows, and each number of units that are left counts down
s.play(queue.finish(), queue.admit())    // A leaves and D takes its seat, in one play: name the finish first
s.play(queue.arrive({ id: 'E', work: 2 }))
s.play(queue.wait('E', 310))             // the wait of E runs as a number, and turns red at the deadline
s.play(queue.reject((item) => item.late, '503'))
```

A line serves its head first, and the slots take one `admit` at a time: give one `admit` a list, and do not play two. `finish` with no argument takes the items that have no work left. `queue.stateOf(id)`, `queue.count('waiting')`, `queue.next()`, `queue.freeSlots` and `queue.freeBlocks` read the state after the animations that the film has played, so a film can say why a request waits before it plays the next step. An `admit` with no free slot or too few free blocks is an error. A line with more items than places draws the first ones and three dots. For a ring with a head and a tail that wrap, use `ringBuffer`.

A bounded queue with a head and a tail, such as a ring of io_uring or a virtqueue. Do not draw the slots and the two pointers by hand. `ringBuffer` keeps the pointers apart when both are at one slot, and `counts` shows that the index runs on while the slot wraps:

```ts
const sq = ringBuffer(8, { label: 'submission queue', counts: true, tailColor: 'blue', headColor: 'orange', tailFollows: 'publish' }).at(-430, 0)
s.play(sq.enter())
s.play(sq.push({ label: 'read', pending: true }))   // the producer writes, and the tail stays: the consumer sees nothing
s.play(sq.publish())                                // one store of the tail: the consumer can now see the entry
s.play(sq.pop())                                    // the consumer reads at the head
```

For the submission queue of io_uring, use `tailFollows: 'publish'`: the program stores the tail once for several entries, and a tail that counts up at each write teaches the opposite. The bounds of a ring hold the outside name at every slot, so place a ring by its bounds. `ring.length === 0` is an empty ring and `ring.length === ring.size` is a full ring: both pointers are then at one slot, and a text for the state is the work of the film. A `push()` on a full ring, a `pop()` on an empty ring, and a `pop()` of a pending entry are errors. For several pushes at once, pass them to `lagged`.

A model as a block diagram: the layers of a transformer, of a vision model, or of a residual network. Do not build it from boxes and connectors in each film. `layerStack` puts the layers on one stream, with the data flowing up, and it knows what each layer does to the stream. A block is on the stream. `{ branch: [...] }` is beside the stream, and an add puts its result back, which is a residual connection. `{ repeat: 12, layers: [...] }` is a frame for layers that repeat. `feed(values)` puts a vector at the foot of the stream, and `pass(block, values)` sends it through a layer: at a branch, a copy goes through the blocks, and the add puts on the stream what the branch adds. `light(block)` lights the block that the scene is about, `mark(blocks, 'frozen')` changes states, `replace(block, label)` swaps a block, and `open(block, closeUp)` joins a block to a close-up that the film placed beside the stack. A branch with `shown: false` has its place and arrives with `show(block)`, and `around: 'W'` puts a branch around a block on the stream, for LoRA beside a frozen weight. `digits: 1` writes the values in the cells, and a `shape` on a block changes the shape beside the vector. Play one `feed` or `pass` at a time. Give a branch about three seconds:

```ts
const model = s.add(layerStack([
    { label: 'embed', color: 'purple', shape: '(T, 768)' },
    { repeat: 12, layers: [
        { branch: [{ label: 'norm', id: 'norm 1' }, { label: 'attention', color: 'orange' }] },
        { branch: [{ label: 'norm', id: 'norm 2' }, { label: 'MLP', color: 'teal' }] },
    ] },
    { label: 'unembed', color: 'green', shape: '(T, 50257)' },
], { shape: '(T)', size: 26 }).at(-500, 0))
s.play(model.enter())
s.play(model.feed([0.6, -0.2, 0.1, 0.4]))
s.play(model.pass('embed', [0.3, 0.7, -0.5, 0.1]))
s.play(model.light('attention'), model.pass('attention', [0.5, 0.2, -0.1, 0.8]), { duration: 3 })
s.play(model.mark(['embed', 'attention'], 'frozen'))
```

The stack measures as its `width`, with the room of its shapes, so `place` and `fitted` work on it. `model.block('MLP')` is the node of a block for `beside` or a connector, and `model.foot` and `model.head` are the two ends of the stream. A label is never set smaller: a `width` with no room for a label is an error that gives the least width.

3D:

```ts
const view = s.add(scene3d({ phi: 1.1, theta: -0.6, unit: 130 }))
view.add(axes3d({ x: [-3, 3], y: [-3, 3], z: [-1, 2] }))
const hill = surface((x, y) => Math.sin(x) * Math.cos(y), { x: [-3, 3], y: [-3, 3], colors: ['blue', 'teal', 'yellow'] })
view.add(hill)
s.play(fadeIn(hill))
s.play(view.orbit({ theta: 1.4 }, { duration: 4 }))
```

A mark that rests on a surface, such as a path, a ball, or an arrow:

```ts
const height = (x: number, y: number) => 0.2 * (x * x + y * y)
const u = s.value(0)
const at = (t: number): [number, number, number] => [2 - 2 * t, 2 - 2 * t, height(2 - 2 * t, 2 - 2 * t) + 0.04]
view.add(surface(height, { x: [-3, 3], y: [-3, 3], mesh: 'ink', meshOpacity: 0.16 }))
const path = view.add(curve3d(at, 0, 1, { color: 'ink', onTop: true }))
path.set('trimTo', 0)
view.add(point3d(() => at(u.value), { color: 'yellow', halo: 1.3, onTop: true }))
s.play(u.to(1, { duration: 4 }), to(path, (n) => n.set('trimTo', 1), { duration: 4 }))
```

Faces, lines, and points sort by depth, so a mark that touches a surface can fall behind the faces under it. Lift the mark a little above the surface, and set `onTop: true`. Use `bias` in place of `onTop` when a ridge must still hide the mark. `mesh` draws the grid lines that make the shape of a smooth surface readable.

A logo or a photo:

```ts
import { readFileSync } from 'node:fs'

const png = readFileSync(new URL('./logo.png', import.meta.url)).toString('base64')
const logo = s.add(image(`data:image/png;base64,${png}`, { width: 420 }).opacity(0))
s.play(fade(logo, 1, { duration: 0.4 }))
```

`image` reads the size of a PNG, GIF, or JPEG data URL, so one of `width` and `height` is enough. `preview` runs in the browser and cannot read a file, so pass a URL there, with both `width` and `height`.

## Check codes

- `film.off_canvas`: a mark leaves the frame. Text that is clipped is an error. Other marks are warnings. A mark that spans the whole frame, such as a grid line, is not reported.
- `film.text_edge`: text is nearer to an edge of the frame than 2% of the shorter side, which is 22 px at 1080p. It is a warning, and only the moments at rest are checked. While the camera is zoomed, only pinned text is checked. `--text-margin <px>` sets the distance, and 0 turns the rule off.
- `film.text_crowded`: text has no room. It is nearer to a line, a shape, or an image than a part of its font size, a line touches its letters, it starts on a filled shape and leaves it, such as a label that is wider than its dot, or a shape in front of it covers a part of it. The message names the mark: its kind, the object that drew it, and its side of the text. The rule is off by default. Turn it on with `--text-gap 0.3` for a film of cards, boxes and captions, and judge its findings in a film of plots, where a curve may pass a label on purpose. It is a warning. The moments at rest are checked, and with `--motion` also a text and a mark that stay too near for one second while they move, or while other things move. A mark that passes a text for a moment is not reported: the same mark must be too near for one second. Move the text, make it smaller, or give the shape more padding. Inside a shape that holds it, such as a cell, a pill, or a `zone`, text needs half of the distance. A backing hides the part of a mark that is behind it, so make a backing larger than the text by the distance. A mark counts when its contrast with what a viewer sees behind it is 1.2 or more: the rule of a table in the `grid` color counts, and a `surface` panel with no border does not. The rule does not judge a distance that the library sets: a label that an object places beside its own marks, such as the numbers of `axes` or the title of a `card`, a line or an arrow of the film that passes a label of a plot, the end of a `connector`, a `callout`, or a `braceLabel` at its target, and a box from `surroundingBox` or a mark from `highlightSweep`. A label of an object is judged against the marks of every other object, as text of the film is: a legend that the film puts on the axis of a chart is reported. Text that the film places is judged, also in a `group`, in the figure of a `card`, and in a `zone`. A strike, which is a thin filled bar through the middle of the letters, is not reported. An underline, which is a thin level line just under the base line and not longer than the text, is not reported.
- `film.text_small`: text is under a size on the screen. The rule is off by default. Turn it on with `--text-size 26` for a lesson that people watch on a phone: the value is for a frame that is 1080 high. The size is the font size with the scale of the node and the zoom of the camera. The texts of one size are one finding, and the labels of one object are one finding that names the object. Many objects have labels under 26 px by default, such as the numbers of a chart (18 to 20 px), the label of a `connector` (12 px) and a `legend` (13 px): give each one a larger `labelSize` or `size`.
- `film.empty_space`: a rectangle of the frame stays empty for 4 seconds or more. The rule is off by default. Turn it on with `--empty-space 0.5`: the value is the largest part of the frame that may stay empty in one piece. With 0.5, a picture in the middle of the frame is never reported, and a picture that sits in one half or one corner is. Make the picture larger, or use the part for what the picture explains.
- `film.text_overlap`: two text blocks share pixels.
- `film.text_crossed`: a stroke passes through text. A strong stroke is an error. An opaque shape between the stroke and the text prevents this report, so give a label a backing when it must sit on a line.
- `film.missing_glyph`: no bundled font has a character, so it renders as an empty box. Replace the character, or set it with `tex`.
- `film.blank`: nothing is visible for 0.2 seconds or more. Only a motion scan reports it.
- `film.text_brief`: text leaves before a viewer can read it. A reader takes in 20 characters in one second of the text that is on screen, and a text needs half a second at least. It is a warning, and only a motion scan reports it. A label that changes in place, or rows that scroll through one area, are one finding. Text that is up from the first frame to the last, as in a still or a loop, is not reported. `--reading-speed <n>` sets the characters per second, and 0 turns the rule off. `--stepped` is for a deck, which waits at each chapter. `readingSeconds(text)` gives the time that a plain text needs.

The check looks at moments between animations, because objects may cross while moving. So it misses a crossfade where two sentences overlap, and a blank gap between two pictures. Add `--motion` to inspect every frame:

```bash
npx vizmatic check intro.ts --motion --content-top 200 --json
```

A finding that appears only while something moves is a warning, because the check cannot tell a collision from one picture that replaces another. It carries a `motion` field with the number of separate stretches and their total length, and `time` and `until` bound the longest stretch. Judge each one. `--content-top` is the canvas y where the content starts, so that a heading that stays up does not hide a blank. In code, use `checkFilm(film, { motion: true, contentTop: 200 })`. `samples` adds evenly spaced moments at rest, and `times` inspects exactly the times you pass.

## Mistakes to avoid

- **Late objects paint on top.** A morph target mounts when the morph starts, so it covers older objects. Give anything that must stay readable a higher `.zIndex()`.
- **A fade does not remove a value.** A `dynamic` drawing stays in the check and can show behind later objects. Return early from it when its visibility value is near zero.
- **Bend signs depend on direction.** With a positive `bend`, a left-to-right `arrow` bows down and a right-to-left `arrow` bows up.
- **Long animations overlap the next cue.** A check can report an error from an animation that is still running at the next moment. Shorten it, or leave more time.
- **Mesh surfaces cache their shape.** Set `animate: true` on a `parametricSurface` that changes with a value.
- **`trail3d` counts film seconds.** Its `from` and `to` are times on the timeline, and `curve3d` takes a parameter range. For a path that is known in advance, draw a `curve3d` and animate its `trimTo`.
- **Text under a filled shape still counts.** The viewer cannot see it, but the check can. Fade it out while the shape covers it. On a filled shape, draw text in `bg`.
