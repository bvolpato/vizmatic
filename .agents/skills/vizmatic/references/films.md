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

A signal along an edge. `arrow` keeps its shaft in `edge.data.shaft`:

```ts
const edge = s.add(arrow([-300, 0], [300, 0], { stroke: 'dim', width: 2 }))
s.play(pulse(edge.data['shaft'] as Node, { color: 'yellow' }))
```

A dense system box with live numbers: see `infoBox`, `connector`, and `legend` in `vizmatic objects`, and the `architecture` template.

3D:

```ts
const view = s.add(scene3d({ phi: 1.1, theta: -0.6, unit: 130 }))
view.add(axes3d({ x: [-3, 3], y: [-3, 3], z: [-1, 2] }))
const hill = surface((x, y) => Math.sin(x) * Math.cos(y), { x: [-3, 3], y: [-3, 3], colors: ['blue', 'teal', 'yellow'] })
view.add(hill)
s.play(fadeIn(hill))
s.play(view.orbit({ theta: 1.4 }, { duration: 4 }))
```

## Check codes

- `film.off_canvas`: a mark leaves the frame. Text that is clipped is an error. Other marks are warnings. A mark that spans the whole frame, such as a grid line, is not reported.
- `film.text_overlap`: two text blocks share pixels at rest.
- `film.text_crossed`: a stroke passes through text. A strong stroke is an error. An opaque shape between the stroke and the text prevents this report, so give a label a backing when it must sit on a line.
- `film.missing_glyph`: no bundled font has a character, so it renders as an empty box. Replace the character, or set it with `tex`.

The check looks at moments between animations, because objects may cross while moving. Pass `samples` to `checkFilm` to add more moments.
