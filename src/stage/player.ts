import { paintCanvasBloom, type CanvasBloom } from './bloom-canvas'
import { createWebGLBloomPresenter, supportsWebGLBloom, type WebGLBloomPresenter } from './bloom-webgl'
import { parseColor } from './color'
import { paintFrame, type Frame } from './display'
import { isSuspend, type CompiledFilm } from './stage'
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
    /** Maximum backing-store width in pixels when `pixelRatio` is not forced. Defaults to the film's authored width (or 1280 on CPU bloom fallback). */
    maxWidth?: number
    /** Paint bloom onto the canvas. Set false when a caller averages subframes before blooming. */
    bloom?: boolean
    /** Optional sibling WebGL canvas for zero-copy direct bloom presentation (used by `<vz-film>`). */
    presentCanvas?: HTMLCanvasElement
    onTime?: (time: number) => void
    onSeek?: (time: number) => void
    onState?: (state: { playing: boolean }) => void
}

/** Plays a compiled film on a canvas. Seeking is instant, in either direction. */
export class FilmPlayer {
    film: CompiledFilm
    readonly canvas: HTMLCanvasElement
    private readonly ctx: CanvasRenderingContext2D
    private readonly options: PlayerOptions
    private readonly presentCanvas: HTMLCanvasElement | null
    private presenter: WebGLBloomPresenter | null | undefined = undefined
    private presentingBloom = false
    private bloomBgKey: string | null = null
    private bloomBgColor: readonly number[] = [0, 0, 0]
    private readonly gpuBloom: boolean
    private raf = 0
    private last = 0
    private currentTime = 0
    private playing = false
    private playbackSeq = 0
    private destroyed = false
    private pendingPaint: { promise: Promise<unknown> } | null = null
    private scale = 1
    private bloomState: CanvasBloom | null = null
    private lastFrame: Frame | null = null
    private observer: ResizeObserver | null = null
    private dprMedia: MediaQueryList | null = null
    private readonly onDprChange = (): void => {
        this.watchDpr()
        this.resize()
    }
    speed: number

