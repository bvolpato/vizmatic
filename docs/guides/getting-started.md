---
title: Getting started
nav: Getting started
slug: index
section: Start
order: 1
description: Write a film as a TypeScript function, watch it in your browser, and export it to MP4. This takes about two minutes.
---

## Install

Vizmatic needs Node.js 20 or newer. MP4 export also needs [FFmpeg](https://ffmpeg.org/download.html) with the `libx264` encoder.

```bash
npm install vizmatic
```

## Write a film

A film is a function. Create `my-film.ts` with this code. The player below runs the same code, live in this page.

```film open label="Axes draw on, a parabola traces across them, and its equation writes itself"
import { axes, draw, fadeIn, film, tex, write } from 'vizmatic/stage'

export default film({ title: 'My first film' }, (s) => {
    const graph = s.add(axes({ x: [-3, 3], y: [-1, 9], grid: true }).at(-240, 40))
    s.play(draw(graph.grid, { lag: 0.02 }), draw(graph.lines), fadeIn(graph.numbers))

    const parabola = graph.plot((x) => x * x, { stroke: 'blue', width: 5 })
    s.play(draw(parabola))

    const equation = s.add(tex('y = x^2', { size: 72 }).at(600, -200))
    s.play(write(equation))
    s.wait(1)
})
```

The `s` argument is the stage. Each `s.play(...)` writes animation onto a timeline and moves forward. Each `s.wait(...)` holds the picture.

## Preview it

Run a live preview. The page reloads when you save the file.

```bash
npx vizmatic preview my-film.ts
```

## Export it

Export writes an MP4 with worker threads. The result is frame-exact, so identical input gives identical frames.

```bash
npx vizmatic film my-film.ts --out ./out --quality high
```

Use `--look paper` for a light version of the same film. Colors such as `'blue'` are names from the current look, so a film changes look without any edits.

## Where to go next

- [Core concepts](concepts.md) explains the stage, the timeline, and why frames are pure.
- [Animations](animations.md) shows every animation with a small live demo.
- [Objects](objects.md) lists the ready-made axes, planes, charts, graphs, and matrices.
- The [Studio](../studio.html) lets you build a film in the browser.
