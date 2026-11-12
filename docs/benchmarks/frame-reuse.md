# Skipping unchanged frames during film export

The exporter draws each frame and compares it with the previous frame before rasterizing it. This prototype also tracks when the timeline can next change. Until that time, it reuses the previous frame without drawing. A custom 3D object can move during that interval, so the exporter keeps sampling each frame.

## Measurements

Each run exported seconds 2.5 through 4.5 of a film at 640 × 360, with two workers, standard quality and the midnight look. Each clip contained 120 frames. The machine had an Apple M5 Max and ran Node 22.23.4, pnpm 11.1.0 and FFmpeg 9.0.2. Other processes shared the machine.

| Film | Control (frames/s) | Prototype (frames/s) | Frames the prototype skipped drawing |
| --- | --- | --- | ---: |
| Cache miss | 79.8, 83.9, 70.1 | 83.5, 84.1, 78.4 | 0 |
| Pythagoras | 129.1, 116.3, 78.3 | 127.1, 118.4, 127.3 | 47 |

Both revisions rasterized all 120 frames of Cache miss and 72 frames of Pythagoras. The control drew and compared the 48 repeated Pythagoras frames. The prototype drew one and skipped the other 47. For each clip, FFmpeg returned identical decoded frame hashes from the first control and prototype exports. The throughput ranges overlap for both clips.

To repeat the comparison, run these commands from a Vizmatic clone with Node 22, pnpm and FFmpeg installed. The prototype commit is also available in the history of [PR #120](https://github.com/bvolpato/vizmatic/pull/120).

```sh
git fetch origin pull/120/head
git worktree add --detach ../reuse-control 4b72ed18678b7fccf5028dc5b123cb8597b5689c
git worktree add --detach ../reuse-prototype e7be337e0609e54f3d2ea7c1c7a296a40cb2dbe0
for tree in ../reuse-control ../reuse-prototype; do
    (cd "$tree" && pnpm install --frozen-lockfile)
done
for film in cache-miss pythagoras; do
    for revision in control prototype prototype control control prototype; do
        (cd "../reuse-$revision" && pnpm benchmark:export "examples/films/$film.ts" \
            --from 2.5 --to 4.5 --width 640 --quality standard --workers 2)
    done
done
```

## Custom 3D objects

An object can use the time passed to its public `Object3D.emit(view, time)` method. The prototype considers the following film static throughout its one-second wait. It encodes ten copies of the first frame. The control encodes ten distinct positions.

Save this film as `moving-point.ts` in each worktree.

```ts
import { film, Object3D, point3d, scene3d, type View3D } from 'vizmatic/stage'

class MovingPoint extends Object3D {
    emit(view: View3D, time: number): void {
        point3d([time, 0, 0]).emit(view)
    }
}

export default film({ width: 256, height: 128, fps: 10, bloom: 0 }, stage => {
    stage.add(scene3d({ unit: 45, perspective: false })).add(new MovingPoint())
    stage.wait(1)
})
```

Run these commands in each worktree. The last command counts distinct decoded frames.

```sh
pnpm benchmark:export moving-point.ts --width 256 --workers 1 --quality draft --keep .cache/moving-point
ffmpeg -v error -i .cache/moving-point/bench-1-1.mp4 -map 0:v:0 -f framemd5 - |
    awk -F', *' '!/^#/{print $NF}' | sort -u | wc -l
```