    constructor(canvas: HTMLCanvasElement, film: CompiledFilm, options: PlayerOptions = {}) {
        this.canvas = canvas
        this.film = film
        this.options = options
        this.presentCanvas = options.presentCanvas ?? null
        this.speed = options.speed ?? 1
        this.gpuBloom = supportsWebGLBloom(canvas)
        const ctx = canvas.getContext('2d', { alpha: film.background === null, willReadFrequently: !this.gpuBloom })
        if (!ctx) throw new Error('This browser could not create a 2D canvas.')
        this.ctx = ctx
        this.resizeCanvas()
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this.resize())
            this.observer.observe(canvas)
        }
        this.watchDpr()
        this.paint()
        if (options.autoplay) this.play()
    }

    private watchDpr(): void {
        this.dprMedia?.removeEventListener?.('change', this.onDprChange)
        this.dprMedia = null
        if (this.destroyed || this.options.pixelRatio !== undefined || typeof matchMedia !== 'function') return
        const ratio = globalThis.devicePixelRatio || 1
        const media = matchMedia(`(resolution: ${ratio}dppx)`)
        media.addEventListener?.('change', this.onDprChange, { once: true })
        this.dprMedia = media
    }

    get time(): number {
        return this.currentTime
    }

    get isPlaying(): boolean {
        return this.playing
    }

    /** Replace the film with one of the same size, such as after an edit. The time stays. */
    swap(film: CompiledFilm): void {
        if (this.destroyed) return
        const sizeChanged = film.width !== this.film.width || film.height !== this.film.height
        this.pendingPaint = null
        this.lastFrame = null
        this.film = film
        if (sizeChanged) {
            this.bloomState = null
            this.resizeCanvas()
        }
        this.paint()
    }

    /** Replace the compiled film while preserving playhead (clamped to [0, duration]) and play state. */
    setFilm(film: CompiledFilm): void {
        if (this.destroyed) return
        this.pendingPaint = null
        this.lastFrame = null
        this.film = film
        this.currentTime = Math.max(0, Math.min(film.duration, this.currentTime))
        this.bloomState = null
        this.resizeCanvas()
        this.paint()
        this.options.onTime?.(this.currentTime)
    }

    /** Match the canvas buffer to its displayed size. */
    resize(): void {
        if (this.destroyed) return
        if (this.resizeCanvas()) {
            this.lastFrame = null
            this.paint()
        }
    }

    private resizeCanvas(): boolean {
        const rect = this.canvas.getBoundingClientRect()
        if (this.options.pixelRatio === undefined && this.canvas.isConnected && rect.width === 0 && rect.height === 0) {
            return false
        }
        const ratio = this.options.pixelRatio ?? Math.min(2, globalThis.devicePixelRatio || 1)
        const cssWidth = rect.width || this.film.width
        let width = Math.max(2, Math.round(cssWidth * ratio))
        if (this.options.pixelRatio === undefined) {
            const baseCap = this.options.maxWidth ?? Math.max(this.film.width, 1920)
            const cpuBloomFallback = this.options.bloom !== false && Boolean(this.film.look?.dark) && this.film.bloom > 0 && !this.gpuBloom
            const cap = cpuBloomFallback ? Math.min(baseCap, 1280) : baseCap
            if (width > cap) width = cap
        }
        const height = Math.max(2, Math.round(width * this.film.height / this.film.width))
        const bufferChanged = this.canvas.width !== width || this.canvas.height !== height
        if (bufferChanged) {
            this.canvas.width = width
            this.canvas.height = height
            this.bloomState = null
        }
        const scale = width / this.film.width
        const scaleChanged = this.scale !== scale
        this.scale = scale
        return bufferChanged || scaleChanged
    }

    play(): void {
        if (this.destroyed || this.playing) return
        if (this.currentTime >= this.film.duration - 1e-6) this.currentTime = 0
        this.playing = true
        const seq = ++this.playbackSeq
        this.last = performance.now()
        this.options.onState?.({ playing: true })
        if (this.playing && seq === this.playbackSeq) this.raf = requestAnimationFrame(this.tick)
    }

    pause(): void {
        if (!this.playing) return
        this.playing = false
        this.playbackSeq++
        cancelAnimationFrame(this.raf)
        this.raf = 0
        this.options.onState?.({ playing: false })
    }

    toggle(): void {
        if (this.playing) this.pause()
        else this.play()
    }

    /** A prepared frame must come from this film at the clamped seek time. */
    seek(time: number, prepared?: Frame): void {
        if (this.destroyed || !Number.isFinite(time)) return
        this.currentTime = Math.max(0, Math.min(this.film.duration, time))
        this.lastFrame = null
        this.paint(prepared)
        this.options.onSeek?.(this.currentTime)
        this.options.onTime?.(this.currentTime)
    }

    /** Jump to the next chapter boundary, or to the end. */
    next(): void {
        const after = this.film.chapters.find((chapter) => chapter.time > this.currentTime)
        this.seek(after ? after.time : this.film.duration)
    }

    previous(): void {
        const before = [...this.film.chapters].reverse().find((chapter) => chapter.time < this.currentTime - 0.25)
        this.seek(before ? before.time : 0)
    }

    destroy(): void {
        if (this.destroyed) return
        this.destroyed = true
        this.pendingPaint = null
        this.lastFrame = null
        this.pause()
        this.observer?.disconnect()
        this.observer = null
        this.dprMedia?.removeEventListener?.('change', this.onDprChange)
        this.dprMedia = null
        this.presenter?.dispose()
        this.presenter = null
        this.setDirectBloomVisible(false)
    }

    private setDirectBloomVisible(active: boolean): void {
        if (!this.presentCanvas || this.presentingBloom === active) return
        this.presentingBloom = active
        this.presentCanvas.hidden = !active
        if (this.canvas.style) this.canvas.style.opacity = active ? '0' : ''
    }

    private readonly tick = (now: number): void => {
        if (!this.playing) return
        const seq = this.playbackSeq
        // The first animation timestamp can be slightly older than the play() call.
        // A negative step would rewind past a chapter at time 0 and stop stepped playback there.
        const delta = Math.max(0, Math.min(0.1, (now - this.last) / 1000))
        this.last = now
        const before = this.currentTime
        let next = before + delta * this.speed
        if (this.options.stepped) {
            const boundary = this.film.chapters.find((chapter) => chapter.time > before && chapter.time <= next)
            if (boundary) {
                this.currentTime = boundary.time
                this.paint(undefined, true)
                this.options.onTime?.(this.currentTime)
                if (seq === this.playbackSeq) this.pause()
                return
            }
        }
        if (next >= this.film.duration) {
            if (this.options.loop) next %= this.film.duration
            else {
                this.currentTime = this.film.duration
                this.paint(undefined, true)
                this.options.onTime?.(this.currentTime)
                if (seq === this.playbackSeq) this.pause()
                return
            }
        }
        this.currentTime = next
        this.paint(undefined, true)
        this.options.onTime?.(this.currentTime)
        if (this.playing && seq === this.playbackSeq) this.raf = requestAnimationFrame(this.tick)
    }

    private lookupImage = (image: StageImage): CanvasImageSource | null => {
        const element = browserImageSource(image.asset)
        if (!element) throw new ImageAssetError('The film image was not preloaded before playback.')
        return element
    }

    private paint(prepared?: Frame, skipIfSame = false): void {
        if (this.destroyed) return
        let frame: Frame
        try {
            frame = prepared ?? this.film.frame(this.currentTime)
        } catch (error) {
            if (isSuspend(error)) {
                if (this.pendingPaint?.promise !== error.promise) {
                    const retry = { promise: error.promise }
                    this.pendingPaint = retry
                    void retry.promise.then(() => {
                        if (this.destroyed || this.pendingPaint !== retry) return
                        this.pendingPaint = null
                        this.paint()
                    }, () => {
                        if (this.pendingPaint === retry) this.pendingPaint = null
                    })
                }
                return
            }
            throw error
        }
        this.pendingPaint = null
        if (skipIfSame && this.lastFrame && samePaintedFrame(this.lastFrame, frame)) return
        this.lastFrame = frame
        paintFrame(this.ctx, frame, this.scale, this.lookupImage)
        if (this.options.bloom !== false && frame.bloom > 0 && frame.dark) {
            if (this.presentCanvas && this.gpuBloom) {
                if (this.presenter === undefined) this.presenter = createWebGLBloomPresenter(this.presentCanvas)
                if (this.presenter) {
                    const bgKey = frame.background ?? '#000000'
                    if (this.bloomBgKey !== bgKey) {
                        this.bloomBgKey = bgKey
                        this.bloomBgColor = parseColor(bgKey)
                    }
                    if (this.presenter.paint(this.canvas, frame.bloom, this.bloomBgColor)) {
                        this.setDirectBloomVisible(true)
                        return
                    }
                    this.presenter.dispose()
                    this.presenter = null
                }
            }
            this.setDirectBloomVisible(false)
            this.bloomState = paintCanvasBloom(this.canvas, this.ctx, frame.bloom, frame.background, this.bloomState)
        } else {
            this.setDirectBloomVisible(false)
        }
    }
}

