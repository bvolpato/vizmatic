---
name: vizmatic
description: Create and render theme-aware diagrams, dense TSX figures, explainer films, narrated lessons, decks, GIFs, and MP4 videos from code. Use for technical or math animations, teaching videos, architecture diagrams, charts, and docs figures.
---

# Vizmatic

Choose the output surface before writing code:

- **Film** (`vizmatic/stage`): anything that moves to explain a mechanism, proof, system trace, or talk. Real Bezier geometry, TeX, morphs, 3D, domain objects, live `<vz-film>` player, and frame-exact MP4, WebM, GIF, PNG, or SVG.
- **Figure** (`vizmatic` TSX): a dense still for documentation, an engineering paper, or a slide. Renders dark and light PNG and SVG from one source.

Use `createAnimation` (`vizmatic gif` or `vizmatic video`) only to animate an existing TSX figure. Use `createTeachingCanvas(painter)` only when a repository already provides a checked canvas host. Use `vizmatic-scene` (`vizmatic/scene-runtime`) only to evaluate untrusted bare TSX inside an offline QuickJS sandbox. For any new motion, write a film.

## Setup

Reuse an existing CLI or project dependency first (`npx --no-install vizmatic --help` or `command -v vizmatic`). Ask before adding dependencies to an existing repository or installing globally.

- **Runtime**: Node.js 20 or newer.
- **Video and audio**: FFmpeg with `libx264`, `libvpx-vp9`, and `aac` for MP4, WebM, and audio muxing.
- **Local speech and sound**: `uv` on `PATH` for `vizmatic narrated` (local Kokoro TTS and Whisper transcription) and `vizmatic sounds`.
- **pnpm 11**: allow esbuild's install script in the root `pnpm-workspace.yaml` with `allowBuilds: { esbuild: true }` so the CLI can compile films and frames.

```bash
npm install vizmatic
```

## Film workflow

1. Start from `assets/starter-film.ts`, or scaffold with `npx vizmatic new intro --template explainer`. Templates are `explainer`, `equation`, `architecture`, `chart`, `deck`, and `narrated` (writes a folder for a voice-driven lesson).
2. Read `references/films.md` for engine rules, relational layout, and domain objects. Lay out every scene with `sceneKit`, `sceneArea`, `row`, `column`, `grid`, `place`, `beside`, `between`, `fitted`, and `boxOf` before typing coordinates; use raw coordinates only for data-driven marks. Run `npx vizmatic objects` and `npx vizmatic looks` to inspect the installed catalog and looks (`midnight`, `paper`, `blueprint`, `chalk`, `neon`).
3. Check static and motion frames, and fix reported errors. Each finding includes timestamps, `box` in canvas pixels, and `stage` center in authoring coordinates.
   ```bash
   npx vizmatic check intro.ts --json
   npx vizmatic check intro.ts --motion --text-gap 0.3 --text-size 26 --empty-space 0.5 --json
   ```
   `--motion` scans every frame for crossfade collisions (`film.text_overlap`), blank gaps (`film.blank`), and flashes too short to read (`film.text_brief`). Pass `--content-top 200` when a pinned heading stays visible, `--stepped` for chapter decks, and `--look midnight,paper` to verify multiple looks.
4. Inspect rendered stills and contact sheets visually before full video encoding:
   ```bash
   npx vizmatic film intro.ts --frame 2,5.5,9,12 --width 1280 --out stills
   npx vizmatic film intro.ts --every 4 --sheet --out stills
   ```
   `--sheet` joins sampled frames into timestamped contact sheets (`--columns <n>` sets grid width). Use full-size stills for layout review and sheets for pacing.
5. Export when layout and pacing pass inspection:
   ```bash
   npx vizmatic film intro.ts --out dist/films --look midnight,paper --quality high --poster
   ```
   Useful flags: `--format mp4,webm,gif,png,svg`, `--quality draft|standard|high|master`, `--dither|--no-dither`, `--range 12:18`, `--audio narration.wav`, `--workers <n>`, and `--json`. `film-manifest.json` lists every generated artifact. MP4 output uses QuickTime-compatible H.264, embeds chapters and toggleable captions, and writes a sidecar `.vtt` file when captions exist.

