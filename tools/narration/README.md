# Narration tools

These tools make the sound of a narrated film and check the result. `vizmatic narrated <step> <folder>` runs them. Each one also runs by itself with `uv run <tool>.py <folder>`, and declares its dependencies in its header. The guide is `docs/guides/narrated-films.md`.

| Tool | Step | What it does |
|---|---|---|
| `verify.py` | before every step | Checks `film.json`, `script.json`, and the timing against the script. Prints one line for each problem: the file, the field, what is wrong, and what to do. For a build, it also says if the voice and the mix are current, and why. |
| `voice.py` | `voice` | Speaks `script.json` with Kokoro on this machine. Writes one WAV for each beat under `audio/`, and `timing.json` with the time of each word and a fingerprint of what the voice was made from. A take that a run left empty is made again. |
| `draft.py` | `draft` | Writes a timing with estimated times and no sound, for a look at the scenes without the voice model. Beside a measured timing, it writes `timing.draft.json` and leaves `timing.json`. |
| `mix.py` | `mix` | Lays the takes on the timeline, adds the pad of `soundbed.py` and the chimes, and writes `narration.wav`. It writes `audio/mix.json`, which says what the mix was made from. |
| `beats.py` | `beats` | Prints where each beat starts and ends, or the spoken words of a scene with their times. |
| `transcribe.py` | `transcribe` | Transcribes each take with `faster-whisper` and shows the words that differ from the script. |
| `record.py` | a step of `build` | Writes `<name>.timing.json` beside a rendered movie: the timing that its picture was rendered with, and the hash of the picture. |
| `sync.py` | `sync` | Compares the timing of the picture of a movie with `timing.json`, scene by scene. Then it transcribes the sound of the movie and compares it with the timeline. |
| `lag.py` | `lag` | Finds the lag of each take in the rendered movie, to a sample. Run `sync.py` first. |
| `probe.py` | `probe` | Prints the streams, the chapters, the caption count and the hash of a movie, and if its picture was rendered with the timing of the folder. |
| `resound.py` | `resound` | Puts a new `narration.wav` into a rendered movie without a new render of the picture. |

`checks.py` holds the checks of the files, in one place. `film.py` holds what the tools share: the checked film, the place of each beat on the timeline, the records of a mix and of a picture, and how a tool reads its options. `soundbed.py` makes the pad.

- Every tool checks the files of the film before it does anything, so a mistake in a file is one line and never a stack. This holds for a `timing.json` that was changed by hand too.
- A tool refuses an option that it does not have.
- A tool ends with one line on the error stream: what passed, what did not, and the next command. A check that did not pass ends the tool with a failure.
- A step that reads the timing stops when the script changed after the voice was made. It names the beats that changed and the command to run.
- No tool writes outside the folder of the film. A scene id has letters, digits and hyphens. `resound` and `record` refuse a movie outside the folder.

## What keeps a delivered movie safe

The picture and the captions of a movie follow the voice. A sound of another timing in the same picture is a movie that is out of step, and no still shows it. So:

- The build keeps the timing of a picture beside its movie, as `<name>.timing.json`. The record has the hash of the video packets, so it does not count beside another render.
- `resound` puts a sound into a movie only when three things hold. `narration.wav` is the mix of the timing that `timing.json` holds now. The picture was rendered with that timing: the step compares the two scene by scene, so a timing with the same length and other scene starts is refused. And the new movie has every stream, the length, the chapters and the picture of the old one.
- A movie with no record that is valid for its picture is refused by `resound`, `sync` and `probe`, which say to build it again. A record is valid when it is whole and has the hash of the picture that is there. The chapters of a movie hold the starts of its scenes only, so they are no proof.
- The build deletes the old record before it renders, and `record` writes the new one after the render, with the hash of `timing.json` as it was before the render. So a build that stops at any point leaves a movie with no record.
- Each run of `resound` writes a file of its own beside the movie. One rename puts the checked file in the place of the old one. Two runs at once, such as one for the draft and one for the delivered movie, never write to one file.
- `sync` and `probe` fail on a movie whose picture was rendered with another timing, before any transcript.

## The voice stays on this machine

No text of the script and no sound leaves this machine. The voice model and the transcription model come from huggingface.co: a run that makes a take or a transcript asks that site for the model files, and downloads them the first time. Once they are on the disk, `HF_HUB_OFFLINE=1` stops every request. A voice run that makes no new take does not load the model.

## The two names of the first silence

In `script.json`, `timeline.pause` is the silence between the title card and the first word. In `timing.json`, `lead` is the time of the first word: the title card and the pause after it. The film and the sound mix both count from the start of the movie, so they read `lead`.

## The sound levels

- The pad stays about 21 dB below the voice while the voice speaks. `under` sets this, and its default is -22.
- The pad rises to 15 dB below the voice only in a pause longer than about 1 second. `pause` sets this.
- The pad rises to 10 dB below the voice under a title card and after the last word. `card` sets this. Each rise is one entry of `swells`.
- The pad has no loop. The chord changes where a beat of the narration starts, a seeded random walk picks each chord from nine, and each scene has its own texture. `seed` picks the walk. Without a seed, the name of the film picks it, so two films do not share their chords.
- An agent cannot hear the mix. `mix.py` prints the levels, and writes the voice alone, the pad alone and the mix before the loudness pass under `stills/`. Check the pitch of the pad in `stills/bed-only.wav`.

## The mix in film.json

```json
{
  "output": "Toto-Forecasting-a-Metric-It-Has-Never-Seen",
  "voice": { "name": "af_heart", "speed": 1.12 },
  "mix": {
    "seed": 23,
    "levels": { "under": -22, "pause": -15, "card": -10 },
    "swells": [
      { "scene": "hook", "beat": 6, "edge": "end", "offset": 1.0, "width": 2.0 },
      { "at": -3.4, "width": 2.6, "db": -9 }
    ],
    "chimes": [
      { "at": 0.15, "gain": 0.075 },
      { "scene": "hook", "beat": 6, "offset": 0.2 },
      { "scene": "close", "beat": -1, "edge": "end", "offset": 0.2, "gain": 0.1, "full": true }
    ]
  }
}
```

Every key has a default, so a film can leave out `voice` and `mix`. Without `swells`, the pad rises under the title card, and again a quarter of a second after the last word. Without `chimes`, a bell rings on the title card and a fuller chord rings after the last word.

A swell and a chime each name a time in one of three ways:

- `"at": 12.5` is a time in the film, in seconds. A negative value counts from the end of the film.
- `"intro": 0.5` is a share of the title card: 0.5 is its middle.
- `"scene": "hook", "beat": 6` is a beat. `scene` is an id, or a place in the film such as `0` and `-1`. `beat` counts from 0, and from the end when it is negative. The time is the start of the beat, the end of its voice with `"edge": "end"`, or the start of a spoken word with `"word": "Project"`. With `"last": true`, it is the last time that the beat says the word.

`"offset"` moves the time, in seconds.

A swell also takes `width` (seconds, 2.0 by default), `db` (the level at its top, below the voice, `card` by default), and `after` (a time: the swell is silent before it, so that it does not start under the last words).

A chime also takes `gain` (0.11 by default), `notes` (three frequencies in hertz), `full` (a second, lower bell, for the last card), and `until` (a time: the bell fades over half a second and is silent from then on). Use `until` when a name follows a chime: a transcript of one film heard a name wrong with a bell under it.
