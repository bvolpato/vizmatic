# Canvas film export experiment

Vizmatic kept the SVG renderer for film export. The prototype used Skia Canvas to draw frames on the CPU or GPU with the browser player's drawing code. On a quiet laptop, the author reported about the same export speed at `standard` quality and an 8% to 19% speedup at `high` quality. [Original experiment](https://github.com/bvolpato/vizmatic/commit/f5dff55414db359e4b6f44f69cdde1fabd30f25c)

The two renderers produce different pixels. On dark films with bloom, the SVG exporter at `high` quality dithers the glow and sets the encoder to preserve the grain. The canvas exporter skips both steps. The original timings therefore do not establish the speedup at equal image quality. For the Lorenz clip below, the peak signal-to-noise ratio between the decoded SVG and CPU canvas videos was 43.7 dB at `standard` and 43.6 dB at `high`.

## Run the comparison

Use a full Vizmatic clone, Node 22, the pnpm version in the prototype's `package.json`, and FFmpeg with `libx264`. The pull request ref retains the prototype commit. The following commands build it in a separate worktree. [Benchmark revision](https://github.com/bvolpato/vizmatic/tree/16bf41fc11c5915f1ae1f7ab3e807885bf2b1252)

```sh
git fetch origin refs/pull/119/head
git worktree add --detach ../vizmatic-canvas-benchmark 16bf41fc11c5915f1ae1f7ab3e807885bf2b1252
cd ../vizmatic-canvas-benchmark
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
```

This CPU comparison exports the same second of the Lorenz film at 320 × 180. It uses the raw FFmpeg pipe because the experimental timed pipe can lose updates when a callback reuses a mutable pixel buffer. Compare runs at similar system load. The benchmark reports frames per second for each run.

```sh
for quality in standard high; do
    for renderer in svg canvas; do
        VIZMATIC_RENDERER="$renderer" VIZMATIC_CANVAS_GPU=0 VIZMATIC_PIPE=raw VIZMATIC_RENDER_STATS=1 \
            pnpm benchmark:export examples/films/lorenz.ts --look midnight --from 5 --to 6 \
                --width 320 --workers 2 --quality "$quality" --repeat 3
    done
done
```

For a GPU comparison, set `VIZMATIC_CANVAS_GPU=1`. Read the `renderer` field in the reported statistics to see whether Skia used the GPU or fell back to the CPU.
