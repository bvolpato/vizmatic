# Vizmatic films

## Engine rules

- The stage is 1920 by 1080. (0, 0) is the center and y points down. `film({ aspect: '9:16' })` changes the shape.
- The build function runs once and may run again while fonts or math load. Keep it free of side effects and randomness that is not seeded.
- Use `font: 'text-serif'` for sentences, labels, and numbers. Use `font: 'serif'` only for short titles at a large size, because its fine strokes fade at phone size.
- `s.add(node)` puts a node on stage now. `s.play(...)` writes animation and moves time forward. `s.wait(seconds)` holds.
- Reveal verbs such as `write`, `draw`, and `fadeIn` also add the node, so `s.add` is optional before them.
- Setters such as `.at`, `.fill`, and `.scale` apply at the current time. On a node that is not on stage, they set its initial state.
- `s.play(a, b)` runs together. Pass `{ duration, ease }` last to set both. Inside one animation, use `par`, `seq`, and `lagged`.
- Node setters place the origin. `.moveTo([x, y])` moves the center of the bounds. `.nextTo(other, 'right', 24)` places by bounds, and `.alignTo(other, 'left')` lines up an edge.
- `morph(a, b)` hides `a` and leaves `b` on stage. Later code refers to `b`.
- Reparenting is not on the timeline. Do not wrap nodes that are already on stage in `group()`. Pass an array to the verb: `fadeOut([a, b])`.

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

`--audio narration.wav` adds a sound track. It is padded or trimmed to the film's length, so a film that ends early cuts off the voice. Hold to the end with `s.wait(Math.max(0, voiceLength - s.time))`. `s.caption(text, seconds)` adds a caption and draws nothing into the picture. `references/lessons.md` covers narrated films.

An MP4 carries the film's title, its chapters as markers on the player's timeline, and its captions as a track that the viewer can switch on. The same captions are also written as a WebVTT file beside the video. No second pass with FFmpeg is needed.

For a film that follows a recorded voice, use `narration(s, timing)`. It places each scene from the measured length of the speech, and `scene.on('a spoken phrase', build)` runs `build` when the voice reaches that phrase. A phrase that the voice does not say stops the build. It also adds the captions and one chapter for each titled scene.

## Worked films

`examples/films/` holds finished films with full source, and each one compiles and passes `vizmatic check`. The package includes them, so read them from `node_modules/vizmatic/examples/films/`. Read one before you write a similar film.

| Film | What to learn from it |
|---|---|
| `attention.ts` | Compute every number on screen from small real inputs. |
| `cache-miss.ts` | Run a small queueing model, and draw the system from its results. |
| `gradient-descent.ts` | Drive motion from real iterates, and compare two runs. |
| `linear-maps.ts` | Bend a grid with `applyMatrix`, and follow what it does to area. |
| `complex-maps.ts` | Move a grid through a family of maps, and direct the camera. |
| `fourier-epicycles.ts` | Compute motion and readouts from a real transform. |
| `lorenz.ts` | Integrate a system, and read values from the result. |
| `central-limit.ts` | Use seeded randomness, so that every render shows the same counts. |
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

A small picture of a kind of thing, for a card or a legend. Do not draw these by hand. `PICTOGRAMS` lists the names, which include `series`, `forecast`, `logs`, `traces`, `graph`, `dag`, `tree`, `database`, `service`, `vm`, `process`, `kernel`, `memory`, `disk`, `snapshot`, `core`, `drive`, `thread`, `interrupt`, `syscall`, `ring`, `page`, `model`, `tokens`, `vector`, `event`, `alert`, `check`, and `cross`:

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

A grid of cells that change state: pages of memory, blocks of a disk, the hosts of a fleet. Do not draw the cells by hand. `stateGrid` keeps the state of each cell, sweeps a change across the cells, and counts them. `PAGE_STATES` has the states of memory pages, and `states` takes your own:

```ts
const pages = s.add(stateGrid({ columns: 16, rows: 8, cell: 56, initial: 'absent' }).at(0, -40))
s.add(pages.legend(['absent', 'present', 'dirty'], { size: 32 }).at(pages.left[0], 300))
s.play(pages.change((index) => index < 96, 'present'), { duration: 1.6 })
s.play(pages.change([3, 4, 5, 40], 'dirty'))
const count = text(`${pages.count('dirty')} dirty pages`, { font: 'text-serif', size: 40 })
```

A box with a title, a figure, and a caption. Do not place these three by hand. `card` keeps the margins, centers the figure, and scales it down when it is too large. Give the cards of a row one `width`, one `height`, and one `captionLines` (the lines of the longest caption):

```ts
const row = { width: 420, height: 400, captionLines: 2 }
const logs = card({ title: 'Logs', figure: pictogram('logs', { size: 140 }), caption: 'one line per event', color: 'yellow', ...row })
const traces = card({ title: 'Traces', figure: pictogram('traces', { size: 140 }), caption: 'the path of one request through the services', color: 'purple', ...row })
s.add(group(logs, traces).arrange('right', 32).moveTo([0, 0]))
```

Values that differ by more than about a hundred times, such as 100 ns beside 10 ms. On a linear axis, all but the largest sit at zero. Give `dotChart` a log axis, and say on screen that the axis is logarithmic. The `xLabel` is the place:

```ts
const time = (ns: number) => (ns >= 1e6 ? `${ns / 1e6} ms` : ns >= 1e3 ? `${ns / 1e3} µs` : `${ns} ns`)
const chart = dotChart([{ label: 'system call', value: 100 }, { label: 'read from a spinning disk', value: 10_000_000 }], { scale: 'log', format: time, xLabel: 'time, logarithmic' })
s.play(chart.enter())

A word split into named fields: a virtual address and its table indexes, the flags of a register, the layout of a structure. Do not build it from boxes and texts in each film. `bitField` gives each box a width for its bits, numbers the bits, and keeps every text inside its box. `minWidth` or `scale: 'even'` gives a field of one bit room for a name, and `unused: true` marks reserved bits. For the layout of a structure, `numbers: 'offsets'` counts its bytes, and `wrap: 16` fills rows of 16 bytes. A field with a `value` shows it in its box, and `word.setValue('fd', '3')` changes it in place. `word.field('table')` is the node of one field, and `word.p('table')` is the point where a line from it starts:

```ts
const word = s.add(bitField([
    { bits: 10, label: 'directory', color: 'blue' },
    { bits: 10, label: 'table', color: 'orange' },
    { bits: 12, label: 'offset', color: 'purple' },
], { width: 1400 }).at(0, -200))
s.add(connector(word.toWorld(...word.p('table')), pageTable, { color: 'orange' }))
```

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