function samePaintedFrame(a: Frame, b: Frame): boolean {
    if (a.ops.length !== b.ops.length || a.background !== b.background || a.bloom !== b.bloom || a.dark !== b.dark) return false
    for (let i = 0; i < a.ops.length; i++) {
        const oa = a.ops[i]!, ob = b.ops[i]!
        if (oa.kind !== ob.kind || oa.blend !== ob.blend || oa.clips?.length !== ob.clips?.length) return false
        if (oa.clips && ob.clips) {
            for (let c = 0; c < oa.clips.length; c++) if (oa.clips[c] !== ob.clips[c]) return false
        }
        if (oa.kind === 'image' && ob.kind === 'image') {
            if (oa.image !== ob.image || oa.alpha !== ob.alpha || oa.dim !== ob.dim) return false
            for (let k = 0; k < 6; k++) if (oa.matrix[k] !== ob.matrix[k]) return false
        } else if (oa.kind === 'path' && ob.kind === 'path') {
            if (oa.path !== ob.path || oa.strokePath !== ob.strokePath
                || oa.fill !== ob.fill || oa.fillAlpha !== ob.fillAlpha
                || oa.stroke !== ob.stroke || oa.strokeAlpha !== ob.strokeAlpha
                || oa.strokeWidth !== ob.strokeWidth || oa.dashOffset !== ob.dashOffset
                || oa.glow !== ob.glow || oa.glowColor !== ob.glowColor) return false
        }
    }
    return true
}

