---
name: vizmatic
description: Create and render theme-aware diagrams, charts, docs figures, animated explainer films, GIFs, and MP4 videos from code. Use when a request needs a mathematical or technical animation, an architecture diagram, a process flow, an evaluation dashboard, a presentation, or any figure for documentation.
---

# Vizmatic

Vizmatic makes two kinds of output. Choose first.

- **Film**: anything that moves to explain something. Write TypeScript with `vizmatic/stage`. Vector geometry, TeX, morphs, 3D, frame-exact MP4.
- **Figure**: a still for a document or a slide. Write TSX with typed components from `vizmatic`. Dense by default, dark and light from one source.

Use a TSX animation (`createAnimation`) only to animate a figure that already exists. For new motion, write a film.

## Setup

Confirm Node.js 20 or newer, then install or reuse the package. MP4 and WebM also need FFmpeg with `libx264` and `libvpx-vp9`.

```bash
npm install vizmatic
```

## Film workflow

1. Start from `assets/starter-film.ts`, or run `npx vizmatic new intro --template explainer`. Templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`.
2. Read `references/films.md` for the engine rules and patterns. Run `npx vizmatic objects` for the object catalog and `npx vizmatic looks` for the looks.
3. Check it, and fix every error. Each finding has times, a `box` in canvas pixels, and a `stage` center in authoring coordinates.
   ```bash
   npx vizmatic check intro.ts --json
   ```
4. Look at it. You cannot watch a video, so render stills at the end of each beat and open them.
   ```bash
   npx vizmatic film intro.ts --frame 2,5.5,9,12 --width 1280 --out stills
   ```
5. Export when the stills are right.
   ```bash
   npx vizmatic film intro.ts --out dist/films --quality high
   ```

`--format mp4,webm,gif,png,svg` picks formats. `--look midnight,paper` renders each look. `--quality draft` is fast. `--range 12:18` renders part of the timeline. `--poster` adds a poster frame. Add `--json` for a machine-readable report. `film-manifest.json` lists all outputs. `npx vizmatic preview intro.ts` gives a person a live player with a timeline.

## Judge your own output

The check finds defects. It does not find weak work. For each still, ask:

- Can a reader get the point of this frame in three seconds?
- Is the eye drawn to the thing being explained? Is one color doing one job?
- Is there a clipped label, a line through text, or an arrow that misses its target?
- Is the space used well? Fill a figure with useful detail, or make the one idea large. Avoid a few small boxes in a large empty frame.
- Does text read at the output size? On a 1920 stage, keep labels at 18 or more, unless the film is meant to be paused and studied.

If the answer to any of these is wrong, change the film and look again. Report the stills you checked.

## Figure workflow

1. Start with a bare `.tsx` frame or `assets/starter-frame.tsx`. Omit `width` and `height` while exploring. Output starts at 960x540 and grows to fit. Read `references/patterns.md` for how to choose components.
2. Check both themes, and fix reported errors.
   ```bash
   npx vizmatic check ./frames/diagram.tsx --theme dark,light --json
   ```
3. Render.
   ```bash
   npx vizmatic ./frames/diagram.tsx --out ./public/vizmatic --theme dark,light --format both
   ```
4. Open the PNG, and fix clipping, overlap, low contrast, and uneven spacing. When an asset appears on a page, verify that page too.

PNG and SVG output is transparent by default. Add `--background theme` for an opaque canvas.

### Density

Figures default to `dense`: 10 to 12 pixel small type, hairlines, and tight gutters. Pack in useful information such as runtimes, rates, schemas, and limits. A figure with three large boxes reads like a slide, so add what a reader would need to act on it.

Change the density only for the destination: `density="presentation"` on a `Scene`, or `density` in a render option, for a room. The densities are `dense`, `compact`, `comfortable`, `presentation`, or a number such as `1.25`.

## Design rules

- Give color a meaning and keep it. Use the look tokens (`blue`, `teal`, `yellow`, `ink`, `dim`) in films, and semantic tones in figures, so every theme works.
- Move the thing being explained. Hold after each reveal. Avoid decorative motion and logo reveals.
- Use real data and exact labels. Remove marketing filler.
- Use `preset = "engineering";` with `--theme light` for flat article figures.
- Return the generated paths, the exact command, and the result of the check.

## Common requests

- "Explain this math or algorithm" -> film with `axes`, `plane`, `tex`, and `morphMatching`. Drive motion with `s.value` and `dynamic`.
- "Animate this system or request path" -> film with `infoBox`, `connector`, and `pulse`, or the `architecture` template.
- "Make a talk or deck" -> film with one `s.chapter` per step, or the `deck` template. Present it with `<vz-film stepped>`.
- "Create an architecture diagram" -> figure with `GraphDiagram`, nested groups, technical icons, and labeled relationship kinds.
- "Show request interactions" -> figure with `SequenceDiagram`, messages, activations, and fragments.
- "Show data provenance" -> figure with `DataflowDiagram`, schemas, and batch or stream edges.
- "Show where services run" -> figure with `DeploymentDiagram`, boundaries, ports, and trust direction.
- "Turn this eval data into a figure" -> figure with `DataTable`, `LineChart`, and `BarChart`.
- "Compare score and cost" -> figure with `ParetoChart`, with a logarithmic cost axis when needed.
- "Add a docs visual" -> put output under the repository's docs or public path and verify the page.

## Starting points

- `assets/starter-film.ts`: a film with a graph, a moving value, and an equation.
- `assets/starter-frame.tsx`: a static figure.
- `assets/animated-frame.tsx`: a TSX animation for a GIF.
- `references/films.md`: engine rules and film patterns.
- `references/patterns.md`: how to choose figure components.
