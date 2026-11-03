---
title: Embedding the player
nav: Embedding
section: Ship
order: 3
description: Drop a live, seekable film into any page with one element. It is crisp at any zoom and loads when it scrolls near.
---

## The element

`<vz-film>` plays a compiled film. Importing `vizmatic/stage/browser` registers the element. Bundle your film with it, and then add the element to your page.

```html
<script type="module" src="./stage.js"></script>
<vz-film src="./my-film.js" autoplay loop label="A curve becomes its tangent"></vz-film>
```

The element compiles the film when it scrolls within reach, pauses when it leaves the screen, and honors `prefers-reduced-motion` by showing the final frame.

Your film and the engine must share one module, because that module holds the timeline clock. A bundler with code splitting does this for you.

## Attributes

| Attribute | Meaning |
|---|---|
| `src` | The URL of a module whose default export is a film. |
| `autoplay` | Play when visible. |
| `loop` | Start again at the end. |
| `stepped` | Stop at each chapter. See [Presentations](presentations.md). |
| `nocontrols` | Hide the controls. |
| `start` | Start at this time in seconds. |
| `look` | Compile in this look, such as `paper`. |
| `background` | Replace the look's background, so the film sits directly on your page. |
| `label` | The text alternative for assistive technology. Always set this. |

## Events

| Event | Detail |
|---|---|
| `ready` | `{ film, player }`, once the film is compiled. |
| `timeupdate` | `{ time }`, on every painted frame. |
| `error` | `{ error }`, if the film fails to load. The element also shows the message. |

## Drive it from your page

`element.controller` is a `FilmPlayer`. Its `seek` method is cheap enough to call on every scroll event. This is how the home page works.

```ts
export function scrubWithScroll(section: HTMLElement, element: HTMLElement & { controller: { seek(time: number): void; film: { duration: number } } | null }): void {
    window.addEventListener('scroll', () => {
        const box = section.getBoundingClientRect()
        const amount = Math.min(1, Math.max(0, -box.top / (box.height - innerHeight)))
        const player = element.controller
        if (player) player.seek(amount * player.film.duration)
    }, { passive: true })
}
```

## Without the element

Use `FilmPlayer` on your own canvas when you want your own controls.

```ts
import { compileFilm, FilmPlayer, film, text, write } from 'vizmatic/stage/browser'

const intro = film((s) => {
    s.play(write(s.add(text('Hello', { font: 'text-serif', size: 200 }))))
})

export async function mount(canvas: HTMLCanvasElement): Promise<FilmPlayer> {
    return new FilmPlayer(canvas, await compileFilm(intro), { autoplay: true, loop: true })
}
```

## Take input

Because a frame is computed when it is needed, a film can read from your page. Put your state in plain variables, read them in a `dynamic` node, and call `player.seek(player.time)` when they change. The [matrix laboratory](../index.html#lab) on the home page works this way.

## Fonts

In the browser, the engine fetches TrueType fonts from an `assets/fonts` folder beside its module. Call `setAssetBase(url)` if they live elsewhere.