/** Per-element overrides for `<vz-film look="paper" background="#f7f3ea">`. */
export interface FilmLoadOptions {
    look?: string
    background?: string
}

export interface VzFilmElement extends HTMLElement {
    readonly controller: FilmPlayer | null
    reconfigure(options?: FilmLoadOptions): Promise<void>
}

function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
}

const PLAYER_CSS = `
:host { display: block; position: relative; background: #0b0c10; border-radius: inherit; overflow: hidden; font: 12px/1 ui-monospace, "JetBrains Mono", monospace; color: #f2efe6; aspect-ratio: var(--vz-aspect, 16 / 9); }
[hidden] { display: none !important; }
canvas { display: block; width: 100%; height: 100%; object-fit: contain; }
canvas.bloom { position: absolute; inset: 0; pointer-events: none; }
.caption { position: absolute; left: 50%; bottom: 48px; transform: translateX(-50%); max-width: min(86%, 72ch); padding: 6px 12px; border-radius: 6px; background: rgba(11,12,16,.78); color: #f2efe6; font: 500 14px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif; text-align: center; pointer-events: none; transition: bottom .18s ease; text-wrap: balance; }
:host(:not(:hover):not(:focus-within):not([data-paused])) .caption { bottom: 18px; }
:host([nocontrols]) .caption { display: none !important; }
.chrome { position: absolute; inset: auto 0 0 0; display: flex; align-items: center; gap: 12px; padding: 28px 14px 12px; background: linear-gradient(to top, rgba(0,0,0,.62), rgba(0,0,0,0)); opacity: 0; transition: opacity .18s ease; }
:host(:hover) .chrome, :host(:focus-within) .chrome, :host([data-paused]) .chrome { opacity: 1; }
:host([nocontrols]) .chrome { display: none; }
button { all: unset; cursor: pointer; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
button:hover { background: rgba(255,255,255,.12); }
.cc { width: auto; padding: 0 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; opacity: .58; }
.cc[aria-pressed="true"] { opacity: 1; background: rgba(255,255,255,.16); }
.cc:hover { background: rgba(255,255,255,.22); }
.track { position: relative; flex: 1; height: 16px; cursor: pointer; touch-action: none; }
.track::before { content: ""; position: absolute; left: 0; right: 0; top: 7px; height: 2px; background: rgba(255,255,255,.26); border-radius: 2px; }
.fill { position: absolute; left: 0; top: 7px; width: 100%; height: 2px; background: #f2efe6; border-radius: 2px; transform-origin: left center; transform: scaleX(0); }
.tick { position: absolute; top: 4px; width: 1px; height: 8px; background: rgba(255,255,255,.55); }
.time { font-variant-numeric: tabular-nums; opacity: .82; white-space: nowrap; }
svg { width: 14px; height: 14px; fill: currentColor; }
`

const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>'
const ICON_FULL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6V2h4v1.5H3.5V6zM10 2h4v4h-1.5V3.5H10zM2 10h1.5v2.5H6V14H2zM12.5 10H14v4h-4v-1.5h2.5z"/></svg>'
const ICON_VOLUME = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5h3l3.8-3v11l-3.8-3H2zM11.2 4.6a4.5 4.5 0 0 1 0 6.8l-1-1.1a3 3 0 0 0 0-4.6zM13 2.8a7 7 0 0 1 0 10.4l-1-1.1a5.5 5.5 0 0 0 0-8.2z"/></svg>'
const ICON_MUTE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 5.5h3l3.8-3v11l-3.8-3H2zM11.4 5.3l1.6 1.6 1.6-1.6 1.1 1.1L14.1 8l1.6 1.6-1.1 1.1L13 9.1l-1.6 1.6-1.1-1.1L11.9 8l-1.6-1.6z"/></svg>'

