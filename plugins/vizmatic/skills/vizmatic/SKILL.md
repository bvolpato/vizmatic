---
name: vizmatic
description: Create and render theme-aware diagrams, charts, docs figures, and animated GIFs from TSX. Use when a coding agent needs an architecture diagram, process flow, RAG graph, evaluation dashboard, slide frame, release card, or animated pipeline.
---

# Vizmatic

Use Vizmatic when a request needs a diagram, chart, presentation frame, or animated GIF. Prefer its React scene primitives over hand-written SVG for common layouts.

## Workflow

1. Decide whether output needs static images, an animated GIF, or both. Ask about size, branding, or destination only when it changes the result.
2. Confirm Node.js 20 or newer is available, then install or reuse the CLI:
   ```bash
   command -v vizmatic || npm install -g vizmatic
   ```
   Add project dependencies when code imports Vizmatic or the repository needs a committed render script:
   ```bash
   pnpm add vizmatic react
   ```
3. Start with a bare `.tsx` frame. Omit dimensions during exploration; output starts at `960x540` and grows when content overflows. Set `width` and `height` for fixed output. Set `autoSize = false` when overflow should fail instead of resizing.
4. Add imports, `defineIllustration`, or `c` props only when the frame needs helper code, data, explicit theme tokens, other dependencies, or animation. `Scene` title and subtitle are optional.
5. Choose primitives by intent. Read `references/patterns.md` for component choices and frame examples.
6. Check both themes and fix reported errors:
   ```bash
   vizmatic check ./frames/diagram.tsx --theme dark,light --json
   ```
7. Render dark and light outputs:
   ```bash
   vizmatic ./frames/diagram.tsx --out ./public/vizmatic --theme dark,light
   ```
   For directories:
   ```bash
   vizmatic frames --out ./public/vizmatic --theme dark,light
   ```
   PNG and SVG output is transparent by default. Add a theme fill when the destination needs an opaque canvas:
   ```bash
   vizmatic frames --out ./public/vizmatic --theme dark,light --background theme
   ```
   Autocrop keeps 24 source pixels around detected content. Use `--no-crop` only when the full declared canvas is part of the composition.
8. For GIFs, export `createScenes(theme)` from a full module and render:
   ```bash
   vizmatic gif ./frames/animated.tsx --out ./public/vizmatic --theme dark,light --scale 1
   ```
9. Inspect the output. Check file dimensions and visual layout. When an asset appears on a page, verify that page too. Fix clipping, overlap, low contrast, and uneven spacing before finishing.

## Starting points

- Copy `assets/starter-frame.tsx` for static diagrams and dashboards.
- Copy `assets/animated-frame.tsx` for GIFs.
- Read `references/patterns.md` for primitive selection, tone usage, and render commands.

## Design rules

- Use semantic tones such as `blue`, `purple`, `cyan`, `green`, `warm`, `critical`, `neutral`, `ocean`, and `sunset`.
- Use `preset = "engineering";` for flat technical article figures. Render the light theme and avoid dashboard chrome, shadows, gradients, or decorative color.
- Keep labels short. Prefer cards, rows, grids, and tables that wrap safely.
- Use Vizmatic charts for data summaries instead of screenshotting tables.
- Keep presentation frames concise and readable. Remove marketing filler.
- Return generated file paths and the exact render command that produced them.

## Common requests

- "Create an architecture diagram for this service" -> write a flow, graph, or layered network frame and render PNGs.
- "Turn this eval data into a figure" -> use metric cards plus bar or line charts.
- "Make this pipeline animated" -> create `createScenes(theme)` and render GIFs.
- "Add a docs visual" -> put output under the repo's docs/public asset path and verify the page if present.
