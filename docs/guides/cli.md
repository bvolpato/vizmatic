---
title: CLI
nav: CLI
section: Ship
order: 4
description: Create, preview, check, and export films, and render static figures, from the command line.
---

## Films

### vizmatic new

Create a film from a starter that renders as written and passes the check.

```bash
npx vizmatic new intro --template explainer
```

The templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`.

### vizmatic preview

Open a live preview with a timeline. The page reloads when you save.

```bash
npx vizmatic preview intro.ts --open
```

### vizmatic check

Inspect a film without rendering video. The check samples the timeline and reports marks off the canvas, overlapping text, and lines that cross text. Each finding has a time and a position. Use `--json` to read the report in a script.

A film whose lines run past the frame on purpose, such as a warped grid, sets `bleed: true` in its options. The check then ignores lines and shapes past the edge, and it still reports text that runs off the canvas.

```bash
npx vizmatic check intro.ts --look midnight,paper --json
```

The check looks where the film comes to rest, so it misses a problem that lasts only while something moves. `--motion` also inspects every frame. It reports a problem that appears only in motion as a warning, because it cannot tell a collision from one picture that replaces another. It reports 0.2 seconds or more with nothing visible as `film.blank`. `--content-top <px>` sets the canvas y where the content starts, so that a heading that stays up does not count as content. `--edge-margin <px>` sets how near text may come to an edge of the frame before the check reports `film.text_edge`. The default is 2% of the shorter side, and 0 turns the rule off.

```bash
npx vizmatic check intro.ts --motion --content-top 200
```

### vizmatic film

Export a film. See [Exporting](exporting.md) for the options.

```bash
npx vizmatic film intro.ts --out dist/films --look midnight,paper --quality high
```

| Flag | Meaning |
|---|---|
| `--out <dir>` | The output folder. |
| `--look a,b` | Render in these looks. |
| `--format mp4,webm,gif,png,svg` | The output formats. |
| `--quality draft\|standard\|high\|master` | Encoder quality and motion blur. |
| `--fps <n>` | Frame rate. |
| `--width <n>` | Output width in pixels. |
| `--motion-blur <n>` | Sub-frames per frame. |
| `--shutter <0-1>` | The fraction of a frame the shutter stays open. |
| `--range a:b` | Render part of the timeline. |
| `--frame t,t` | Write stills at these times. |
| `--every <seconds>` | Write stills at this interval, across the film or its `--range`. |
| `--sheet` | Join the stills into contact sheets, each tile with its time. With no times, a sheet shows 12 moments spread over the film. |
| `--columns <n>` | Tiles in a row of a contact sheet. |
| `--poster` | Also write a poster frame. |
| `--workers <n>` | Rasterizer threads. |
| `--audio <file>` | Add a sound track. |
| `--background <color\|none>` | Replace the background. |
| `--ffmpeg <path>` | Use this FFmpeg. |
| `--json` | Print a report as JSON. |

### vizmatic looks and vizmatic objects

List the looks and the object library. Use `--json` in scripts and agents.

```bash
npx vizmatic looks --json
npx vizmatic objects --json
```

## Figures

Render TSX figures to PNG and SVG.

```bash
npx vizmatic ./frame.tsx --out ./figures --theme dark,light --format both
npx vizmatic check ./frame.tsx --theme dark,light --json
npx vizmatic gif ./animated-frame.tsx --out ./figures --theme dark,light --fps 20
```

Run `npx vizmatic --help` to see every option.
