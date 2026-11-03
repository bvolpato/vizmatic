# Vizmatic agent prompt

Use Vizmatic to explain things visually from code. It makes two kinds of output:

- A **film** is motion. Write a TypeScript function with `vizmatic/stage`. It plays live in a browser and exports to MP4, WebM, GIF, PNG, and SVG.
- A **figure** is a still. Write TSX with typed components from `vizmatic`. It renders to PNG and SVG in dark and light themes.

Vizmatic requires Node.js 20 or newer. MP4 and WebM also need FFmpeg.

```bash
npm install vizmatic
```

## Films

Start from a template, or write the function yourself. Templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`.

```bash
npx vizmatic new intro --template explainer
```

```ts
import { axes, draw, dynamic, dot, fadeIn, film, line, tex, write } from 'vizmatic/stage'

export default film({ title: 'A limit you can see' }, (s) => {
    s.chapter('The curve')
    const plot = s.add(axes({ x: [-1, 4], y: [-1, 9], grid: true, width: 1080, height: 660 }).at(-340, 60))
    s.play(draw(plot.grid, { lag: 0.02 }), draw(plot.lines), fadeIn(plot.numbers))
    s.play(draw(plot.plot((x) => x * x, { stroke: 'blue', width: 5 })))

    s.chapter('The secant')
    const h = s.value(2)
    const secant = s.add(dynamic(() => {
        const slope = 2 + h.value
        return [
            line(plot.world(0.2, 1 + slope * -0.8), plot.world(3.2, 1 + slope * 2.2), { stroke: 'yellow', width: 3.5 }),
            dot(9, 'yellow').at(plot.world(1 + h.value, (1 + h.value) ** 2)),
        ]
    }))
    s.play(fadeIn(secant))
    s.play(write(s.add(tex('m = 2 + h', { size: 64 }).at(600, -120))))
    s.play(h.to(0.02, { duration: 4 }))
    s.wait(1.5)
})
```

Rules of the engine:

- The stage is 1920 by 1080. (0, 0) is the center and y points down. Plots convert with `plot.world(x, y)`.
- The build function runs once and may run again while assets load. Keep it free of side effects.
- `s.play(...)` writes animation and moves time forward. `s.wait(seconds)` holds. `s.at(time, build)` authors at another time.
- A `dynamic(() => ...)` drawing rebuilds on every frame. Read `value.value` inside it to drive anything.
- `morph(a, b)` leaves `b` on stage and `a` hidden. Later code refers to `b`.
- Colors are look tokens such as `'blue'`, `'yellow'`, `'ink'`, and `'dim'`, so a film renders in every look.
- Run `vizmatic objects` and `vizmatic looks` to see what the installed version offers.

### Check, look, and export

An agent cannot watch a video, so judge a film from the check and from stills.

```bash
npx vizmatic check intro.ts --json
npx vizmatic film intro.ts --frame 3,6.5,12 --width 1280 --out stills
npx vizmatic film intro.ts --out dist/films --look midnight,paper --quality high
```

`vizmatic check` samples the moments where the film comes to rest. It reports `film.off_canvas`, `film.text_overlap`, `film.text_crossed`, and `film.missing_glyph`, each with times, a `box` in canvas pixels, and a `stage` center in authoring coordinates. Fix every error, then open the stills and look at them. `vizmatic preview intro.ts` opens a live player with a timeline for a person to review.

Motion guidance:

- Use one idea per beat. Hold for a second after each reveal, so a viewer can read it.
- Move the thing being explained. Avoid decorative motion.
- Give color a meaning and keep it. A quantity keeps its color from its first appearance to its last.
- Use chapters. They mark the player's timeline and are the steps of a presentation.

## Figures

Create `frame.tsx`. `Scene` title and subtitle are optional.

```tsx
<Scene title="Checkout, read path">
  <Flow
    stages={[
      { title: "Gateway", subtitle: "Envoy, p99 9 ms", tone: "blue" },
      { title: "Cart", subtitle: "Go, 840 rps", tone: "purple" },
      { title: "Orders DB", subtitle: "Postgres, primary + 3", tone: "green" },
    ]}
  />
</Scene>
```

```bash
npx vizmatic check ./frame.tsx --theme dark,light --json
npx vizmatic ./frame.tsx --out ./figures --theme dark,light --format both
```

Fix all errors before the final render. Warnings report low contrast, small text, overlapping labels, uneven panel whitespace, connector congestion, and asset fallbacks.

Figures default to the `dense` density, like a figure in an engineering paper. Fill the space with useful detail: runtimes, rates, schemas, and limits. Do not spread three boxes across a slide. Use `density="presentation"` on a `Scene`, or `density` in a render option, only for a room. The densities are `dense`, `compact`, `comfortable`, `presentation`, or a number.

Choose by meaning: `GraphDiagram` for systems, `SequenceDiagram` for interactions, `DataflowDiagram` for lineage, `DeploymentDiagram` for placement and trust, `TransformerTopology` for models, and `LineChart`, `BarChart`, `DataTable`, or `Heatmap` for data. Omit `width` and `height` to auto-grow from 960 by 540.

PNG and SVG output is alpha-transparent by default. Add `--background theme` or `background={c.bg}` for an opaque canvas. Use `preset = "engineering";` with `--theme light` for flat article figures.

Use a full module when a frame needs helper code or data:

```tsx
import { Flow, Scene, getThemeColors, type ThemeMode } from "vizmatic"

export const width = 1040
export const height = 560

export function create(theme: ThemeMode = "dark") {
  const c = getThemeColors(theme)
  return <Scene c={c} title="Runtime path"><Flow c={c} stages={[{ title: "Input", tone: "blue" }, { title: "Check", tone: "purple" }]} /></Scene>
}
```

## Reference

- [CLI](https://bvolpato.github.io/vizmatic/docs/cli.html) and [Exporting](https://bvolpato.github.io/vizmatic/docs/exporting.html): every flag.
- [Animations](https://bvolpato.github.io/vizmatic/docs/animations.html), [Objects](https://bvolpato.github.io/vizmatic/docs/objects.html), [Camera](https://bvolpato.github.io/vizmatic/docs/camera.html), and [3D](https://bvolpato.github.io/vizmatic/docs/three-d.html): the film API.
- [Figure recipes](https://bvolpato.github.io/vizmatic/docs/figure-recipes.html) and [Figures reference](https://bvolpato.github.io/vizmatic/docs/figures.html): component props and complete frames.
- [Science guide](https://github.com/bvolpato/vizmatic/blob/main/SCIENCE.md): accurate diagrams for math, physics, chemistry, and machine learning.
- [`llms-full.txt`](https://bvolpato.github.io/vizmatic/llms-full.txt): this prompt, all guides, and the component catalog.

## Final response

After creating a visual, report:

- files created or changed
- the exact render command used
- output paths
- which looks or themes rendered
- whether `vizmatic check` passed
- any overflow or layout fixes made
