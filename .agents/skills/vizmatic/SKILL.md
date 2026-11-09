---
name: vizmatic
description: Create and render theme-aware diagrams, charts, docs figures, animated explainer films, narrated lesson videos, GIFs, and MP4 videos from code. Use when a request needs a mathematical or technical animation, a teaching video, an architecture diagram, a process flow, an evaluation dashboard, a presentation, or any figure for documentation.
---

# Vizmatic

Vizmatic makes two kinds of output. Choose first.

- **Film**: anything that moves to explain something. Write TypeScript with `vizmatic/stage`. Vector geometry, TeX, morphs, 3D, frame-exact MP4.
- **Figure**: a still for a document or a slide. Write TSX with typed components from `vizmatic`. Dense by default, dark and light from one source.

Use a TSX animation (`createAnimation`) only to animate a figure that already exists. Use `createTeachingCanvas(painter)` only when a project already has a checked canvas host. For new motion, write a film.

## Setup

Confirm Node.js 20 or newer, then install or reuse the package. MP4 and WebM also need FFmpeg with `libx264` and `libvpx-vp9`.

```bash
npm install vizmatic
```

For pnpm 11, allow esbuild's install script with `allowBuilds: { esbuild: true }` in the root `pnpm-workspace.yaml`. The CLI uses esbuild to compile films and frames.

## Film workflow

1. Start from `assets/starter-film.ts`, or run `npx vizmatic new intro --template explainer`. Templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`. The `narrated` template writes a folder for a film that follows a recorded voice.
2. Read `references/films.md` for the engine rules and patterns. Run `npx vizmatic objects` for the object catalog and `npx vizmatic looks` for the looks.
3. Check it, and fix every error. Each finding has times, a `box` in canvas pixels, and a `stage` center in authoring coordinates.
   ```bash
   npx vizmatic check intro.ts --json
   ```
4. Look at it. You cannot watch a video, so render stills at the end of each beat and open them.
   ```bash
   npx vizmatic film intro.ts --frame 2,5.5,9,12 --width 1280 --out stills
   ```
   To read a whole film in a few images, add `--sheet`. It joins the stills into contact sheets, with the time under each tile. `--every 5` samples the film every 5 seconds in place of a list of times.
   ```bash
   npx vizmatic film intro.ts --every 5 --sheet --out stills
   ```
5. Export when the stills are right.
   ```bash
   npx vizmatic film intro.ts --out dist/films --quality high
   ```

`--format mp4,webm,gif,png,svg` picks formats. `--look midnight,paper` renders each look. `--quality draft` is fast. `--range 12:18` renders part of the timeline. `--poster` adds a poster frame. `--audio narration.wav` adds sound, padded or trimmed to the film's length. Add `--json` for a machine-readable report. `film-manifest.json` lists all outputs. MP4 output is H.264 with settings that QuickTime can play. An MP4 carries the film's chapters and captions, and `s.caption` also writes a WebVTT file beside the video.

For a person, `npx vizmatic preview intro.ts` gives a live player with a timeline. [Studio](https://bvolpato.github.io/vizmatic/studio.html) is a visual film editor that runs in the browser, with no install. It has a canvas, an inspector, and per-object tracks, and it writes film source. Offer it when someone wants to edit by hand. An agent should write the source instead.

### Timing traps

- `s.play(a, b, { duration })` stretches both animations to fill the duration. A `duration` inside `a` or `b` has no effect. For different lengths, leave it off `s.play`, set it on each animation, and use `delay` for an offset. Inside a `s.play` that has a duration, `seq(fadeOut(a), fadeIn(b))` makes one text leave before the next arrives.
- `vizmatic check` inspects moments of rest. A crossfade where two sentences overlap and a blank gap between two pictures both pass it. Before you export, run `npx vizmatic check intro.ts --motion --json`, which inspects every frame. It reports what appears only in motion as warnings, so judge each one. `references/lessons.md` explains the report. An older package rejects `--motion` as an unknown option, so update the package.

### Lessons and narrated films

When a film must teach, read `references/lessons.md` before you write the script. For a film that follows a recorded voice, start with `npx vizmatic new <name> --template narrated`, and build it with one command: `npx vizmatic narrated build <folder> --draft` for a draft, and without `--draft` for the delivered movie. It makes the voice on this machine, the sound mix, the layout check and the movie, and runs only the steps that have work to do. `narrated({ title, timing, scenes })` draws the title card, opens and ends each scene, and gives each scene a clock that places each change on a spoken phrase. It stops the build if the voice does not say the phrase. The [narrated films guide](https://bvolpato.github.io/vizmatic/docs/narrated-films.html) has the folder, the build, the checks, and the review. Compute every number, check it with `assertEqual`, and keep the voice and the screen in agreement. Keep every title true for as long as it is visible. Change pictures without a collision or a blank, and scan every frame. Accuracy comes before brevity. Do not cut content that teaches to reach a target length.

The package computes some mechanisms for you, with helpers such as `weightedVectorState` and `tokenHistoryState`. `references/lessons.md` lists them, the limits of each, and how to use them in a film or a canvas host.

Report what you could not verify. You cannot watch a video, so a person must watch a lesson at full speed with sound before it is published.

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
- "Make a lesson that teaches this topic" -> narrated film. Follow `references/lessons.md`.
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
- `references/films.md`: engine rules, film patterns, check codes, and common mistakes.
- `references/lessons.md`: how to plan, narrate, scan, and deliver a film that teaches.
- `references/patterns.md`: how to choose figure components.
- `examples/films/` in the package: finished films with full source. `references/films.md` says what each one shows.
