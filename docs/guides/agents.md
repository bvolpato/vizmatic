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

`vizmatic objects --json` and `vizmatic looks --json` list what is available in the installed version.

## Why the source suits an agent

- A film is one function, with no framework state to hold in mind.
- Layout helpers such as `nextTo`, `alignTo`, and `arrange` replace hand-tuned coordinates.
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
