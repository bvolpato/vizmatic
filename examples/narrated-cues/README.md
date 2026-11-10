# Three tasks, one clock

This three-scene narrated lesson shows how to add serial task times and calculate the time saved by removing one task. The invented times are 4, 6, and 2 milliseconds. Removing the 6 millisecond task leaves 6 milliseconds, which is half the original total. The model excludes parallel tasks and overhead.

`script.json` declares the cues. `film.ts` uses a pronounced-number cue with numeric data, connectors between layout blocks, `show` and `swap` after speech, and `keep`/`take` across scene boundaries. The screen derives its totals from `data/numbers.json` and checks them with `assertEqual`.

## Build

Build the Vizmatic package first. Then run this command from the repository root. Narrated builds require Node.js 20 or later, uv, and FFmpeg. The first voice run downloads the local Kokoro model.

```sh
node dist/cli.js narrated build examples/narrated-cues --draft
```

The build writes `examples/narrated-cues/dist/Three-Tasks-One-Clock-draft.mp4`. Open that file in a video player. Run the command without `--draft` to render the standard movie.

The included `timing.json` has estimated word times for layout work. The build replaces it with measured word times and generates the audio, captions, and movie. Generated audio, stills, and movies are ignored by Git.

## Inspect the picture

Generate a full-size still for each beat, or start the interactive preview:

```sh
node dist/cli.js narrated stills examples/narrated-cues
node dist/cli.js preview examples/narrated-cues/film.ts
```

Stills appear under `examples/narrated-cues/stills/`. The preview prints the address of its player. After changing a scene, check its layout and motion:

```sh
node dist/cli.js narrated check examples/narrated-cues --motion
```
