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
- Say that numbers are invented where a viewer could take them for a measurement. Do not repeat the label on every example, because a repeated caveat distracts from the lesson.
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
- `examples/_teaching/` in the package shows each construction. `teaching-byte-diff.ts` also runs by itself: `npx tsx node_modules/vizmatic/examples/_teaching/teaching-byte-diff.ts > byte-diff.svg`.

## Follow a voice

Measure the speech first. Record each beat of the script as one take, and save its length and the time of each word. Most speech engines report word times, and a transcription tool can measure them from any recording. Then `narration` places the scenes, and each change runs when the voice reaches a phrase.

```ts
import { fadeIn, film, narration, text } from 'vizmatic/stage'
import timing from './timing.json'

// timing.json: { "scenes": [{ "id": "problem", "title": "The problem", "beats": [
//   { "say": "Latency climbs. Should we page someone?", "duration": 3.1, "hold": 1.5,
//     "words": [{ "text": "Latency", "start": 0.2, "end": 0.7 }, ...] }] }] }

export default film((s) => {
    const voice = narration(s, timing, { lead: 0.6, gap: 0.4 })
    const problem = voice.scene('problem')
    problem.at(0, () => s.play(fadeIn(text('p95 latency', { size: 72 }).at(0, -100))))
    problem.on('should we page', () => s.play(fadeIn(text('Page someone?', { size: 72 }).at(0, 60))))
})
```

- `lead` is the silence before the first word, and `gap` is the silence between scenes. The sound mix must place each take at the same times. `voice.placements()` lists them.
- A beat's `hold` is silence after it. Use it to give the viewer time to think.
- `scene.on(phrase, build, offset)` builds when the phrase starts, and `scene.after` when it ends. `scene.cue(phrase)` returns both times. A cue ignores case and punctuation. If the voice does not say the phrase, the build stops with the name of the scene and the phrase, so a script change cannot leave the picture behind.
- A word in `timing.json` can hold a spoken form, such as "twenty seven B" for "27B". A cue matches the spoken form.
- `narration` adds a caption for each spoken line and a chapter for each scene that has a `title`. The MP4 carries both.
- The film lasts until the voice ends. Transcribe each new take before you render, and compare it with the script. A speech engine can say a word in a way that a listener hears as another word.

Without word times, place changes with `s.at` at times that you measured by hand:

```ts
s.at(3.2, () => s.play(fadeIn(text('Second point', { size: 72 }).at(0, 60))))
```

```bash
npx vizmatic film lesson.ts --audio narration.wav --quality high --out dist/films
```

- `--audio` pads or trims the sound to the film's length. A film that ends early cuts off the voice, so hold until the voice ends.
- `s.caption(text, seconds)` adds a caption by hand. It goes into the MP4 as a track that the viewer can switch on, and into a WebVTT file beside the video. It does not draw the caption into the picture.
- Leave room to think. Start with a hold of about 1.5 seconds after a worked result, and about 5 seconds after a question to the viewer.
- Use `s.chapter` for each section, or a `title` on each scene of a narration. Chapters mark the timeline of the player and of the MP4.

## Change pictures cleanly

Most defects in long films appear between pictures. These two failures pull against each other:

- **Collision:** old text is still readable when new text reaches it, even for one or two frames.
- **Blank:** the old picture has gone and the new one is not readable, so the voice plays over an empty screen.

An old picture must drop under about 25% opacity before new content reaches it. Fade it out quickly, and make the new content wait. Leave `duration` off `s.play`, or both animations stretch to fill it.

```ts
s.play(fadeOut(oldText, { duration: 0.15 }), delay(fadeIn(newText, { duration: 0.25 }), 0.1))
```

Inside a `s.play` that has a `duration`, use `seq(fadeOut(oldText), fadeIn(newText))`. It gives each animation its share of the time.

- Keep something on screen through the change. A shape or a label that is clear of the new picture can linger for about half a second, which closes the blank. Do this when a shorter fade opens a gap.
- Start each scene's first picture in its first half second, even if the first spoken cue comes later.
- Text may meet other text or a shape only if it replaces it in place, becomes it with a morph, or sits behind an opaque tile.
- An arrow that sweeps across a label is a collision. Fade the label during the sweep, and return it afterward.
- After you shorten a fade, scan again. A fix for a collision often opens a blank.

## Scan the motion

`vizmatic check` looks only at moments of rest, so it misses a crossfade collision and a blank gap between pictures. Add `--motion` to inspect every frame.

```bash
npx vizmatic check lesson.ts --motion --content-top 200 --json
```

- A finding that appears only while something moves is a warning. It carries a `motion` field with the number of separate stretches and their total length. `time` and `until` bound the longest stretch.
- `film.blank` reports 0.2 seconds or more with nothing visible. `--content-top` is the canvas y where the content starts. Set it when a heading stays up, because the heading otherwise hides every blank.
- The scan compiles every frame and paints none. A film with heavy `dynamic` drawings can take a minute or more.
- In code, use `checkFilm(film, { motion: true, contentTop: 200 })` from `vizmatic/stage`.
- An older package rejects `--motion` as an unknown option. Update the package.

The scan cannot see that one block replaces another, so decide each warning yourself. A curve that passes an axis number while it draws is usually fine. Two sentences on the same lines are a defect. An empty result does not prove a film clean:

- The check reports text crossed by a stroke. It does not report text on the edge of a filled shape.
- A frame with one small mark counts as visible, so a nearly empty frame can pass. A blank shorter than 0.2 seconds is not reported. Read the frames at each handover in the delivered movie.

The scan does not replace a look at the picture. Read the whole film as contact sheets, and not a sample of it.

```bash
npx vizmatic film lesson.ts --every 3 --sheet --out stills
npx vizmatic film lesson.ts --range 118:126 --every 0.25 --sheet --out stills
```

The first command gives one tile every 3 seconds, 24 tiles to a sheet. The second reads one change of picture closely.

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
