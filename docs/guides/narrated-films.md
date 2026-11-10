---
title: Narrated films
nav: Narrated films
section: Motion
order: 5
description: A film that follows a recorded voice, from a script to a movie with one command. The folder, the script, the scenes, the kit, the build, the checks, and the review.
---

A narrated film explains a topic with a voice, and the picture changes on the words. You write the script, the scenes, and the data. The library makes the voice, the sound mix, the title card, the clock of each scene, the captions, the chapters, and the movie. One command builds it all.

## The voice stays on your machine

The voice is made on your machine, with [Kokoro](https://github.com/hexgrad/kokoro). The transcription that checks the voice runs on your machine too. No text of the script and no sound is sent to a service, so a script with internal content is safe.

The two models come from huggingface.co. A run that makes a take, or a transcript, asks that site for the model files, and downloads them the first time. It sends the name of the files that it wants, and nothing of your film. Once the files are on the disk, set `HF_HUB_OFFLINE=1` and the tools ask nothing:

```bash
HF_HUB_OFFLINE=1 npx vizmatic narrated build my-film --draft
```

A voice run that makes no new take does not load the model, and contacts nobody.

## Start a film

Two commands make a first movie:

```bash
npx vizmatic new my-film --template narrated
npx vizmatic narrated build my-film --draft
```

The first command writes a folder with a film of two scenes. The second one is the one command of a film. It makes the voice, the sound mix, the layout check and the movie, and writes `my-film/dist/<name>-draft.mp4`. The name of the movie comes from `film.json`.

Then change the script and the scenes, and run the same command again. It runs only the steps that have work to do, and says why it runs or skips each one:

```text
build: voice is skipped: timing.json is the voice of this script, and its 4 takes are on the disk
build: mix is skipped: narration.wav is the mix of this timing and of this film.json
build: beats is skipped: the timing did not change. To print the beats: vizmatic narrated beats my-film
build: check runs: the picture can change with any file of the film
build: render runs: a draft of the whole film
build: record runs: the movie keeps the timing of its picture, for the resound and sync steps
build: ran check, render, record. Skipped: voice, mix, beats.
build: wrote dist/A-Cache-in-Two-Scenes-draft.mp4, a draft. There is no delivered movie yet: a build without --draft writes dist/A-Cache-in-Two-Scenes.mp4.
```

Create the folder inside a project that has `vizmatic` installed, because the scenes import it. The folder needs `"type": "module"` in its `package.json`, which the template has. The build needs [uv](https://docs.astral.sh/uv/), which runs the sound tools and the check of the files, and FFmpeg.

```text
my-film/
  script.json        what the voice says
  film.json          the particulars of this film: the name of the movie, the voice, the sound mix
  film.ts            the film: its title, and one function for each scene
  scenes/kit.ts      what the scenes share: labels, colors, numbers
  scenes/*.ts        one file for each scene
  data/numbers.json  every number on screen
  sources.md         one entry for each fact, with its source
  README.md          the status of the film, how to build it, what was checked, and what was not
  timing.json        the measured voice. The build writes it
  audio/             one WAV for each beat. The build writes it, and git ignores it
```

## The script

`script.json` holds the narration. A scene is a chapter of the film. A beat is one take of the voice: a sentence, or a short paragraph.

```json
{
  "timeline": { "intro": 2.4, "pause": 0.6, "gap": 0.4, "tail": 0.5 },
  "scenes": [
    {
      "id": "question",
      "title": "The slow page",
      "beats": [
        { "say": "A page takes 800 milliseconds to build from the database." },
        { "say": "Most requests ask for the same page. So why build it again?", "hold": 1.5 }
      ]
    }
  ],
  "pronounce": { "800": "eight hundred" }
}
```

- `id` names the scene. The film has one function with the same name. An id has letters, digits and hyphens, because it goes into the names of files.
- `title` is the chapter title of the scene in the movie. The title of the film is in the film file.
- `hold` is silence after a beat, in seconds. The default is 0.25. Give the viewer about 1.5 seconds after a result, and more after a question.
- `timeline` has four times in seconds: `intro` for the title card, `pause` for the silence between the title card and the first word, `gap` for the silence between two scenes, and `tail` for the picture after the last word.
- `pronounce` replaces a word before the voice speaks it. Use it for numbers and names that the voice reads wrong. The captions keep the text that you wrote.

### Cues that the script declares

A beat can name the moments of its voice that change the picture. Each one is a cue: an id, the phrase that it stands for, and data that the film may read.

```json
{
  "say": "Then the cache answers in 5 milliseconds: one hundred and sixty times faster.",
  "hold": 1.5,
  "cues": [
    { "id": "cache", "phrase": "the cache answers" },
    { "id": "result", "phrase": "one hundred and sixty times", "data": { "color": "green" } }
  ]
}
```

- `id` is the name that a scene types, with letters, digits, hyphens and underscores. An id names one cue of its scene.
- `phrase` is words of the beat, one after another, in the form that the voice says. The beat says them one time.
- `data` is optional, and the library does not read it. `c.cue('result').data` gives it to the scene.

A scene names the id where it can name a phrase: `c.show('result', time)`, and the same for `c.hide`, `c.swap`, `c.on`, `c.after` and `c.cue`. `c.cues` lists the cues of the scene, each with its beat. The build carries the cues from `script.json` to `timing.json`, and a change of a cue is a change of the script.

Each declared cue must drive something. At the end of the build, the cues that no scene named are one error, by scene:

```text
narration: 2 cues that the script declares drive nothing in the film: scene "answer": cache, result. Use each one in its scene, such as c.show('cache', nodes), or remove it from the script
```

A draft checks cue use in the selected scenes. The clock resolves an exact id first, even when the narration speaks the same word elsewhere. Other strings match spoken phrases. If your course requires every string to be a declared id, enforce that rule when you import the script. Reading `c.cue(id)` counts as a use because a scene can use its time or data to schedule a change itself.

Which to choose:

| | A phrase in the scene | A cue in the script |
|---|---|---|
| Write | `c.show('one hundred and sixty times', time)` | `c.show('result', time)`, and the cue in `script.json` |
| Good for | A short film that one person writes: the script and the scenes change together. | A course, where a person reviews the script apart from the film. |
| The script shows | The words of the voice. | The words, and each moment at which the picture changes. |
| A new wording of the sentence | Changes the scene too. | Changes the phrase of the cue in the script. The scene stays. |
| A moment that the film forgot | Nothing reports it. | The build stops and names the cue. |

Finish the script before you animate. A change of the script after the scenes exist repeats the work on the scenes.

The build writes `timing.json` from the script, with a fingerprint of what the voice was made from: each text, its spoken form, the holds, the times, the voice and its speed. When you change one of them, the build makes the voice of the beats that changed. A single step that reads the timing stops, names the beats that changed, and gives the command to run. So a script and a voice cannot drift apart in silence.

## The film

`narrated()` is the whole entry file of a film:

```typescript
import { narrated } from 'vizmatic/stage'
import timing from './timing.json'
import { answer } from './scenes/answer'
import { question } from './scenes/question'

export default narrated({
    title: 'A cache, in two scenes',
    timing,
    scenes: { question, answer },
})
```

It does what every film needs, so no scene types a time for it:

- It lays the measured voice on the stage, with the captions and the chapters.
- It sets the text font of the film once: text-serif, which stays readable at the size of a phone. `font: 'sans'` names another. Every text with no `font` has it: the labels of the kit, a `text()` of a scene, and the labels that an object draws.
- It draws the title card from the title, for the `intro` seconds of the script. `intro: { title: 'A cache', subtitle: 'in two scenes' }` gives the card other words, `intro: (s, film) => { ... }` draws a card of your own, and `intro: false` shows none.
- It calls each scene at the moment that the picture of the scene opens, and fades in what the scene adds there.
- At the end of a scene, it fades out every node that the scene put on the stage. The picture of the last scene stays while the sound fades.

More about the film:

- The scenes run in the order of the script, whatever the order in `scenes` is.
- A scene of the script that the film does not define stops the build. A scene of the film that the script does not have stops it too.
- An error inside a scene has the name of the scene in front of it.
- The film lasts one gap and the tail past the last word.
- The film is as long as its narration, and no longer. A play that ends after its scene stops the build. The message names the scene and the play, and says by how much: `narrated: scene "question": the play of fadeIn that starts at 2.9 seconds ends at 22.9, and the scene ends at 5 seconds, with the hold of its last beat. That is 17.9 seconds too late, so the film would run past its narration.` Give the play a shorter duration, start it on an earlier cue, or give the last beat of the scene a longer `hold` in the script. The last scene may hold its picture for the gap and the tail.
- The film file always holds every scene. For a movie of some scenes, build a draft with `--scene`.
- The other options are the options of `film()`, such as `bloom` and `bleed`.

This is a complete film in one file, which passes `vizmatic check --motion` with no finding. The timing is written by hand here. In a film folder, the build measures it.

```ts
import { narrated, place, sceneKit, type SceneClock, type Stage } from 'vizmatic/stage'

const { area, heading, display, source, claimTag } = sceneKit()
const word = (text: string, start: number) => ({ text, start, end: start + 0.3 })
const timing = {
    intro: 2, lead: 2.6, gap: 0.4, tail: 0.5,
    scenes: [{
        id: 'question', title: 'The slow page',
        beats: [{ say: 'A page takes a long time.', duration: 2.4, hold: 1, words: [word('A', 0), word('page', 0.3), word('takes', 0.7), word('a', 1.1), word('long', 1.3), word('time.', 1.7)] }],
    }],
}

function question(s: Stage, c: SceneClock) {
    // The first picture of the scene. The film fades it in when the title card is gone.
    s.add(heading('The slow page'), source('An invented number'))
    // The kind of the claim that is on the screen, at the right end of the source line.
    claimTag(c, { word: 'ILLUSTRATION' })
    // A change of the picture on a spoken phrase. The layout places the text, and the clock times the fade.
    const time = place(display('800 ms', { color: 'red' }), area)
    c.show('a long time', time)
}

export default narrated({ title: 'A slow page', timing, scenes: { question } })
```

In `timing.json`, `lead` is the time of the first word: the title card and the pause after it. The script has `pause`, and the timing has `lead`.

`film()` and `narration()` are still there. Use them when a film needs another order of work, such as two voices or a scene with no voice.

### The shape of a timing

`narrated()` takes any object of this shape. The voice step writes it as `timing.json`. Another tool can write it from its own sound, such as a course that has its own voice service: this is the contract.

```json
{
  "intro": 0,
  "lead": 0.4,
  "gap": 0,
  "tail": 0.3,
  "scenes": [
    {
      "id": "question",
      "title": "The slow page",
      "start": 0.4,
      "beats": [
        {
          "say": "A page takes 800 milliseconds.",
          "duration": 2.4,
          "hold": 0.45,
          "words": [
            { "text": "A", "start": 0, "end": 0.2 },
            { "text": "page", "start": 0.2, "end": 0.6 },
            { "text": "takes", "start": 0.6, "end": 0.9 },
            { "text": "eight", "start": 0.9, "end": 1.2 },
            { "text": "hundred", "start": 1.2, "end": 1.6 },
            { "text": "milliseconds.", "start": 1.6, "end": 2.3 }
          ],
          "cues": [{ "id": "cost", "phrase": "eight hundred milliseconds" }]
        }
      ]
    },
    {
      "id": "answer",
      "title": "The answer",
      "start": 3.95,
      "beats": [
        {
          "say": "The cache answers.",
          "duration": 1.2,
          "hold": 0.45,
          "words": [
            { "text": "The", "start": 0, "end": 0.2 },
            { "text": "cache", "start": 0.2, "end": 0.6 },
            { "text": "answers.", "start": 0.6, "end": 1.1 }
          ]
        }
      ]
    }
  ]
}
```

Give all times as finite numbers in seconds. Each word starts at or after zero and ends within its beat. The start times and end times must each follow spoken order. The shell allows one millisecond of rounding at the end of a measured take.

| Key | What it is |
|---|---|
| `intro` | The time of the title card. Optional, 0 by default. A film with `intro: false` shows no card. |
| `lead` | The time of the first word of the film, for a first scene with no `start`. Optional, 0.6 by default. |
| `gap` | The silence between two scenes, for a scene with no `start`. The film also ends one gap and one tail after the last hold. Optional, 0.4 by default. |
| `tail` | The picture after that last gap. Optional, 0 by default. |
| `scenes[].id` | The name of the scene. The film has one function with this name. |
| `scenes[].title` | The chapter title. Optional: a scene with none starts no chapter. |
| `scenes[].start` | The film time of the first word of the scene. Optional. Without it, the scene starts one gap after the scene before it. |
| `beats[].say` | The text of the beat. The captions show it. |
| `beats[].duration` | The length of the voice of the beat, more than 0. |
| `beats[].hold` | The silence after the beat. Optional, 0 by default. |
| `beats[].words` | Each word that the voice says, with its `start` and its `end` from the start of the beat. A cue needs them. |
| `beats[].cues` | The cues that the script declares for the beat. Optional. |

What the film makes of it:

- A beat starts when the hold of the beat before it ends. A scene ends when the hold of its last beat ends.
- A scene with a `start` cannot start before the scene before it ends. The time between the two is the lead of the scene: the picture of the scene opens when the scene before it is gone, so it is up before the first word.
- The hold of the last beat of a scene is the time of the scene after its last word. The picture leaves in the last quarter of a second of it. In the example, the question ends at 3.25, and the answer has its picture from then to its first word at 3.95.
- `c.keep` and `c.take` change the two copies 0.3 seconds before the first word of the next scene, with or without a `start`.
- The film ends one gap and one tail after the last hold. With `gap: 0`, the tail is the time after the last hold.
- An explicit first scene start overrides `lead`. Allow enough time for the title card before that start.

The words are in the form that the voice says: "eight", "hundred", and not "800". A tool with no measured words can estimate them, as the draft step does. The sound steps of this command line read more keys, which they write themselves: `wav` and `text` of a beat, and `voice`, `speed` and `fingerprint` of the file. A film with its own sound needs none of them. The steps of `vizmatic narrated` check the file before they read it, and they ask for a `hold` in each beat.

## A scene

A scene is a function `(s, c, film)`. `s` is the stage, as in every film. `c` is the clock of the scene: it places a change on a spoken phrase. `film` is the clock of the whole film.

```typescript
export function question(s: Stage, c: SceneClock) {
    // 1. The first picture: what the scene adds here fades in as the scene before it leaves.
    const slow = slowRequest()
    s.add(heading('The slow page'), slow.name)
    // 2. A change on a spoken phrase: the bar grows from its left end, and its time fades in.
    c.show('eight hundred milliseconds', [grow(slow.bar, { from: boxOf(slow.bar).point('left') }), slow.time])
    // 3. Nothing for the end: every node of the scene fades out when the scene ends.
}
```

A scene types no place and no time. The [layout](layout.html) places each node: the kit of the template cuts `area` into three bands, and `place(column([name, row([bar, time])]), band, 'left')` puts a request in one. `c.show`, `c.hide` and `c.swap` start 0.1 seconds before their phrase and fade for 0.3 seconds.

- **The opening.** The film calls the scene one gap and 0.05 seconds before its first word, when the scene before it is gone. The first scene opens when the title card is gone. What the scene adds with `s.add` at that moment is its first picture, and it fades in over a quarter of a second. So the voice never plays over an empty frame, and two headings never share one place. Do not fade the first picture in yourself: the default fade of `fadeIn` is 0.8 seconds, which leaves the frame empty for too long, and the motion check reports it as `film.blank`.
- **The end.** Every node that the scene put on the stage leaves in the last quarter of a second of the scene: the nodes of the opening, and the nodes that came on a word. The picture of the last scene stays to the end of the film. `c.clear([nodes])` is still there, for a node that must leave earlier and for a value that a `dynamic` drawing takes its opacity from.
- **A picture that two scenes share.** When two scenes show one picture at one place, a fade between them looks like a mistake. Each scene builds its own copy. The scene that ends calls `c.keep`, and the scene that starts calls `c.take`. The two copies change places 0.3 seconds before the first word of the next scene, so they must look the same then: the scene that ends first undoes what it changed on its copy.

```typescript
export function question(s: Stage, c: SceneClock) {
    const slow = slowRequest()
    // ...
    c.keep(slow.all)
}

export function answer(s: Stage, c: SceneClock) {
    const slow = slowRequest()
    c.take(slow.all)
    // ...
}
```

### The clock of a scene

| Call | What it does |
|---|---|
| `c.show('a spoken phrase', nodes)` | Fades nodes in, 0.1 seconds before the phrase, in 0.3 seconds. A node, a block of the layout, an animation, or a list. `{ stagger: true }` brings a list one item after another, and all of it before the scene starts to leave. |
| `c.show('a spoken phrase', nodes, { after: true })` | Fades nodes in when the voice has said the phrase: a result. `c.hide` and `c.swap` take the same option. |
| `c.hide('a spoken phrase', nodes)` | Fades out nodes that are on the screen, with the same lead and the same fade. |
| `c.swap('a spoken phrase', out, in)` | The old nodes fade out, and the new ones start to fade in 0.2 seconds later. |
| `c.on('a spoken phrase', build, offset, beat)` | Runs `build` when the voice starts the phrase, for a play of the scene's own. `offset` moves it, in seconds. `beat` searches one beat only. |
| `c.after('a spoken phrase', build)` | Runs `build` when the voice finishes the phrase. |
| `c.onBeat(2, build)` | Runs `build` when beat 2 starts. |
| `c.at(1.5, build)` | Runs `build` at a time from the first word of the scene. |
| `c.cue('a spoken phrase')` | Returns the start and the end of the phrase, in film seconds. For a cue that the script declares, it also returns its `id`, its `phrase`, its `beat` and its `data`. |
| `c.cues` | The cues that the script declares for the scene, each with its `beat`. |
| `c.title` | The chapter title from the timing, when the scene has one. |
| `c.beats` | The beats of the scene, each with `start`, `end` and `until`. |
| `c.start`, `c.end`, `c.next` | The start of the first take, the end of the last hold, and the start of the next scene's first take. |
| `c.keep(nodes)`, `c.take(nodes)` | Hands a picture to the next scene with no fade. |
| `c.clear([title, alpha])` | Fades nodes out just before the scene ends, and brings values to zero in the same time. |
| `film.intro`, `film.gap`, `film.tail`, `film.end` | The time of the title card, the silence between scenes, the picture after the last gap, and the last moment of the film. |

- A cue ignores case and punctuation. A phrase that the voice does not say stops the build, with the name of the scene and the phrase. So does a phrase that the voice says two times in the scene: the message names the beats. Use a longer phrase, or name the beat: the last argument of `on` and `after`, and the option `beat` of `show`, `hide` and `swap`.
- The cue of `show`, `hide` and `swap` is a phrase, the id of a cue that the script declares, or the index of a beat for the start of that beat: `c.swap(1, firstList, secondList)`. Their options are `{ beat, lead, fade, stagger, skipShown, after }`, for the one cue that differs.
- A node shows one time. `c.show` brings a node that is not on the screen, so a node of `s.add`, of another cue or of a second list stops the build. `{ skipShown: true }` leaves such a node as it is and brings the rest of a block. It sees only what the scene did in the lines above the call. The fade of a node ends before its scene starts to leave, 0.24 seconds before the end of the scene, or the build stops.
- A cue is in the words that the voice says. When `pronounce` turns "800" into "eight hundred", the cue is `c.on('eight hundred', ...)`. `npx vizmatic narrated beats . --words question` prints the spoken words of a scene with their times.
- A cue is letters and digits, in any script: `c.cue('café')`, `c.cue('東京')` and `c.cue('3.5 stars')` work. A cue with no letter and no digit, such as `'%'`, stops the build: write the words that the voice says for the symbol, such as `'percent'`.

### A name before its phrase, a result after it

`c.show` starts before its phrase. That is right for a thing that the voice names: the viewer looks at it while the voice says its name. A result is different. A number that the voice computes must come when the voice has said it, or the picture gives the answer away. `{ after: true }` is for a result.

| | A thing that the voice names | A result that the voice reaches |
|---|---|---|
| The call | `c.show('the cache', box)` | `c.show('one hundred and sixty times', number, { after: true })` |
| The change starts | 0.1 seconds before the first word of the phrase | When the voice has said the last word of the phrase |
| The node is fully there | 0.2 seconds after the phrase starts | 0.3 seconds after the phrase ends |
| With the index of a beat, `c.show(1, ...)` | Starts 0.1 seconds before the take, or when the picture opens if that is later | Starts at the end of the take, before its hold |
| `lead` | Counts back from the start of the phrase. 0.1 by default. | Counts back from the end of the phrase. 0 by default. |

`c.hide` and `c.swap` take the same option: `c.swap('the answer', question, answer, { after: true })` changes the picture when the voice has said "the answer". `c.after('a phrase', build)` is the same moment for a play of your own.

When the last word ends with the recording, leave time for the result before the scene closes. In a nonfinal scene, a default show needs at least 0.54 seconds for its fade and the scene close. A default swap needs 0.74 seconds because the incoming picture waits another 0.2 seconds. A hold of about 1.5 seconds also gives the viewer time to read a short result.

## The kit

`sceneKit()` makes the frame and the labels that the scenes of one film share, in the font of the film. A film makes its kit once, in `scenes/kit.ts`, and each scene imports the helpers that it needs.

```typescript
import { sceneKit } from 'vizmatic/stage'

export const { area, heading, source, label, note, display, chip, claimTag } = sceneKit({ size: 44 })

/** One color has one job through the film. */
export const COLOR = { slow: 'red', fast: 'green', note: 'dim' } as const
```

One number sets every size. `size` is the size of a label, and its default is 36. A display line is 1.78 of it, the heading 1.44, a block of text and the name of a box 0.89, a chip 0.78, and a note, the source line and the claim tag 0.72. So a film for a phone raises `size`, and nothing stays small beside the labels. The other options are the edges of `area`, the place of `heading` and `source`, and the look of every `chip`. The kit follows the font that the film names in `narrated({ font })`, so the font is set in one place. A film can give one part its own size, such as `heading: { size: 70 }`, and each helper takes the options of the object that it makes, for the one place that differs.

| Helper | What it makes |
|---|---|
| `area` | The area that the content of a scene may fill, between the heading and the source line: `left`, `right`, `top`, `bottom`, `cx`, `cy`, `width`, `height`. It is a region of the [layout](layout.html): `area.columns([2, 1])`, `area.rows(3)`, `area.beside(picture, 'right')`. |
| `heading('One microVM')` | The heading of a scene, at its place in the frame. |
| `source('Firecracker docs, 2026')` | The source line of a scene, small and dim, under the area, from its left edge. |
| `claimTag(c, { word, note })` | A tag for the kind of the claim that is on screen, such as MEASURED, at the right end of the source line. |
| `label(text)`, `para(text, width)` | A label, and a block of text that wraps at a width, with no place: the layout places them. |
| `note(text)`, `display(text)` | A small dim note in the size of the source line, and the one large line of a picture, with no place. |
| `label(text, x, y)`, `left(...)`, `right(...)` | A label with its middle, its left edge, or its right edge at x, for a film that types its places. The three share a baseline on one y. |
| `para(text, x, y, width)` | A block of text with its left edge at x and its middle at y. |
| `textWidth(text, size)`, `fitSize(text, width, size)` | The width of a line, and the largest size at which a line fits a width. |
| `chip(text)`, `chipRow(items)` | A short label in a box that fits it, and a row of them. |
| `namedBox(name, { width, height })` | A box of a given size, with a name that is set smaller when it is too wide. |
| `card({ title, figure, caption })` | The card of the library, in the font of the film. |

Make a text with no x and no y, and let the layout place it: `place(column([label('requests'), chip('virtio')]), area, 'top left')`. A text helper also takes the place of its text, and an object such as a chip takes `.at(x, y)`, as every object of the library does. For a name of the code, give a label the mono font: `label('kvm_run', { font: 'mono', color: 'dim' })`.

`textWidth`, `fitSize`, `chip`, `chipRow`, `namedBox` and `card` are the functions of the library with the same names. The kit gives them the font and the look of the film as defaults, and runs the same code. Take them from the kit in a film: one line of text can be 379 pixels wide in the text font and 428 pixels wide in the default font of `text()`, so a measure in another font than the text is drawn in is wrong. Outside a kit, `textWidth` and `fitSize` need the font: `fitSize(name, 220, 40, { font: 'text-serif' })`.

### The claim tag

A claim tag says what kind of claim is on the screen: a measurement, a plan, an illustration. The call puts the tag on the stage, so the scene does not add it. The tag stays as long as the picture of its scene.

```typescript
// One state, for the whole scene.
claimTag(c, { word: 'MEASURED', note: 'our run of June, on 926 questions', color: 'green' })

// A tag that changes: each next state has the time when it starts.
claimTag(c, [
    { word: 'PLAN', note: 'the design of March' },
    { at: c.cue('we measured').start, word: 'MEASURED', color: 'green' },
])
```

- The fields of a state are `word`, `note`, `color`, `noteColor`, `size`, `font`, `noteFont`, `fill` and `at`. A field with another name is an error that names it.
- The tag ends at the right edge of the area, on the line of `source()`, which starts at the left edge. So the two do not meet. `{ place: 'top' }` puts the tag in the top right corner, at the height of the heading.
- `{ until: seconds }` takes the tag away before its scene ends.

### Chips and boxes

A tag, a chip and a row of chips take their width from their text, and they have one rule: `.at(x, y)` places the left end. `anchor: 'center'` places the middle, and `anchor: 'right'` the right end.

- A row wraps only when you give it `maxWidth`. Without it, the row is one line, however long.
- A row with `anchor: 'center'` has the middle of each line at x.

```typescript
const walls = chipRow(['KVM', 'seccomp', 'cgroups', 'namespaces'], { maxWidth: area.width }).at(area.left, 300)
const names = chipRow(['guest', 'host'], { anchor: 'center' }).at(area.cx, 300)
```

A row of chips is a set of names. For the stages of a process with one of them lit, use `steps` of the library, which gives the boxes one width and moves the light.

Two boxes of one size that stand side by side must have names of one size. Give each one the names of the group, and both get the size at which the longest name fits:

```typescript
const names = ['frontend', 'virtual machine monitor']
const boxes = names.map((name) => namedBox(name, { width: 300, height: 120, group: names }))
```

A check mark and a small picture of a kind of thing come from `pictogram`: `pictogram('check', { size: 40, accent: 'green' })`, and `pictogram('logs', { size: 96, color: 'dim', accent: 'yellow' })`. A plain panel behind other marks is `rect(640, 300, { radius: 16, fill: 'surface', stroke: 'grid' })`.

These helpers do not need a kit: `commas(21915584)` gives "21,915,584", `lerp`, `clamp` and `smoothstep` are for a `dynamic` drawing, `capHeight(size)` is the room to keep between a text and a line, and `seededRandom(seed)` gives the same numbers on every build.

### The numbers that the voice says

Keep the screen true. Put every number of the film in a file under `data/`, and assert each number that the voice says before the scene draws:

```typescript
import { assertEqual } from 'vizmatic/stage'
import { N } from './kit'

assertEqual(N.database.ms / N.cache.ms, 160, 'how many times faster the cache is')
```

`assertEqual` stops the build when the data and the narration do not agree. It compares lists and plain objects by their content. It is a part of the library, so the film also runs in `vizmatic preview`, which runs in a browser. Do not import a part of Node in a scene.

## The build

One command brings a film up to date, from the script to the movie:

```bash
npx vizmatic narrated build . --draft                  # dist/<name>-draft.mp4, fast, to look at
npx vizmatic narrated build . --draft --scene answer   # dist/<name>-draft-answer.mp4: one scene alone, faster
npx vizmatic narrated build .                          # dist/<name>.mp4: the delivered movie, at standard quality
npx vizmatic narrated build . --quality high           # the same movie for an upload: with motion blur, and slower
```

The delivered movie has the `standard` quality: the full size and frame rate, and a picture that looks the same as `high` in a film of fades and short moves. `high` adds motion blur and compresses less, and takes up to twice the time. Use it, or `master`, for the copy that goes to a video site.

The build runs these steps in the folder, in this order. It skips a step that has no work to do, says why, and stops at the first step that fails.

1. `voice` speaks each beat of the script. It keeps each take by the hash of its voice, its speed and its text, so only the beats that changed are made again. It writes `timing.json`. The build skips it when the script did not change.
2. `mix` lays the takes on the timeline, and adds a quiet pad and soft bell chimes. It writes `narration.wav`. The build skips it when the timing and the mix of `film.json` did not change.
3. `beats` prints where each beat starts and ends, when the timing is new.
4. `check` checks the layout of the film at rest and in every frame. A finding stops the build before the render, because a render takes minutes. `--allow-findings` builds with them.
5. The render writes the movie under its name, with the title, the chapters, and the captions inside it.
6. `record` writes `<name>.timing.json` beside the movie: the timing that its picture was rendered with.

A run with no change still runs the check, the render and the record: the picture has no cache, so the build cannot know that no scene file changed. It skips the voice, the mix and the beat list.

The build is made so that it cannot spoil a delivered movie:

- In `dist/`, a draft writes only files with "draft" in their name: the movie, its captions, its manifest, and the record of its timing. So no step of a draft writes to a file of the delivered movie there, and the last line of a build says which file it wrote and which one it left. A draft also brings `timing.json`, `audio/` and `narration.wav` up to date, which the delivered movie is made from too. An `output` in `film.json` that ends in `-draft` is refused, because the delivered movie would have the name of a draft.
- The build deletes the old record of a movie before it renders, and writes the new one after the render. So a build that stops at any point leaves a movie with no record, which `resound`, `sync` and `probe` refuse, and never a new picture beside the record of an old one.
- One run at a time works on a folder. A second `vizmatic narrated` command on the same folder stops, and names the run that holds the folder.
- The delivered movie always holds every scene. `--scene` is for a draft only, and a film file cannot ask for a part of the film.
- A step writes only inside the folder of the film.

Each step also runs alone: `npx vizmatic narrated <step> .`

| Step | What it does |
|---|---|
| `voice` | The voice and `timing.json`. |
| `draft` | A timing with estimated times and no sound, for a look at the scenes on a machine that has no voice model. It never replaces a measured timing: beside one, it writes `timing.draft.json`. |
| `mix` | The sound mix. |
| `check` | The layout check. It takes `--motion`, `--json`, `--content-top`, `--text-margin`, `--reading-speed` and `--stepped`. |
| `stills` | One full-size still for each beat. `--scene <id,...>` builds only those scenes, which is fast. `--frame`, `--name` and `--width` choose the times, the folder and the size. |
| `sheet` | Contact sheets. It takes `--every`, `--range`, `--frame`, `--columns`, `--width`, `--scene` and `--name`. |
| `beats` | Where each beat starts and ends. `--words <scene>` prints the spoken words. |
| `transcribe` | A transcript of each take, with the words that differ from the script. |
| `sync`, `lag` | If the picture and the voice of the rendered movie are in step with the timing. |
| `probe` | The streams, the chapters, the captions and the hash of the movie, and if its picture was rendered with this timing. |
| `resound` | A new `narration.wav` in the rendered movie, without a new render of the picture. |

- Before any step, the files of the film are checked in one place. A mistake in `film.json`, `script.json` or `timing.json` is one line: the file, the field, what is wrong, and what to do.
- An option that a step does not have is an error that names the options of the step.
- Each step ends with one line on the error stream: what passed, what did not, and the next command. A check that did not pass ends with a failure. The output of `check --json` and of `probe` is the data and nothing else.
- `sync`, `probe` and `resound` read the delivered movie. `--draft` reads the draft, and a path reads that movie.
- `--dry-run` checks the files, prints the steps of a command with the reason of each, and runs none.

### The particulars of a film

`film.json` holds what differs between two films. You change this file, and not a script.

```json
{
  "entry": "film.ts",
  "output": "A-Cache-in-Two-Scenes",
  "look": "midnight",
  "voice": { "name": "af_heart", "speed": 1.12 },
  "check": ["--text-margin", "30"],
  "render": { "workers": 6, "draftWorkers": 3 },
  "before": [["uv", "run", "data/make_numbers.py"]],
  "mix": { "seed": 7 }
}
```

Every key has a default. `output` is the name of the movie, and without it the movie has the name of the film file. `check` adds options to the check. `before` lists commands that run before the voice, such as one that computes the data of the film. `mix` is described below.

## Sound

The voice stays on top. A quiet pad sits under it, and a few bells mark the title and the end.

- The pad stays about 21 dB below the voice while the voice speaks. It rises to 15 dB below only in a pause longer than about 1 second, and to 10 dB below under the title card and after the last word.
- The pad has no loop. The chord changes where a beat of the narration starts, a seeded random walk picks each chord from nine, and each scene has its own texture. `seed` picks the walk. Without a seed, the name of the film picks it, so two films do not share their chords.
- A film can move the levels (`levels`), and place its own rises (`swells`) and bells (`chimes`). Each one names a time in the film, a share of the title card, or a beat, with a spoken word if you want. `tools/narration/README.md` in the package describes each key.
- Keep a bell away from a name. A transcript of one film heard a name wrong with a bell under it. A chime with `until` is silent from the time that you give.
- You cannot hear the mix, and an agent cannot either. `mix` prints the levels, and it writes the voice alone, the pad alone, and the mix under `stills/`. Its last line says how far the pad is under the voice, and says so when that is too near.
- When only the sound changed, `resound` puts the new `narration.wav` into the rendered movie. The picture is not rendered again.

`resound` must not put a sound into a picture that does not fit it, because the picture and the captions follow the voice. So it checks three things before it replaces a movie, and stops with one line when one of them is wrong:

1. `narration.wav` is the mix of the timing that `timing.json` holds now.
2. The picture was rendered with that timing. The build keeps the timing of a picture beside its movie, and the step compares the two scene by scene. A timing with the same length and other scene starts is another timing, and so is one with a hold that moved inside a scene. A movie with no record that is valid for its picture is refused: the chapters of a movie hold the starts of its scenes only, so they cannot say that a picture fits a timing. Build that movie again.
3. The new movie has every stream, the length, the chapters and the picture of the old one. Each run writes a file of its own, and one rename puts it in the place of the old movie.

When the picture does not fit, build again: the build renders the picture with the new timing.

## Check before a full render

A full render of a long film takes many minutes, and the command line cannot continue a render that stopped. Run these checks first.

1. **The voice.** `npx vizmatic narrated transcribe .` transcribes each take. A voice engine can say a word in a way that a listener hears as another word. Fix it with `pronounce`, and make the take again. A number that the transcript writes in digits or in words is not a difference.
2. **The layout.** `npx vizmatic narrated check .` reports marks off the frame, text on text, text near the edge of the frame, and lines across text, at the moments where the film comes to rest.
3. **The motion.** `npx vizmatic narrated check . --motion` also looks at every frame. It reports two sentences that share pixels while one replaces the other, and 0.2 seconds or more with nothing on screen.
4. **The reading time.** The same scan reports `film.text_brief`: a text that is up for less time than a viewer needs to read it, at 20 characters in one second. Add `--json` and read each one.
5. **Small text and empty space.** Two rules are off until the film asks for them, in the `check` list of `film.json`: `"check": ["--text-size", "26", "--empty-space", "0.5"]`. `film.text_small` reports text under 26 px on a frame that is 1080 high. `film.empty_space` reports more than a half of the frame that stays empty in one piece for 4 seconds or more. A build stops on their findings as on every finding. The [command line guide](cli.html) has what each rule counts.

A still cannot show how long a text stays up. A still at the end of a beat shows every text at full opacity, and the next beat can clear a text one second later. A scan of five delivered films found this defect in each of them: one film showed the result of a demonstration for half a second.

- Bring a text in at the start of the sentence that it supports, and not on its last words.
- For the last text of a beat, raise the `hold` of the beat in `script.json`.
- A row of data that scrolls past as texture is reported too. Leave it, and say so in the README of the film.

Fix each finding, or say in the README of the film why it stays.

## Check the picture

A contact sheet shows a frame at about a quarter of its size. It is good for the pace of a film, and it hides layout defects. The first cut of one film passed two reviews on contact sheets, and a viewer then found six defects on the screen.

So the review method is one full-size still for each beat:

```bash
npx vizmatic narrated stills .                  # every beat, 1920 wide, under stills/beats/
npx vizmatic narrated stills . --scene answer   # the beats of one scene, in a few seconds, under stills/answer/
```

Read each still at full size, one at a time. Read a crop at two times the size for each card, each boundary, and each small picture. Look for these defects:

- a mark outside its frame, or on its border
- text nearer to a figure or a border than the height of its own capital letters
- cards of one row with different layouts, and a figure that is not centered in its space
- a forecast or a continuation that does not start at the last point of what it continues
- a label that is larger than the shape that holds it
- a small picture that does not read as the thing that it stands for
- content in one corner while the rest of the frame is empty for the whole beat

Most of these have an object that prevents them. Do not draw a small picture by hand, and do not lay out a card by hand: use `pictogram(name)`, `card({ title, figure, caption })`, `zone(content, { title })` for a boundary around a group, `namedBox` for a name in a box, and `fitSize` for a label that must fit a shape.

Then read the whole film as contact sheets, for its pace: `npx vizmatic narrated sheet . --every 3`.

## After the render

1. `npx vizmatic narrated probe .` prints the streams, the chapters, and the caption count, and says what a narrated film has and this movie does not. A film of 1080p at 60 frames per second must report level 42 or lower, because QuickTime can refuse a higher level.
2. `npx vizmatic narrated sync .` compares the timing that the picture was rendered with and the timing of now, scene by scene. Then it transcribes the movie and compares the voice with the timeline. `lag` gives the lag of each take to a sample. Each one fails, and says why in its last line, when the movie is not in step.
3. Extract frames of the movie around each change of scene, and read them. An encoded movie can show a blank frame that a scan of the source missed.
4. Write the README of the film: its status, what it covers, how to build it, what was checked, and what was not checked. Record the hash of the movie with each review.

A check finds layout and encoding defects. It does not find a wrong explanation or a dull scene. Nobody has watched a film until a person watches the movie at full speed with sound. Say in the README if that has happened.

The [lesson reference](../references/lessons.md) has the rules for a film that teaches: the plan, the script, and the changes of picture.