For interactive authoring, `npx vizmatic preview intro.ts` opens a live timeline player that reloads on save, and [Studio](https://bvolpato.github.io/vizmatic/studio.html) provides a browser editor with object tracks that writes film source. Agents should edit source directly.

### Engine and timing traps

- **Build nodes inside `film(..., (s) => { ... })`**: bundled fonts and TeX load while the callback runs, so calling `text()` or `tex()` at module top level fails on load.
- **Outer `duration` stretches every child**: `s.play(a, b, { duration })` stretches both `a` and `b` to fill `duration` and ignores inner `duration` or `retime`. For asymmetric transitions, omit outer `duration` and use `delay`: `s.play(fadeOut(oldText, { duration: 0.15 }), delay(fadeIn(newText, { duration: 0.25 }), 0.1))`. Inside a timed `s.play`, use `seq(fadeOut(a), fadeIn(b))`.
- **`morph(a, b)` replaces `a` with `b`**: after a morph, `a` is hidden and `b` stays on stage. Direct later animations at `b`.
- **Never reparent mounted nodes**: do not wrap nodes already on stage in `group()`. Pass arrays to verbs (`fadeOut([a, b])`) and use `spotlight(target, { keep })` instead of manual dimming lists.
- **Guard hidden `dynamic` nodes**: fading a parent or value does not remove a `dynamic(() => ...)` callback from `check`. Return `[]` when its visibility value is near zero.
- **Verify math with `assertEqual`**: import `assertEqual` from `vizmatic/stage` rather than `node:assert` so the same film runs in browser `preview`. Note that `vizmatic preview` rejects imports from root `vizmatic`; preview films that import pure helpers from `vizmatic` with stills or precompute the numbers.

### Lessons, narrated films, and sound

Read `references/lessons.md` before writing a teaching or narrated film. Start narrated lessons from `npx vizmatic new <name> --template narrated` and drive incremental builds with:

```bash
npx vizmatic narrated build <folder> --draft   # local voice, sound mix, layout check, <name>-draft.mp4
npx vizmatic narrated build <folder>           # full delivery render
```

`narrated({ title, timing, scenes })` renders the title card, manages scene entry and exit fades, attaches chapters and captions, and exposes phrase cues (`c.show`, `c.hide`, `c.swap`, `c.on`) that fail the build if a spoken phrase is missing or ambiguous. Put `{ after: true }` on computed results so numbers appear as the voice finishes saying them rather than spoiling the prediction.

Other `vizmatic narrated <step> <folder>` commands (`--dry-run` previews any step):
- `draft`: estimate `timing.json` without audio for early visual layout.
- `voice` / `mix` / `resound`: synthesize speech, mix `narration.wav`, or remux updated audio into an existing MP4 without re-rendering frames.
- `beats --words`: print beat timestamps and spoken words to pick exact cues.
- `check --motion` / `stills` / `sheet`: run layout scans (`--scene <id,...>` scopes stills and sheets).
- `transcribe` / `sync` / `lag` / `probe`: verify TTS pronunciation against `script.json`, check rendered audio-to-video alignment, and inspect streams, chapters, captions, and file hash.

Generate subtle sound effects (`tap`, `slide`, `latch`, `resolve`, `bell`) or ambient beds with `npx vizmatic sounds list`, `npx vizmatic sounds render <name> --out cue.wav`, and `npx vizmatic sounds bed --voice narration.wav --out bed.wav --palette warm --timing timing.json`. Read the [narrated films guide](https://github.com/bvolpato/vizmatic/blob/main/docs/guides/narrated-films.md) for the full folder contract.

Compute every displayed number, check invariants with `assertEqual`, and keep every visible heading true for its entire lifetime on screen. Report which passages were played with sound and which were reviewed as stills; a person must watch the complete lesson at full speed with sound before publication.

## Figure workflow

1. Start from a bare `.tsx` frame or `assets/starter-frame.tsx`. Omit `width` and `height` while iterating: output starts at `960x540` and auto-grows to fit. Read `references/patterns.md` to choose components, or use `importMermaid` / `importD2` to convert existing diagrams into `GraphDiagram` props.
2. Check both themes and fix every error:
   ```bash
   npx vizmatic check ./frames/diagram.tsx --theme dark,light --json
   ```
3. Render PNG, SVG, or both:
   ```bash
   npx vizmatic render ./frames/diagram.tsx --out ./public/vizmatic --theme dark,light --format both
   ```
   PNG and SVG outputs are alpha-transparent by default; add `--background theme` (or `background={c.bg}`) for an opaque canvas, `--no-crop` to preserve outer margins, and `preset = "engineering";` with `--theme light` for flat technical article figures.
4. Open the rendered PNGs (and any host page embedding them) to verify zero clipped labels, line crossings, low-contrast text, or wasted space.

Figures default to `dense` (10 to 12 px detail type, hairlines, tight gutters): pack real rates, schemas, p99 latencies, ports, and limits into each element. Switch to `density="presentation"` (or `--density presentation`) only for slides viewed across a room.

## Judge your own output

`vizmatic check` catches geometric defects, not weak composition. On every still or figure, verify:

- Can a reader grasp the main point in three seconds?
- Does one color mean one concept throughout, using look tokens (`blue`, `teal`, `yellow`, `ink`, `dim`) in films and semantic tones in figures?
- Are all labels unclipped, clear of strokes, and attached to what they name?
- Is frame space earned with concrete detail or one large central mechanism rather than small boxes floating in empty canvas?
- Is text legible at target viewing size (`>= 26` px on a 1920x1080 lesson watched on phones, `>= 18` px on desktop stills)?

If any answer fails, revise the layout and inspect fresh renders. Return generated file paths, exact commands run, check output summary, and which stills or frames you inspected.

## Common requests

- "Explain this math, proof, or optimization" -> film (`vizmatic/stage`) with `axes`, `plane`, `projectionMark`, `tex`, `morphMatching`, or `scene3d`, driven by `s.value` and `dynamic`.
- "Teach this topic with voiceover" -> narrated film (`npx vizmatic new <name> --template narrated`). Follow `references/lessons.md`.
- "Animate a systems trace, queue, or protocol" -> film with `lanes`, `pipeline`, `requestQueue`, `ringBuffer`, `boundary`, `stateGrid`, `bitField`, `eventLog`, `terminal`, or `connector.send`.
- "Animate a model, tokenizer, or eval table" -> film with `layerStack`, `tokens`, `attentionMatrix`, `heatmap`, `matrixProduct`, `barChart`, `scatter`, `tree`, or `table`.
- "Examine claims, quotes, or history" -> film with `passage`, `quote`, `quotePair`, `dateLine`, `tagTrack`, and `sceneKit`.
- "Make a talk or stepped deck" -> film with one `s.chapter` per step (`deck` template), presented via `<vz-film stepped>` and checked with `--stepped`.
- "Create an architecture, sequence, lineage, deployment, or ER diagram" -> TSX figure with `GraphDiagram`, `SequenceDiagram`, `DataflowDiagram`, `DeploymentDiagram`, `TransformerTopology`, or `EntityRelationshipDiagram`.
- "Turn metrics or tradeoffs into a docs figure" -> TSX figure with `DataTable`, `LineChart`, `BarChart`, `ParetoChart`, `QuadrantChart`, and `MetricCard`.

## Starting points

- `assets/starter-film.ts`: stage film with `axes`, a live `s.value` secant-to-tangent limit, and `tex`.
- `assets/starter-frame.tsx`: dense static TSX figure.
- `assets/animated-frame.tsx`: TSX timeline animation (`defineAnimation`) for `vizmatic gif` or `vizmatic video`.
- `references/films.md`: stage engine rules, relational layout, worked `examples/films/` index, domain object patterns, and check codes.
- `references/lessons.md`: planning, checked teaching helpers, phrase-synced narration, motion scanning, and delivery verification.
- `references/patterns.md`: TSX figure component selection, bare vs module frames, Mermaid/D2 import, and timeline animations.
