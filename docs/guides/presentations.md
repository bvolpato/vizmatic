---
title: Presentations
nav: Presentations
section: Ship
order: 1
description: A film with chapters is a talk. In stepped mode, the player stops at each chapter and waits for your key press.
---

## Chapters are steps

`s.chapter(title)` marks a point on the timeline. The player shows chapters as ticks on its timeline, and film pages list them.

With the `stepped` attribute, playback stops at each chapter. The right arrow key plays to the next chapter, and the left arrow key returns to the previous one.

```film open controls label="A short talk of three steps that stops at each chapter"
import { fadeIn, film, morphMatching, tex, text, write } from 'vizmatic/stage'

export default film({ title: 'A short talk' }, (s) => {
    s.chapter('The claim')
    const title = s.add(text('Why squares add up', { font: 'text-serif', size: 110 }).at(0, -300))
    s.play(fadeIn(title, { shift: [0, 24] }))
    const eq = s.add(tex('a^2 + b^2 = c^2', { size: 150 }))
    s.play(write(eq))
    s.wait(0.2)

    s.chapter('Rearrange')
    const next = tex('c^2 - a^2 = b^2', { size: 150 })
    s.play(morphMatching(eq, next))
    s.wait(0.2)

    s.chapter('Factor')
    const last = tex('(c - a)(c + a) = b^2', { size: 150 })
    s.play(morphMatching(next, last))
    s.wait(0.5)
})
```

Add the attribute when you embed the film.

```html
<vz-film src="./talk.js" stepped label="A short talk"></vz-film>
```

## Keep a larger look

For a room, use larger text and thicker strokes in the film itself, and keep one idea per chapter. Pair a film with a [dense figure](diagrams.md) only if people will read it afterwards.

## Keyboard

| Key | Action |
|---|---|
| Space or `k` | Play or pause. |
| Right arrow | Next step. Without `stepped`, seek forward 5 seconds. |
| Left arrow | Previous step. Without `stepped`, seek back 5 seconds. |
| `f` | Full screen. |

## Hand it out

Export the same film as an MP4 for people who missed the talk. Use `--frame` to get stills for the slides you still need.

```bash
npx vizmatic film talk.ts --out ./out --quality high
npx vizmatic film talk.ts --frame 2.5,7,12 --out ./stills
```
