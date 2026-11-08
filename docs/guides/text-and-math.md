---
title: Text and math
nav: Text and math
section: Motion
order: 2
description: Text and equations are real vector glyphs. Handwrite them, stagger them, or morph one equation into another, term by term.
---

## Text

`text(content, options)` lays out a block of glyphs. The node's position is the middle of the block.

```film paired label="A serif headline and a smaller sans line write themselves"
import { film, text, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const head = s.add(text('Every glyph is a path.', { font: 'text-serif', size: 170 }).at(0, -80))
    const body = s.add(text('So every letter can move.', { size: 62, color: 'dim' }).at(0, 120))
    s.play(write(head), { duration: 1.6 })
    s.play(write(body), { duration: 1 })
    s.wait(0.8)
})
```

| Option | Meaning |
|---|---|
| `size` | Font size in stage units. |
| `font` | `'sans'` (Inter), `'serif'` (Instrument Serif), `'text-serif'` (Source Serif 4), `'mono'` (JetBrains Mono), or `'noto'`. |
| `weight` | `400`, `600`, or `700` where the family has that weight. |
| `italic` | Use the italic of the family. |
| `color` | A look token, CSS color, or gradient. |
| `align` | `'left'`, `'center'`, or `'right'` inside the block. |
| `anchor` | The point that `.at(x, y)` places: `'left'`, `'center'` (the default), or `'right'`. |
| `maxWidth` | Wrap to this width. |
| `leading` | Line height as a multiple of size. |
| `tracking` | Extra letter space as a fraction of size. |

`.at(x, y)` places the middle of a text block. For a label that starts or ends at a known x, such as a row of a table or the name of an axis, set `anchor`. The y of the point does not depend on the letters, so labels with different anchors on one `y` share a baseline.

```ts
import { text } from 'vizmatic/stage'

const metric = text('latency', { size: 32, anchor: 'right' }).at(-20, 0)   // ends at x = -20
const value = text('5.0 ms', { size: 32, anchor: 'left' }).at(20, 0)       // starts at x = 20
```

Use `'text-serif'` for sentences, labels, and numbers. Its strokes stay visible when a film plays at phone size, and it keeps `1` and `l`, and `O` and `0`, easy to tell apart. It also sits well next to TeX. Use `'serif'` for short titles at a large size. It is narrow and has fine strokes, and it has no Greek letters or math symbols.

If a font does not have a character, the engine draws that character with the next bundled font. `'serif'` tries Source Serif 4 first. Then every family tries Noto Sans and Noto Sans Math. If no bundled font has the character, the engine draws an empty box and `vizmatic check` reports `film.missing_glyph`.

Glyphs are in `node.chars`. `node.find('word')` returns the glyphs of a fragment, so you can color or animate one word.

```film paired label="One word turns yellow inside a sentence"
import { film, recolor, text } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const line = s.add(text('Look at this word.', { font: 'text-serif', size: 170 }))
    s.wait(0.5)
    s.play(...line.find('this').map((glyph) => recolor(glyph, 'yellow')))
    s.wait(1)
})
```

## Equations

`tex(source, options)` typesets TeX with a bundled engine, so you do not install LaTeX. The output is vector glyphs in the Computer Modern style.

```film paired label="The quadratic formula handwrites itself"
import { film, tex, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const eq = s.add(tex('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', { size: 130 }))
    s.play(write(eq, { duration: 2.4 }))
    s.wait(1)
})
```

The math engine is a separate download of about 1.6 MB in the browser. It loads only when a film first calls `tex`.

## Selecting terms

`eq.part('b^2')` returns the glyphs of a fragment. `eq.parts('x')` returns every occurrence. Use them to color a term or point at it.

```film paired label="Two terms of an equation change color"
import { film, recolor, tex } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const eq = s.add(tex('a^2 + b^2 = c^2', { size: 170 }))
    s.wait(0.4)
    s.play(...eq.part('a^2').map((glyph) => recolor(glyph, 'teal')))
    s.play(...eq.part('b^2').map((glyph) => recolor(glyph, 'orange')))
    s.wait(0.8)
})
```

## Derivations

`morphMatching` matches glyphs by what they are. A line of a derivation can grow out of the line before it.

```film paired label="An equation is solved over three morphs"
import { film, morphMatching, tex, write } from 'vizmatic/stage'

export default film({ fps: 30 }, (s) => {
    const step = (source: string) => tex(source, { size: 170 })
    const a = s.add(step('2x + 3 = 11'))
    const b = step('2x = 11 - 3')
    const c = step('2x = 8')
    const d = step('x = 4')
    s.play(write(a))
    s.play(morphMatching(a, b))
    s.play(morphMatching(b, c))
    s.play(morphMatching(c, d))
    s.wait(0.8)
})
```

## Readouts

`decimal(read, options)` draws a number that follows a function of the timeline. Use the `mono` font so digits do not jump.
