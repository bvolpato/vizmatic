# Roadmap

This page states what Vizmatic can do now and what comes next. Vizmatic aims to make technical ideas easy to explain from code: motion that teaches, and figures that hold real information. Rendering stays deterministic, offline, and theme-aware.

## Available now

### Films

- A vector animation engine in `vizmatic/stage`. Every object is Bezier geometry, so any shape can trace itself, morph, or bend through a function.
- A timeline that is a pure function of time. Any frame can be sampled in any order, so scrubbing is instant and output is reproducible.
- TeX glyphs for equations, with `morphMatching` to carry shared terms between lines.
- Objects for math, charts, computer science, and systems, plus 3D scenes with surfaces, curves, and an orbiting camera.
- Five looks, gradient strokes, glow, and bloom.
- `<vz-film>`, a live, seekable player for any page, with chapters and a stepped presentation mode.
- `fromSvg` and `fromComponent`, which turn any SVG or TSX figure into shapes that films can animate.
- Export to MP4 and WebM with BT.709 color, GIF with a shared palette, PNG, and SVG. Frames rasterize on worker threads with a memory limit, with optional motion blur, embedded MP4 chapter and caption tracks, and WebVTT sidecars.
- `vizmatic new`, `preview`, `check`, `film`, `narrated`, `sounds`, `looks`, and `objects`. Preview reloads on save and keeps the playhead.
- Narrated teaching films with `vizmatic narrated`: spoken beat takes, `timing.json` synchronization, background pads and cue sound effects (`vizmatic sounds`), transcript verification, and audio lag checks.
- `vizmatic check` for films: off-canvas marks, overlapping text, strokes through text, crowded text, small labels, and empty canvas space, with times and bounding boxes as JSON. `--motion` inspects every frame for collisions and blank gaps between pictures.
- The Studio, which builds and exports a film in the browser.

### Figures

- Typed primitives for system, sequence, dataflow, deployment, and transformer diagrams, with charts, tables, and scientific components.
- A density system: `dense` by default, with `compact`, `comfortable`, `presentation`, or a numeric scale from one source.
- Deterministic Dagre layout with nested boundaries, named ports, and obstacle-aware orthogonal routing.
- Dark, light, and Engineering presets with PNG, SVG, and GIF output.
- Accessible SVG titles, descriptions, stable element IDs, and links for graph diagrams.
- Typed checks with stable diagnostic codes for overflow, contrast, small text, overlaps, and connector congestion.
- Conservative Mermaid and D2 text import with explicit diagnostics for lossy syntax.
- A positioned browser builder with editable text and data, undo and redo, and portable project files.
- An isolated runtime for editable scenes from users or agents, with resource limits, in Node and in browsers.

## Next

### Films

- Optional burned-in open captions rendered onto video frames. Synchronized narration timing, embedded MP4 caption tracks, and WebVTT sidecars are available now.
- ProRes and 4:4:4 masters for video editors. MP4 and WebM use 4:2:0 today for browser compatibility.
- Frame caching for faster incremental renders.
- Parity tests between the canvas and SVG backends, which today share one display list but use separate painters.

### Figures

- C4 semantics: one reusable model with context, container, component, deployment, and dynamic views.
- UML class and component diagrams, and state machines with nested states. ER diagrams with keys and cardinality are implemented.
- Swimlanes and activity diagrams.
- A layout adapter interface with Dagre as the default and ELK as an option. Per-boundary direction and collapsed groups.
- Build-time icon packs for GCP and Kubernetes from pinned Apache-2.0 data, as optional modules. User-supplied AWS and Azure adapters until redistribution terms support bundled packs.
- Structured accessibility for more scientific and drawing primitives. Charts and entity-relationship diagrams now preserve their semantic summaries in SVG exports.
- Wider Mermaid and D2 import, and Structurizr, Kubernetes, and Terraform adapters where semantics map safely.

## Design constraints

- Keep public APIs backward compatible, or document the break in the release notes.
- Keep default rendering deterministic and offline.
- Treat provider licensing and trademarks as product requirements.
- Add tests for behavior contracts and regressions, not for source-text presence.
- Ship each capability with dark and light reference renders, docs, and diagnostics.
