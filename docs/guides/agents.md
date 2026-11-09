---
title: For agents
nav: For agents
section: Ship
order: 5
description: Vizmatic suits coding agents. Sources are plain text, output is deterministic, and problems come back as JSON.
---

## A loop that works

An agent cannot watch a video, so the loop relies on checks and stills.

1. Write the film as a TypeScript file.
2. Run `vizmatic check --json` and fix what it reports.
3. Render stills with `--frame` at the moments that matter, and look at them.
4. Export the MP4 when the stills are right.

```bash
npx vizmatic check intro.ts --json
npx vizmatic film intro.ts --frame 2,6,12 --width 1280 --out ./stills
npx vizmatic film intro.ts --quality high --out ./out
```

The check inspects moments of rest. It misses a crossfade where two sentences overlap and a blank gap between two pictures. Add `--motion` to inspect every frame, and judge each warning that it reports. Then extract frames from the MP4 around each change of picture, and read them.

## Films that teach

A lesson needs more than a clean check. [The lesson reference](../references/lessons.md) covers the plan, computed numbers, narration, changes of picture, a frame scan, delivery, and review. An agent cannot judge a lesson at full speed, so a person must watch it with sound before it is published.

[Finished films](../films.html) show the full source for each topic. The package includes them in `examples/films/`.

The package also computes some mechanisms for you, with helpers such as `weightedVectorState` and `tokenHistoryState`. A film can import them from `vizmatic` for `check` and `film`, but `preview` refuses that import because it runs in the browser. [The canvas guide](tsx-animation.html) covers the same constructions for a checked canvas host.

## Install the skill

The portable skill teaches an agent the workflow and the API. See the [agent page](../agents.html) for plugin installs.

```bash
npx skills add bvolpato/vizmatic --skill vizmatic -g -y
```

## Machine-readable docs

| File | Contents |
|---|---|
| [llms.txt](../llms.txt) | A short index with canonical links. |
| [llms-full.txt](../llms-full.txt) | The prompt and the whole component catalog. |
| [components.json](../components.json) | Component metadata, source, and builder links. |
| [PROMPT.md](../PROMPT.md) | The full task prompt and API guidance. |
| [references/films.md](../references/films.md) | Engine rules, patterns, check codes, and common mistakes. |
| [references/lessons.md](../references/lessons.md) | How to plan, narrate, scan, and deliver a film that teaches. |

`vizmatic objects --json` and `vizmatic looks --json` list what is available in the installed version.

## Why the source suits an agent

- A film is one function, with no framework state to hold in mind.
- Layout with no typed coordinate: `row`, `column`, `grid`, `place`, and `beside` measure the nodes and place them.
- Color names come from the look, so an agent does not choose hex values.
- `checkFilm` is also a function, so a test can fail when a label leaves the frame.

```ts
import { checkFilm, film, text } from 'vizmatic/stage'

const draft = film((s) => {
    s.add(text('A title that is much too wide for this frame', { size: 300 }))
    s.wait(1)
})

export async function report(): Promise<string[]> {
    const result = await checkFilm(draft)
    return result.diagnostics.map((item) => `${item.code} at ${item.time.toFixed(1)} s: ${item.message}`)
}
```
