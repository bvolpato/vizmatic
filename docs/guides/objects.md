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
