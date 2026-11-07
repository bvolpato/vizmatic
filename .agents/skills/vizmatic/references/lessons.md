# Vizmatic lessons

Read this when a film must teach a topic, and always for a long or narrated film. `references/films.md` has the engine rules. These rules come from building lessons of more than 20 minutes and reviewing them frame by frame.

## Priorities

Apply these in order: accuracy, completeness, clarity, brevity. Length follows the content, so there is no target length. Remove a passage only if it does not help a viewer learn.

## Plan before you animate

1. State one promise and a list of objectives. Each objective names something the viewer can do afterward.
2. List every section of the source material. Mark each one as taught, with its scenes, or as left out, with a reason. The core of the topic cannot be left out.
3. Finish the script first. A script change after the film exists repeats the film work.
4. Teach the problem, then the mechanism, then the limits. Define each term before you use it.
5. Keep one worked example through the film, and move from it to the general rule. Ask the viewer to predict a result, and resolve it on screen. Near the end, give a new case with new numbers.
6. Plan one picture per scene. Ask what the viewer sees change when the voice makes its point. If the answer is "a new box appears", find a better picture.

## Keep the screen true

Compute every number in the film, and check it, so that the screen cannot disagree with the math. `examples/films/attention.ts` and `examples/films/cache-miss.ts` compute everything they show.

```ts
import assert from 'node:assert/strict'

const shares = softmax(scores)
assert(Math.abs(shares[0] + shares[1] - 1) < 1e-9)
const label = text(shares[0].toFixed(3), { font: 'text-serif', size: 44 })
```

- The voice and the screen use the same values, the same order, and the same rounding.
- A title must stay true for as long as it is visible. A title that was true when it arrived can become false when the picture moves on. Sampling frames misses this. List every text block with the times it is visible, and read each one against the picture and the voice.
- Say when numbers are invented for the example.
- Words such as "every", "always", and "never" must be true as stated, or they need a qualifier.

## Use the checked constructions

For some mechanisms, Vizmatic computes the intermediate states for you, so that labels and geometry follow one calculation. The film supplies the data, the model assumptions, and the cues.

| Pure helper | Canvas method | Use it for |
|---|---|---|
| `weightedVectorState` | `vectorAccumulation` | Ordered weighted vectors, such as momentum and a gradient. Each term keeps its contribution and endpoints. |
| `categoricalSampling` | `categoricalSampling` | Supplied uniform draws mapped through a categorical CDF, such as a rare category that disappears from a sample. |
| `planTeachingRoutedTransfer` | `routedTransfer` | An orthogonal route around declared obstacles. An impossible route fails before painting. |
| `byteDifferenceState` | `byteDifference` | A changed byte, with stable offsets and escaped control characters. |
| `tokenHistoryState` | `tokenHistory` | Prompt, accepted, processed, KV, and emitted tokens when a cache drops and rebuilds. `assertTokenHistoryTransition` checks an authored transition. |

**In a stage film,** import a pure helper from `vizmatic`, and draw its state with stage objects. `check` and `film` accept this. `preview` runs in the browser and refuses any import from `vizmatic`, so preview such a film with stills, or compute the values in a separate step.

**In a canvas host,** `createTeachingCanvas(painter)` gives you the canvas methods, drawn through the host's checked painter. Use this path only when a project already has such a host. For new motion, write a stage film. The [canvas guide](https://bvolpato.github.io/vizmatic/docs/tsx-animation.html) describes the painter contract.

- Keep the viewer's prediction open. The reveal flags are separate from progress: `revealTotal`, `showEmpirical`, and `revealVerdict`. Bind them to the narration, and show the answer after the voice asks for it.
- Keep the scope of each construction visible, and do not claim more for it:
  - `byteDifference` aligns a common prefix and suffix with a positional middle. It is not a minimum-edit diff, and it does not prove where an artifact came from.
  - `categoricalSampling` uses only the draws you supply and runs no hidden random experiment.
  - `tokenHistory` models ordinary autoregressive decoding, with at most one accepted token awaiting processing. Speculative decoding needs its own contract.
- Render the prediction, the moving state, and the settled result at delivery size. Check moving marks against the actual glyphs, as well as the declared card bounds.
- `examples/_teaching/` shows each construction. These files import from `../../src`, which the package does not ship, so read them for usage and import from `vizmatic` in your own code.

## Follow a voice

Measure the speech first. Then place each change at the moment the voice reaches it, with `s.at`, so that one section does not push the others around.

```ts
import { fadeIn, film, text } from 'vizmatic/stage'

const VOICE_LENGTH = 6.4 // The measured length of narration.wav, in seconds.

export default film((s) => {
    s.at(0.5, () => s.play(fadeIn(text('First point', { size: 72 }).at(0, -100))))
    s.at(3.2, () => s.play(fadeIn(text('Second point', { size: 72 }).at(0, 60))))
    s.wait(Math.max(0, VOICE_LENGTH - s.time))
})
```

```bash
npx vizmatic film lesson.ts --audio narration.wav --quality high --out dist/films
```

