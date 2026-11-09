import { paintFrame, type Frame } from './display'
import { applyBloom, createBloomLayers, type BloomLayer } from './bloom'
import { Suspend, type CompiledFilm } from './stage'
import type { StageImage } from './node'
import { browserImageSource, ImageAssetError } from './image'

export interface PlayerOptions {
    loop?: boolean
    autoplay?: boolean
    speed?: number
    /** Stop at each chapter and wait for `play()` or `next()`. Use it for presentations. */
    stepped?: boolean
    /** Device pixels per CSS pixel. Defaults to the display's ratio, capped for speed. */
    pixelRatio?: number
    onTime?: (time: number) => void
    onState?: (state: { playing: boolean }) => void
}

/** Plays a compiled film on a canvas. Seeking is instant, in either direction. */
export class FilmPlayer {
    film: CompiledFilm
    readonly canvas: HTMLCanvasElement
    private readonly ctx: CanvasRenderingContext2D
    private readonly options: PlayerOptions
    private raf = 0
    private last = 0
    private currentTime = 0
    private playing = false
    private scale = 1
    private bloomLayers: BloomLayer[] = []
    private observer: ResizeObserver | null = null
    speed: number

    constructor(canvas: HTMLCanvasElement, film: CompiledFilm, options: PlayerOptions = {}) {
        this.canvas = canvas
        this.film = film
        this.options = options
        this.speed = options.speed ?? 1
        const ctx = canvas.getContext('2d', { alpha: film.background === null })
        if (!ctx) throw new Error('This browser could not create a 2D canvas.')
        this.ctx = ctx
        this.resize()
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.resize())
            this.observer.observe(canvas)
        }
        this.paint()
        if (options.autoplay) this.play()
    }

    get time(): number {
        return this.currentTime
    }

    get isPlaying(): boolean {
        return this.playing
    }

    /** Replace the film with one of the same size, such as after an edit. The time stays. */
    swap(film: CompiledFilm): void {
        const sizeChanged = film.width !== this.film.width || film.height !== this.film.height
        this.film = film
        if (sizeChanged) {
            this.bloomLayers = []
            this.resize()
        }
        this.paint()
    }

    /** Match the canvas buffer to its displayed size. */
    resize(): void {
        const rect = this.canvas.getBoundingClientRect()
        const ratio = this.options.pixelRatio ?? Math.min(2, globalThis.devicePixelRatio || 1)
        const cssWidth = rect.width || this.film.width
        const width = Math.max(2, Math.round(cssWidth * ratio))
        const height = Math.max(2, Math.round(width * this.film.height / this.film.width))
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width
            this.canvas.height = height
            this.bloomLayers = []
        }
        this.scale = width / this.film.width
        if (!this.playing) this.paint()
    }

    play(): void {
        if (this.playing) return
        if (this.currentTime >= this.film.duration - 1e-6) this.currentTime = 0
        this.playing = true
        this.last = performance.now()
        this.options.onState?.({ playing: true })
        this.raf = requestAnimationFrame(this.tick)
    }

    pause(): void {
        if (!this.playing) return
        this.playing = false
        cancelAnimationFrame(this.raf)
        this.options.onState?.({ playing: false })
    }

    toggle(): void {
        if (this.playing) this.pause()
        else this.play()
    }

    seek(time: number): void {
        this.currentTime = Math.max(0, Math.min(this.film.duration, time))
        this.paint()
        this.options.onTime?.(this.currentTime)
    }

    /** Jump to the next chapter boundary, or to the end. */
    next(): void {
        const after = this.film.chapters.find((chapter) => chapter.time > this.currentTime + 1e-3)
        this.seek(after ? after.time : this.film.duration)
    }

    previous(): void {
        const before = [...this.film.chapters].reverse().find((chapter) => chapter.time < this.currentTime - 0.25)
        this.seek(before ? before.time : 0)
    }

    destroy(): void {
        this.pause()
        this.observer?.disconnect()
    }

    private readonly tick = (now: number): void => {
        if (!this.playing) return
        // The first animation timestamp can be slightly older than the play() call.
        // A negative step would rewind past a chapter at time 0 and stop stepped playback there.
        const delta = Math.max(0, Math.min(0.1, (now - this.last) / 1000))
        this.last = now
        const before = this.currentTime
        let next = before + delta * this.speed
        if (this.options.stepped) {
            const boundary = this.film.chapters.find((chapter) => chapter.time > before + 1e-3 && chapter.time <= next)
            if (boundary) {
                this.currentTime = boundary.time
                this.paint()
                this.options.onTime?.(this.currentTime)
                this.pause()
                return
            }
        }
        if (next >= this.film.duration) {
            if (this.options.loop) next %= this.film.duration
            else {
                this.currentTime = this.film.duration
                this.paint()
                this.options.onTime?.(this.currentTime)
                this.pause()
                return
            }
        }
        this.currentTime = next
        this.paint()
        this.options.onTime?.(this.currentTime)
        this.raf = requestAnimationFrame(this.tick)
    }

    private lookupImage = (image: StageImage): CanvasImageSource | null => {
        const element = browserImageSource(image.asset)
        if (!element) throw new ImageAssetError('The film image was not preloaded before playback.')
        return element
    }

    private paint(): void {
        let frame: Frame
        try {
            frame = this.film.frame(this.currentTime)
        } catch (error) {
            if (error instanceof Suspend) {
                void error.promise.then(() => this.paint())
                return
            }
            throw error
        }
        paintFrame(this.ctx, frame, this.scale, this.lookupImage)
        if (frame.bloom > 0 && frame.dark) this.applyBloom(frame)
    }

    /** The recipe is in `bloom.ts`, and the Node export calls the same function. */
    private applyBloom(frame: Frame): void {
        const { width, height } = this.canvas
        if (this.bloomLayers.length === 0) {
            this.bloomLayers = createBloomLayers(width, height, (layerWidth, layerHeight) => {
                const canvas = document.createElement('canvas')
                canvas.width = layerWidth
                canvas.height = layerHeight
                return canvas
            })
        }
        applyBloom(this.ctx, this.canvas, width, height, frame, this.bloomLayers)
    }
}

