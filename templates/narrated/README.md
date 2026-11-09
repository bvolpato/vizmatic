# A cache, in two scenes

A narrated film of about 25 seconds, made from the `narrated` template of Vizmatic. Replace this paragraph: say what the film explains, who it is for, and how long it is.

## Status

- The film is not rendered yet. `timing.json` is a draft with estimated times, and the first build replaces it with the measured voice.
- After a render, write here: the path of the movie, its size, and its SHA-256 (`npx vizmatic narrated probe .` prints them).
- Say who wrote the film and who reviewed it. Say if a person watched the movie at full speed with sound.
- Say if the film is public or internal, and which facts have no public source.

## What it covers

The start times are the chapter marks of the movie. `npx vizmatic narrated beats .` prints them.

| Chapter | Starts | Content |
|---|---|---|
| The slow page | 0:00 | The title card, then one page that takes 800 ms to build, and the question. |
| Keep the answer | 0:13 | The same request from a cache, to the same scale, and the ratio. |

## Files

| Path | Purpose |
|---|---|
| `script.json` | What the voice says: one entry for each scene and beat, the chapter title of each scene, the `timeline` (title card, pause, gap and tail, in seconds), and the `pronounce` map. |
| `film.json` | The particulars of this film: the name of the movie, the voice, and the seed and the levels of the sound mix. |
| `film.ts` | The film: its title, the words of its title card, and one function for each scene of the script. |
| `scenes/kit.ts` | What the scenes share: the labels, the colors, and the numbers. |
| `scenes/*.ts` | One file for each scene. Each file asserts the numbers that the voice says before it draws. |
| `data/numbers.json` | Every number on screen. |
| `sources.md` | One entry for each fact in the narration, with its source. |
| `timing.json`, `audio/` | The measured voice. The build writes them. Git ignores `audio/`. |

## How to build

The film uses Vizmatic for the picture, Kokoro for the voice, `faster-whisper` to check the voice, and FFmpeg. The voice and the check run on this machine, so the script is not sent to a service. The first run downloads the two models from huggingface.co, and `HF_HUB_OFFLINE=1` stops every request after that. The build needs `uv` and `ffmpeg`.

One command brings the film up to date, from the script to the movie. It makes the voice of the beats that changed, the sound mix, the layout check and the render, and it says why it runs or skips each step.

```bash
npx vizmatic narrated build . --draft                  # dist/A-Cache-in-Two-Scenes-draft.mp4, to look at
npx vizmatic narrated build . --draft --scene answer   # one scene alone, faster
npx vizmatic narrated build .                          # dist/A-Cache-in-Two-Scenes.mp4, at high quality: the delivered movie
```

In `dist/`, a draft writes only files with "draft" in their name, so it never replaces the delivered movie. It also brings `timing.json` and `narration.wav` up to date. The single steps are `voice`, `mix`, `check`, `stills`, `sheet`, `beats`, `transcribe`, `sync`, `lag`, `probe` and `resound`. `npx vizmatic narrated` lists them.

## Checks

Write what was checked, with the command and the result. Do not write a check that was not run.

- [ ] `npx vizmatic narrated check . --motion`: no error, and each warning is fixed or explained here.
- [ ] `npx vizmatic narrated transcribe .`: each take says the words of the script.
- [ ] `npx vizmatic narrated stills .`: one full-size still for each beat was read, one at a time.
- [ ] `npx vizmatic narrated sync .` and `lag`: the voice in the movie is at the planned times.
- [ ] `npx vizmatic narrated probe .`: the streams, the chapters and the captions of the movie.

## What is not checked

Write what nobody verified, so that a reader does not assume it. For example: no person watched the film, a source was not opened, or a number comes from one run.