- `--audio` pads or trims the sound to the film's length. A film that ends early cuts off the voice, so hold until the voice ends.
- `s.caption(text, seconds)` writes a WebVTT file beside the video. It does not draw the caption into the picture.
- Leave room to think. Start with a hold of about 1.5 seconds after a worked result, and about 5 seconds after a question to the viewer.
- Use `s.chapter` for each section. Chapters mark the player's timeline.

## Change pictures cleanly

Most defects in long films appear between pictures. These two failures pull against each other:

- **Collision:** old text is still readable when new text reaches it, even for one or two frames.
- **Blank:** the old picture has gone and the new one is not readable, so the voice plays over an empty screen.

An old picture must drop under about 25% opacity before new content reaches it. Fade it out quickly, and make the new content wait. Leave `duration` off `s.play`, or both animations stretch to fill it.

```ts
s.play(fadeOut(oldText, { duration: 0.15 }), delay(fadeIn(newText, { duration: 0.25 }), 0.1))
```

- Keep something on screen through the change. A shape or a label that is clear of the new picture can linger for about half a second, which closes the blank. Do this when a shorter fade opens a gap.
- Start each scene's first picture in its first half second, even if the first spoken cue comes later.
- Text may meet other text or a shape only if it replaces it in place, becomes it with a morph, or sits behind an opaque tile.
- An arrow that sweeps across a label is a collision. Fade the label during the sweep, and return it afterward.
- After you shorten a fade, scan again. A fix for a collision often opens a blank.

## Scan the motion

`vizmatic check` looks only at moments of rest, so it misses a crossfade collision and a blank gap between pictures. Scan every frame with the API. Save this as `scan.mts` in a project with `"type": "module"`, and run `npx tsx scan.mts`.

```ts
import { checkFilm, compileFilm, pathBounds } from 'vizmatic/stage'
import draft from './lesson.ts'

const film = await compileFilm(draft)
const times = Array.from({ length: Math.floor(film.duration * film.fps) }, (_, i) => i / film.fps)

// Text that meets other text, or that a stroke crosses, at any moment. Judge each line.
const report = await checkFilm(film, { times })
for (const item of report.diagnostics) console.log(item.code, item.time.toFixed(2), item.message)

const frameAt = async (time: number) => {
    for (;;) {
        try {
            return film.frame(time)
        } catch (error: any) {
            if (!error?.promise) throw error
            await error.promise
        }
    }
}

// Frames with nothing readable below the heading. HEADING is a canvas y, so 0 checks the whole frame.
const HEADING = 0
for (const time of times) {
    const { ops } = await frameAt(time)
    const visible = ops.some((op) => {
        if (op.kind !== 'path' || Math.max(op.fillAlpha, op.strokeAlpha) < 0.25) return false
        const box = pathBounds(op.path)
        return box !== null && box.y + box.height > HEADING
    })
    if (!visible) console.log('blank', time.toFixed(2))
}
```

The scan cannot see that one block replaces another, so decide each line yourself. An empty result does not prove a film clean:

- The check reports text crossed by a stroke. It does not report text on the edge of a filled shape.
- A frame with only a faint mark counts as visible, so a nearly empty frame can pass. Read the frames at each handover in the delivered movie.

## Make it readable

Viewers watch on laptops and phones, so scale for the smaller screen. On a 1920 stage:

- Keep all text at 26 or more, including axis numbers. Keep most running text at 44 or more. A number that carries the point can be 200 or more.
- Use `font: 'text-serif'` for sentences and numbers.
- Keep the picture large and central from the start of a scene. If it grows, pull the camera back as it grows.
- Attach a label to the thing it names.

## Deliver

1. Check a section with `--range` and `--quality draft` before you render the whole film. The CLI cannot resume a stopped render, so a long render starts again from its first frame.
2. Render with `--quality high`. Confirm the settings. A 1080p60 film must report level 42 or lower, because QuickTime may refuse a higher level.
   ```bash
   ffprobe -v error -select_streams v -show_entries stream=profile,level,pix_fmt,r_frame_rate -of csv=p=0 dist/films/lesson.mp4
   ```
3. To join a clip to a film without encoding it again, encode the clip with `filmEncoderSettings(quality)` from `vizmatic/stage/export`. Players such as QuickTime read one set of decoder settings from the start of a file, and they stop at a clip that uses different ones.
4. Extract frames from the MP4 around each morph and handover, and read them. An encoded movie can show a one-frame blank that a scan of the source missed.
5. On a Mac, open the file in QuickTime or decode it with AVFoundation. FFmpeg tolerates problems that stop QuickTime.

## Review

- A checker finds layout and encoding defects. It does not find a wrong explanation or a dull scene.
- Have a reviewer who did not write the film view every scene of the exact movie. A reviewer who has already seen the film tends to score it higher.
- A new render needs a new review, unless nothing changed. Record the movie's hash with each decision.
- You cannot watch a video. Before a film is published, a person must watch it at full speed with sound. Say whether that has happened.