/** Per-element overrides for `<vz-film look="paper" background="#f7f3ea">`. */
export interface FilmLoadOptions {
    look?: string
    background?: string
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}

const PLAYER_CSS = `
:host { display: block; position: relative; background: #0b0c10; border-radius: inherit; overflow: hidden; font: 12px/1 ui-monospace, "JetBrains Mono", monospace; color: #f2efe6; aspect-ratio: var(--vz-aspect, 16 / 9); }
canvas { display: block; width: 100%; height: 100%; }
.chrome { position: absolute; inset: auto 0 0 0; display: flex; align-items: center; gap: 12px; padding: 28px 14px 12px; background: linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0)); opacity: 0; transition: opacity .18s ease; }
:host(:hover) .chrome, :host(:focus-within) .chrome, :host([data-paused]) .chrome { opacity: 1; }
:host([nocontrols]) .chrome { display: none; }
button { all: unset; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
button:hover { background: rgba(255,255,255,.12); }
.track { position: relative; flex: 1; height: 16px; cursor: pointer; touch-action: none; }
.track::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 2px; background: rgba(255,255,255,.26); border-radius: 2px; }
.fill { position: absolute; left: 0; top: 7px; height: 2px; background: #f2efe6; border-radius: 2px; }
.tick { position: absolute; top: 4px; width: 1px; height: 8px; background: rgba(255,255,255,.55); }
.time { font-variant-numeric: tabular-nums; opacity: .82; white-space: nowrap; }
svg { width: 14px; height: 14px; fill: currentColor; }
`

const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>'
const ICON_FULL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4v1.5H3.5V6zM10 2h4v4h-1.5V3.5H10zM2 10h1.5v2.5H6V14H2zM12.5 10H14v4h-4v-1.5h2.5z"/></svg>'

/**
 * `<vz-film src="./my-film.js" autoplay loop></vz-film>`
 *
 * Embeds a live, seekable film. It compiles when scrolled near, pauses when out
 * of view, and honors prefers-reduced-motion by showing the final frame.
 */
