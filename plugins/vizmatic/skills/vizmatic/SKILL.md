---
name: vizmatic
description: Create polished theme-aware diagrams, figures, dashboards, presentation frames, and animated GIFs with Vizmatic. Use when Codex needs to design or render visual assets such as architecture diagrams, process flows, RAG graphs, eval dashboards, product figures, docs images, slide frames, launch cards, or animated pipeline GIFs.
---

# Vizmatic

Use Vizmatic when the user wants a concrete image or GIF artifact, not only an explanation. Prefer structured React scene primitives over hand-written SVG for common diagrams, dashboards, and frames.

## Workflow

1. Pick output scope: static PNGs, animated GIF, or both. Ask only if target size, brand, or destination is truly ambiguous.
2. Install or reuse the CLI:
   ```bash
   command -v vizmatic || pnpm add -g vizmatic
   ```
   If the project needs direct renderer APIs, editor types, or committed scripts, add project deps instead:
   ```bash
   pnpm add vizmatic react
   ```
3. Create a bare `.tsx` frame by default: write JSX directly. Set `width` and `height` when exact output size matters; otherwise Vizmatic starts at `960x540` and auto-grows omitted axes on overflow. Skip imports, `defineIllustration`, and `c` props unless the frame needs custom dependencies, helper functions, data loading, explicit theme tokens, or animation exports. `Scene` title/subtitle are optional.
4. Choose primitives by intent. Read `references/patterns.md` when deciding component structure.
5. Render dark and light outputs:
   ```bash
   vizmatic ./frames/diagram.tsx --out ./public/vizmatic --theme dark,light
   ```
   For directories:
   ```bash
   vizmatic frames --out ./public/vizmatic --theme dark,light
   ```
   PNG/SVG renders use alpha-transparent backgrounds by default. For full-frame theme fill, render with:
   ```bash
   vizmatic frames --out ./public/vizmatic --theme dark,light --background theme
   ```
6. For GIFs, export `createScenes(theme)` from a full module and render:
   ```bash
   vizmatic gif ./frames/animated.tsx --out ./public/vizmatic --theme dark,light --scale 1
   ```
7. Verify actual artifacts. Check file existence, dimensions, and visual layout. Use browser screenshots when assets are shown on a page. Fix clipped labels, overlap, low contrast, and unbalanced spacing before finishing.

## Starting Points

- Copy `assets/starter-frame.tsx` for static diagrams and dashboards.
- Copy `assets/animated-frame.tsx` for GIFs.
- Read `references/patterns.md` for primitive selection, tone usage, and render commands.

## Design Rules

- Use supported tones such as `blue`, `purple`, `cyan`, `green`, `warm`, `critical`, `neutral`, `ocean`, and `sunset`.
- Render both `dark` and `light` unless the user asks for one theme.
- Omit `Scene` title/subtitle for badges, inline blog figures, or visuals where surrounding copy already provides title context.
- Prefer alpha-transparent PNG/SVG backgrounds for blog posts and docs cards. Use `--background theme` or `<Scene background={c.bg}>` only when the destination needs opaque theme fill.
- Omit dimensions for exploratory CLI frames when content density is uncertain; use explicit dimensions for deterministic final assets.
- Keep labels short. Prefer cards, rows, grids, and tables that wrap safely.
- Use Vizmatic charts for data summaries instead of screenshotting tables.
- Keep presentation frames dense and inspectable. Avoid marketing-style filler.
- Return generated file paths and the exact render command that produced them.

## Common Requests

- "Create an architecture diagram for this service" -> write a flow, graph, or layered network frame and render PNGs.
- "Turn this eval data into a figure" -> use metric cards plus bar or line charts.
- "Make this pipeline animated" -> create `createScenes(theme)` and render GIFs.
- "Add a docs visual" -> put output under the repo's docs/public asset path and verify the page if present.