/**
 * `<vz-film src="./my-film.js" autoplay loop></vz-film>`
 *
 * Embeds a live, seekable film. It compiles when scrolled near, pauses when out
 * of view, and honors prefers-reduced-motion by showing the final frame.
 */
export function defineFilmElement(load: (src: string, options?: FilmLoadOptions) => Promise<CompiledFilm>, name = 'vz-film'): void {
    if (typeof customElements === 'undefined' || customElements.get(name)) return
    class VzFilm extends HTMLElement implements VzFilmElement {
        static observedAttributes = ['look', 'background']

        private player: FilmPlayer | null = null
        private audio: HTMLAudioElement | null = null
        private visible = false
        private started = false
        private startPromise: Promise<void> | null = null
        private wantsPlay = false
        private captionsEnabled = true
        private reconfigureQueued = false
        private configSeq = 0
        private connectionSeq = 0
        private intersection: IntersectionObserver | null = null
        private keys: AbortController | null = null

        connectedCallback(): void {
            const connection = ++this.connectionSeq
            // Moving an element in the DOM disconnects it first, so a reconnect rebuilds from scratch.
            const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' })
            const rawLabel = this.getAttribute('label') ?? 'Animation'
            root.innerHTML = `<style>${PLAYER_CSS}</style><canvas class="stage" role="img"></canvas><canvas class="bloom" aria-hidden="true" hidden></canvas><div class="caption" hidden></div><div class="chrome"><button class="toggle" type="button" aria-label="Play">${ICON_PLAY}</button><div class="track" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0"><div class="fill"></div></div><span class="time">0:00</span><button class="cc" type="button" aria-label="Captions" aria-pressed="true" hidden>CC</button><button class="mute" type="button" aria-label="Mute" aria-pressed="false" hidden>${ICON_VOLUME}</button><button class="full" type="button" aria-label="Full screen">${ICON_FULL}</button></div>`
            root.querySelector('canvas')!.setAttribute('aria-label', rawLabel)
            this.setAttribute('data-paused', '')
            this.intersection = new IntersectionObserver((entries) => {
                if (connection !== this.connectionSeq) return
                this.visible = entries.some((entry) => entry.isIntersecting)
                if (this.visible && !this.started) {
                    this.startPromise = this.start()
                }
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
            this.connectionSeq++
            this.intersection?.disconnect()
            this.keys?.abort()
            this.player?.destroy()
            this.player = null
            if (this.audio) {
                this.audio.pause()
                this.audio.removeAttribute('src')
                this.audio = null
            }
            this.started = false
            this.visible = false
            this.wantsPlay = false
            this.startPromise = null
            this.reconfigureQueued = false
            this.configSeq++
        }

        attributeChangedCallback(_attr: string, oldValue: string | null, newValue: string | null): void {
            if (!this.started || oldValue === newValue || this.reconfigureQueued) return
            this.reconfigureQueued = true
            const connection = this.connectionSeq
            queueMicrotask(() => {
                if (connection !== this.connectionSeq) return
                this.reconfigureQueued = false
                if (this.started) void this.reconfigure()
            })
        }

        /** The underlying player, once loaded. */
        get controller(): FilmPlayer | null {
            return this.player
        }

        /** Recompile with updated look or background while preserving playhead and play state. */
        async reconfigure(options?: FilmLoadOptions): Promise<void> {
            if (!this.started) return
            const connection = this.connectionSeq
            const seq = ++this.configSeq
            if (!this.player && this.startPromise) await this.startPromise
            if (connection !== this.connectionSeq) return
            const src = this.getAttribute('src')
            if (!src || !this.player || seq !== this.configSeq) return
            const resolved: FilmLoadOptions = {
                look: options && 'look' in options ? options.look : (this.getAttribute('look') ?? undefined),
                background: options && 'background' in options ? options.background : (this.getAttribute('background') ?? undefined),
            }
            try {
                const nextFilm = await load(src, resolved)
                if (connection !== this.connectionSeq || seq !== this.configSeq || !this.player) return
                this.syncFilmMeta(nextFilm)
                this.player.setFilm(nextFilm)
            } catch (error) {
                if (connection !== this.connectionSeq || seq !== this.configSeq) return
                console.error(`vz-film: could not reconfigure ${src}:`, error)
            }
        }

        private syncFilmMeta(film: CompiledFilm): void {
            const root = this.shadowRoot
            if (!root) return
            this.style.setProperty('--vz-aspect', `${film.width} / ${film.height}`)
            const track = root.querySelector<HTMLElement>('.track')
            const ccBtn = root.querySelector<HTMLElement>('.cc')
            if (track) {
                track.setAttribute('aria-valuemax', String(Math.round(film.duration)))
                track.querySelectorAll('.tick').forEach((tick) => tick.remove())
                for (const chapter of film.chapters) {
                    if (chapter.time <= 0) continue
                    const tick = document.createElement('div')
                    tick.className = 'tick'
                    tick.style.left = `${(chapter.time / film.duration) * 100}%`
                    track.append(tick)
                }
            }
            if (ccBtn) {
                ccBtn.hidden = film.captions.length === 0
                ccBtn.setAttribute('aria-pressed', String(this.captionsEnabled))
            }
        }

        private async start(): Promise<void> {
            this.started = true
            const connection = this.connectionSeq
            const src = this.getAttribute('src')
            if (!src) return
            const root = this.shadowRoot!
            const startSeq = this.configSeq
            let film: CompiledFilm
            try {
                film = await load(src, {
                    look: this.getAttribute('look') ?? undefined,
                    background: this.getAttribute('background') ?? undefined,
                })
            } catch (error) {
                if (connection !== this.connectionSeq) return
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
            if (connection !== this.connectionSeq) return
            if (startSeq !== this.configSeq) {
                try {
                    film = await load(src, {
                        look: this.getAttribute('look') ?? undefined,
                        background: this.getAttribute('background') ?? undefined,
                    })
                } catch {
                    // Keep the initial film if the updated attributes failed.
                }
                if (connection !== this.connectionSeq) return
            }
            this.syncFilmMeta(film)
            const canvas = root.querySelector<HTMLCanvasElement>('canvas.stage') ?? root.querySelector('canvas')!
            const bloomCanvas = root.querySelector<HTMLCanvasElement>('canvas.bloom') ?? undefined
            const maxWidthAttr = Number(this.getAttribute('max-width'))
            const maxWidth = Number.isFinite(maxWidthAttr) && maxWidthAttr > 0 ? maxWidthAttr : undefined
            const toggle = root.querySelector<HTMLElement>('.toggle')!
            const fill = root.querySelector<HTMLElement>('.fill')!
            const time = root.querySelector<HTMLElement>('.time')!
            const track = root.querySelector<HTMLElement>('.track')!
            const captionEl = root.querySelector<HTMLElement>('.caption')!
            const ccBtn = root.querySelector<HTMLElement>('.cc')!
            const muteBtn = root.querySelector<HTMLElement>('.mute')!
            const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
            const autoplay = this.hasAttribute('autoplay') && !reduced

            const audioSrc = this.getAttribute('audio')?.trim()
            let audio: HTMLAudioElement | null = null
            const syncMuteUi = () => {
                if (!audio) return
                muteBtn.innerHTML = audio.muted ? ICON_MUTE : ICON_VOLUME
                muteBtn.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute')
                muteBtn.setAttribute('aria-pressed', String(audio.muted))
            }
            const syncAudioTime = (t: number) => {
                if (!audio) return
                try {
                    const maxTime = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Infinity
                    audio.currentTime = Math.max(0, Math.min(t, maxTime))
                } catch {
                    // Metadata may still be loading; loadedmetadata syncs once ready.
                }
            }
            let audioPlaySeq = 0
            const playAudio = () => {
                if (!audio) return
                const currentAudio = audio
                const seq = ++audioPlaySeq
                const attempt = currentAudio.play()
                if (attempt && typeof attempt.catch === 'function') {
                    attempt.catch((error) => {
                        if (error?.name !== 'NotAllowedError' || seq !== audioPlaySeq
                            || this.audio !== currentAudio || !this.player?.isPlaying || currentAudio.muted) return
                        currentAudio.muted = true
                        syncMuteUi()
                        const retry = currentAudio.play()
                        if (retry && typeof retry.catch === 'function') retry.catch(() => {})
                    })
                }
            }
            if (audioSrc) {
                audio = document.createElement('audio')
                audio.preload = 'metadata'
                audio.src = audioSrc
                audio.hidden = true
                audio.loop = this.hasAttribute('loop')
                if (this.hasAttribute('muted')) audio.muted = true
                root.append(audio)
                this.audio = audio
                muteBtn.hidden = false
                syncMuteUi()
                audio.addEventListener('loadedmetadata', () => {
                    if (this.player) syncAudioTime(this.player.time)
                }, { once: true })
            }

            let lastCaption: string | null = null
            let lastCaptionVisible = false
            const updateCaption = (t: number) => {
                const active = this.player?.film ?? film
                let cue: string | null = null
                if (this.captionsEnabled && active.captions.length > 0) {
                    for (let i = active.captions.length - 1; i >= 0; i--) {
                        const entry = active.captions[i]!
                        if (t >= entry.t0 && t < entry.t1) {
                            cue = entry.text
                            break
                        }
                    }
                }
                const visible = cue !== null
                if (cue !== lastCaption) {
                    captionEl.textContent = cue ?? ''
                    lastCaption = cue
                }
                if (visible !== lastCaptionVisible) {
                    captionEl.hidden = !visible
                    lastCaptionVisible = visible
                }
            }

            let lastTimeText = ''
            let lastAriaVal = ''
            const onTime = (t: number) => {
                const active = this.player?.film ?? film
                const duration = active.duration || 1
                const ratio = Math.max(0, Math.min(1, t / duration))
                fill.style.transform = `scaleX(${ratio})`
                const formatted = `${formatTime(t)} / ${formatTime(active.duration)}`
                if (formatted !== lastTimeText) {
                    time.textContent = formatted
                    lastTimeText = formatted
                }
                const ariaVal = String(Math.round(t))
                if (ariaVal !== lastAriaVal) {
                    track.setAttribute('aria-valuenow', ariaVal)
                    lastAriaVal = ariaVal
                }
                updateCaption(t)
                if (audio && this.player?.isPlaying) {
                    if (audio.playbackRate !== this.player.speed) audio.playbackRate = this.player.speed
                    if (!audio.paused && Math.abs(audio.currentTime - t) > 0.35) {
                        syncAudioTime(t)
                    }
                }
                this.dispatchEvent(new CustomEvent('timeupdate', { detail: { time: t } }))
            }
            const player = new FilmPlayer(canvas, film, {
                loop: this.hasAttribute('loop'),
                stepped: this.hasAttribute('stepped'),
                maxWidth,
                presentCanvas: bloomCanvas,
                onTime,
                onSeek: (t) => {
                    syncAudioTime(t)
                    if (audio && player.isPlaying && audio.paused && Number.isFinite(audio.duration) && t < audio.duration - 0.05) {
                        playAudio()
                    }
                },
                onState: ({ playing }) => {
                    toggle.innerHTML = playing ? ICON_PAUSE : ICON_PLAY
                    toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play')
                    if (playing) {
                        this.removeAttribute('data-paused')
                        if (audio) {
                            audio.playbackRate = player.speed
                            syncAudioTime(player.time)
                            playAudio()
                        }
                    } else {
                        this.setAttribute('data-paused', '')
                        audio?.pause()
                    }
                },
            })
            this.player = player
            const startAt = this.getAttribute('start')
            const firstStep = this.hasAttribute('stepped') && !autoplay ? film.chapters.find((c) => c.time > 0) : undefined
            if (reduced && !this.hasAttribute('start')) player.seek(film.duration)
            else if (startAt) player.seek(Number(startAt))
            else if (firstStep) player.seek(firstStep.time)
            else onTime(0)
            if (connection !== this.connectionSeq) return
            toggle.addEventListener('click', () => player.toggle())
            canvas.addEventListener('click', () => player.toggle())
            ccBtn.addEventListener('click', () => {
                this.captionsEnabled = !this.captionsEnabled
                ccBtn.setAttribute('aria-pressed', String(this.captionsEnabled))
                updateCaption(player.time)
            })
            muteBtn.addEventListener('click', () => {
                if (!audio) return
                audio.muted = !audio.muted
                syncMuteUi()
                if (player.isPlaying && audio.paused) playAudio()
            })
            root.querySelector('.full')!.addEventListener('click', () => {
                if (document.fullscreenElement) void document.exitFullscreen()
                else void this.requestFullscreen()
            })
            const seekFrom = (event: PointerEvent) => {
                const rect = track.getBoundingClientRect()
                if (rect.width <= 0) return
                const active = this.player?.film ?? film
                player.seek(((event.clientX - rect.left) / rect.width) * active.duration)
            }
            track.addEventListener('pointerdown', (event) => {
                track.setPointerCapture(event.pointerId)
                seekFrom(event)
                const move = (next: PointerEvent) => seekFrom(next)
                const end = () => {
                    track.removeEventListener('pointermove', move)
                    track.removeEventListener('pointerup', end)
                    track.removeEventListener('pointercancel', end)
                    track.removeEventListener('lostpointercapture', end)
                }
                track.addEventListener('pointermove', move)
                track.addEventListener('pointerup', end)
                track.addEventListener('pointercancel', end)
                track.addEventListener('lostpointercapture', end)
            })
            // Decorative/nocontrols films should not become unexpected keyboard tab stops.
            if (!this.hasAttribute('tabindex') && !this.hasAttribute('nocontrols')) this.tabIndex = 0
            this.keys?.abort()
            this.keys = new AbortController()
            document.addEventListener?.('visibilitychange', () => {
                if (!this.player) return
                if (document.visibilityState === 'hidden') {
                    if (this.player.isPlaying) {
                        this.wantsPlay = true
                        this.player.pause()
                    }
                } else if (this.visible && this.wantsPlay) {
                    this.wantsPlay = false
                    this.player.play()
                }
            }, { signal: this.keys.signal })
            this.addEventListener('keydown', (event) => {
                // Shortcuts such as Command+K belong to the page.
                if (event.metaKey || event.ctrlKey || event.altKey) return
                // Space activates focused controls, including buttons inside the shadow root.
                if (event.key === ' ' && event.composedPath().some((target) => target instanceof Element && target.tagName === 'BUTTON')) return
                const lower = event.key.toLowerCase()
                if (event.key === ' ' || lower === 'k') {
                    event.preventDefault()
                    player.toggle()
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    if (this.hasAttribute('stepped')) player.play()
                    else player.seek(player.time + 5)
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault()
                    if (this.hasAttribute('stepped')) {
                        player.previous()
                        if (player.time === 0 && player.film.chapters.some((c) => c.time > 0)) player.play()
                    } else {
                        player.seek(player.time - 5)
                    }
                } else if (lower === 'c' && player.film.captions.length > 0) {
                    this.captionsEnabled = !this.captionsEnabled
                    ccBtn.setAttribute('aria-pressed', String(this.captionsEnabled))
                    updateCaption(player.time)
                } else if (lower === 'm' && audio) {
                    audio.muted = !audio.muted
                    syncMuteUi()
                    if (player.isPlaying && audio.paused) playAudio()
                } else if (lower === 'f') {
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