export function defineFilmElement(load: (src: string, options?: FilmLoadOptions) => Promise<CompiledFilm>, name = 'vz-film'): void {
    if (typeof customElements === 'undefined' || customElements.get(name)) return
    class VzFilm extends HTMLElement {
        private player: FilmPlayer | null = null
        private visible = false
        private started = false
        private wantsPlay = false
        private intersection: IntersectionObserver | null = null
        private keys: AbortController | null = null

        connectedCallback(): void {
            // Moving an element in the DOM disconnects it first, so a reconnect rebuilds from scratch.
            const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
            const rawLabel = this.getAttribute('label') ?? 'Animation'
            root.innerHTML = `<style>${PLAYER_CSS}</style><canvas role="img"></canvas><div class="chrome"><button class="toggle" type="button" aria-label="Play">${ICON_PLAY}</button><div class="track" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0"><div class="fill"></div></div><span class="time">0:00</span><button class="full" type="button" aria-label="Full screen">${ICON_FULL}</button></div>`
            root.querySelector('canvas')!.setAttribute('aria-label', rawLabel)
            this.setAttribute('data-paused', '')
            this.intersection = new IntersectionObserver((entries) => {
                this.visible = entries.some((entry) => entry.isIntersecting)
                if (this.visible && !this.started) void this.start()
                if (this.player) {
                    if (!this.visible && this.player.isPlaying) {
                        this.wantsPlay = true
                        this.player.pause()
                    } else if (this.visible && this.wantsPlay) {
                        this.wantsPlay = false
                        this.player.play()
                    }
                }
            }, { rootMargin: '240px' })
            this.intersection.observe(this)
        }

        disconnectedCallback(): void {
            this.intersection?.disconnect()
            this.player?.destroy()
            this.player = null
            this.started = false
        }

        /** The underlying player, once loaded. */
        get controller(): FilmPlayer | null {
            return this.player
        }

        private async start(): Promise<void> {
            this.started = true
            const src = this.getAttribute('src')
            if (!src) return
            const root = this.shadowRoot!
            let film: CompiledFilm
            try {
                film = await load(src, {
                    look: this.getAttribute('look') ?? undefined,
                    background: this.getAttribute('background') ?? undefined,
                })
            } catch (error) {
                // A silent failure leaves a blank box, so say what went wrong.
                const message = error instanceof Error ? error.message : String(error)
                console.error(`vz-film: could not load ${src}:`, error)
                const notice = document.createElement('div')
                notice.setAttribute('role', 'alert')
                notice.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;line-height:1.5;color:#ff8d8d'
                notice.textContent = `This film could not load: ${message}`
                root.append(notice)
                this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
                return
            }
            this.style.setProperty('--vz-aspect', `${film.width} / ${film.height}`)
            const canvas = root.querySelector('canvas')!
            const toggle = root.querySelector<HTMLElement>('.toggle')!
            const fill = root.querySelector<HTMLElement>('.fill')!
            const time = root.querySelector<HTMLElement>('.time')!
            const track = root.querySelector<HTMLElement>('.track')!
            const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
            const autoplay = this.hasAttribute('autoplay') && !reduced
            track.setAttribute('aria-valuemax', String(Math.round(film.duration)))
            for (const chapter of film.chapters) {
                if (chapter.time <= 0) continue
                const tick = document.createElement('div')
                tick.className = 'tick'
                tick.style.left = `${(chapter.time / film.duration) * 100}%`
                track.append(tick)
            }
            const onTime = (t: number) => {
                fill.style.width = `${(t / film.duration) * 100}%`
                time.textContent = `${formatTime(t)} / ${formatTime(film.duration)}`
                track.setAttribute('aria-valuenow', String(Math.round(t)))
                this.dispatchEvent(new CustomEvent('timeupdate', { detail: { time: t } }))
            }
            const player = new FilmPlayer(canvas, film, {
                loop: this.hasAttribute('loop'),
                stepped: this.hasAttribute('stepped'),
                onTime,
                onState: ({ playing }) => {
                    toggle.innerHTML = playing ? ICON_PAUSE : ICON_PLAY
                    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play')
                    if (playing) this.removeAttribute('data-paused')
                    else this.setAttribute('data-paused', '')
                },
            })
            this.player = player
            const startAt = this.getAttribute('start')
            if (reduced && !this.hasAttribute('start')) player.seek(film.duration)
            else if (startAt) player.seek(Number(startAt))
            else onTime(0)
            toggle.addEventListener('click', () => player.toggle())
            canvas.addEventListener('click', () => player.toggle())
            root.querySelector('.full')!.addEventListener('click', () => {
                if (document.fullscreenElement) void document.exitFullscreen()
                else void this.requestFullscreen()
            })
            const seekFrom = (event: PointerEvent) => {
                const rect = track.getBoundingClientRect()
                player.seek(((event.clientX - rect.left) / rect.width) * film.duration)
            }
            track.addEventListener('pointerdown', (event) => {
                track.setPointerCapture(event.pointerId)
                seekFrom(event)
                const move = (next: PointerEvent) => seekFrom(next)
                track.addEventListener('pointermove', move)
                track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true })
            })
            // A page can opt a decorative film out of the tab order with tabindex="-1".
            if (!this.hasAttribute('tabindex')) this.tabIndex = 0
            this.keys?.abort()
            this.keys = new AbortController()
            this.addEventListener('keydown', (event) => {
                // Shortcuts such as Command+K belong to the page.
                if (event.metaKey || event.ctrlKey || event.altKey) return
                if (event.key === ' ' || event.key === 'k') {
                    event.preventDefault()
                    player.toggle()
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    if (this.hasAttribute('stepped')) player.play()
                    else player.seek(player.time + 5)
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    if (this.hasAttribute('stepped')) player.previous()
                    else player.seek(player.time - 5)
                } else if (event.key === 'f') {
                    if (document.fullscreenElement) void document.exitFullscreen()
                    else void this.requestFullscreen()
                }
            }, { signal: this.keys.signal })
            if (autoplay && this.visible) player.play()
            else if (autoplay) this.wantsPlay = true
            this.dispatchEvent(new CustomEvent('ready', { detail: { film, player } }))
        }
    }
    customElements.define(name, VzFilm)
}
