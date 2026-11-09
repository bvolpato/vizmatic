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

The templates are `explainer`, `equation`, `architecture`, `chart`, and `deck`. Each one is one file. The `narrated` template writes a folder: a film that follows a recorded voice, with its script, its scenes, and its build.

### vizmatic preview

Open a live preview with a timeline. The page reloads when you save.

```bash
npx vizmatic preview intro.ts --open
```

### vizmatic check

Inspect a film without rendering video. The check samples the timeline and reports marks off the canvas, overlapping text, and lines that cross text. Each finding has a time and a position. Use `--json` to read the report in a script.

A film whose lines run past the frame on purpose, such as a warped grid, sets `bleed: true` in its options. The check then ignores lines and shapes past the edge, and it still reports text that runs off the canvas or sits against an edge.

```bash
npx vizmatic check intro.ts --look midnight,paper --json
```

The check looks where the film comes to rest, so it misses a problem that lasts only while something moves. `--motion` also inspects every frame. It reports a problem that appears only in motion as a warning, because it cannot tell a collision from one picture that replaces another. It reports 0.2 seconds or more with nothing visible as `film.blank`. It reports text that leaves before a viewer can read it as `film.text_brief`: a reader takes in 20 characters in one second, and a text needs half a second at least. `--reading-speed <n>` changes the speed, and 0 turns the rule off. `--stepped` is for a deck, which waits at each chapter: text that is up there is not reported. In a film, `readingSeconds(text)` from `vizmatic/stage` gives the time that a plain text needs. `--content-top <px>` sets the canvas y where the content starts, so that a heading that stays up does not count as content. `--text-margin <px>` sets how near text may come to an edge of the frame before the check reports `film.text_edge`. The default is 2% of the shorter side, and 0 turns the rule off. While the camera is zoomed, the check looks only at pinned text, because a zoom crops the rest on purpose.

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
| `--name <name>` | Name the output files, in place of the name of the film file. For one film. |
| `--background <color\|none>` | Replace the background. |
| `--ffmpeg <path>` | Use this FFmpeg. |
| `--json` | Print a report as JSON. |

### vizmatic narrated

Build a film that follows a recorded voice, or run one step of the build. The folder holds the script, the scenes, and `film.json`. See [Narrated films](narrated-films.md).

```bash
npx vizmatic narrated build my-film --draft
npx vizmatic narrated build my-film
npx vizmatic narrated stills my-film --scene answer
```

| Step | Meaning |
|---|---|
| `build` | The one command of a film. It brings the voice, the sound mix, the beat list, the layout check with motion, and the movie up to date, runs only the steps that have work to do, and says why it runs or skips each one. `--draft` writes `<name>-draft.mp4` and no file of the delivered movie. `--draft --scene <id,...>` makes a draft of those scenes alone. `--quality` and `--workers` set the render. A finding of the check stops the build, unless you pass `--allow-findings`. |
| `voice`, `mix` | The voice of the script, made on this machine, and the sound mix. |
| `draft` | A timing with estimated times and no sound. It never replaces a measured timing. |
| `check` | The layout check, with `--motion`, `--json`, `--content-top`, `--text-margin`, `--reading-speed` and `--stepped`. |
| `stills`, `sheet` | One full-size still for each beat, and contact sheets. `--scene <id,...>` builds only those scenes. |
| `beats` | Where each beat starts and ends, and with `--words <scene>` the spoken words. |
| `transcribe`, `sync`, `lag`, `probe` | Checks of the takes, of the picture and the voice of the movie against the timing, and of the movie file. `--draft` reads the draft. A check that does not pass ends with a failure. |
| `resound` | A new sound track in the rendered movie, without a new render of the picture. It stops when the picture was rendered with another timing than the sound has, and it checks the new movie before one rename puts it in the place of the old one. |

Every step first checks `film.json`, `script.json`, and the timing against the script, and prints one line for each problem. An option that a step does not have is an error. `--dry-run` checks the files, prints the steps, and runs none. The lines about the steps go to the error stream, so the output of `check --json` and of `probe` is the data alone. The steps need [uv](https://docs.astral.sh/uv/) and FFmpeg.

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
