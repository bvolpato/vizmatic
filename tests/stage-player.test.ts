import { describe, expect, it, vi } from 'vitest'
import { defineFilmElement, FilmPlayer, type FilmLoadOptions, type VzFilmElement } from '../src/stage/player'
import { compileFilm, film } from '../src/stage/stage'

function createCanvasMock() {
    const fills: string[] = []
    const ctx = {
        fillStyle: '',
        setTransform() {},
        clearRect() {},
        fillRect() {
            fills.push(String(ctx.fillStyle))
        },
    }
    const canvas = {
        width: 320,
        height: 180,
        getBoundingClientRect: () => ({ width: 160, left: 0 }),
        getContext: () => ctx,
    } as unknown as HTMLCanvasElement
    return { canvas, ctx, fills }
}

it('holds the next chapter when a frame lands just before it', async () => {
    const deck = await compileFilm(film({ bloom: 0 }, s => {
        s.chapter('The write')
        s.wait(1)
        s.chapter('Missing mapping')
        s.wait(1)
        s.chapter('Allocated page')
        s.wait(1)
    }))
    const { canvas } = createCanvasMock()
    const frames = vi.fn<(callback: FrameRequestCallback) => number>().mockReturnValue(1)
    vi.stubGlobal('requestAnimationFrame', frames)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.spyOn(performance, 'now').mockReturnValue(0)
    const player = new FilmPlayer(canvas, deck, { stepped: true })
    try {
        player.seek(0.9)
        player.play()
        frames.mock.lastCall![0](99.5)
        frames.mock.lastCall![0](116)
        expect(player.time).toBe(1)
        expect(player.isPlaying).toBe(false)

        player.play()
        frames.mock.lastCall![0](16)
        expect(player.time).toBeGreaterThan(1)
        expect(player.isPlaying).toBe(true)
        player.pause()

        player.seek(0.9995)
        player.next()
        expect(player.time).toBe(1)
        player.next()
        expect(player.time).toBe(2)
    } finally {
        player.destroy()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    }
})

describe('FilmPlayer.setFilm and onSeek', () => {
    it('preserves or clamps time, preserves play state, repaints immediately, and fires callbacks', async () => {
        const longMidnight = await compileFilm(film({ bloom: 0, look: 'midnight' }, (s) => {
            s.wait(5)
        }))
        const shortPaper = await compileFilm(film({ bloom: 0, look: 'paper' }, (s) => {
            s.wait(3)
        }))
        const { canvas, fills } = createCanvasMock()
        const frames = vi.fn<(callback: FrameRequestCallback) => number>().mockReturnValue(1)
        vi.stubGlobal('requestAnimationFrame', frames)
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
        vi.spyOn(performance, 'now').mockReturnValue(0)

        const seenTimes: number[] = []
        const seenSeeks: number[] = []
        const player = new FilmPlayer(canvas, longMidnight, {
            onTime: (t) => seenTimes.push(t),
            onSeek: (t) => seenSeeks.push(t),
        })
        try {
            player.seek(4.2)
            expect(seenSeeks).toEqual([4.2])
            expect(player.time).toBe(4.2)
            expect(player.isPlaying).toBe(false)

            fills.length = 0
            player.setFilm(shortPaper)
            expect(player.time).toBe(3)
            expect(player.isPlaying).toBe(false)
            expect(fills.at(-1)).toBe('#f7f3ea')
            expect(seenTimes.at(-1)).toBe(3)

            player.seek(1.75)
            player.play()
            expect(player.isPlaying).toBe(true)

            fills.length = 0
            player.setFilm(longMidnight)
            expect(player.time).toBe(1.75)
            expect(player.isPlaying).toBe(true)
            expect(fills.at(-1)).toBe('#0b0c10')
            expect(seenTimes.at(-1)).toBe(1.75)
        } finally {
            player.destroy()
            vi.restoreAllMocks()
            vi.unstubAllGlobals()
        }
    })
})

describe('<vz-film> live reconfigure, captions overlay, and synced audio', () => {
    it('observes look/background, toggles captions, syncs audio seeks, and falls back to muted on autoplay block', async () => {
        class MiniNode {
            tagName: string
            className = ''
            hidden = false
            textContent = ''
            innerHTML = ''
            tabIndex = -1
            preload = ''
            src = ''
            loop = false
            muted = false
            paused = true
            currentTime = 0
            duration = 10
            playbackRate = 1
            playImpl: () => Promise<void> = async () => {
                this.paused = false
            }
            readonly style = {
                width: '',
                left: '',
                cssText: '',
                props: new Map<string, string>(),
                setProperty(k: string, v: string) {
                    this.props.set(k, v)
                },
            }
            readonly attrs = new Map<string, string>()
            readonly listeners = new Map<string, Array<(event: unknown) => void>>()
            readonly children: MiniNode[] = []

            constructor(tagName = 'div') {
                this.tagName = tagName.toUpperCase()
            }
            setAttribute(name: string, value: string): void {
                const prev = this.attrs.get(name) ?? null
                this.attrs.set(name, value)
                const ctor = this.constructor as unknown as { observedAttributes?: string[] }
                if (ctor.observedAttributes?.includes(name) && 'attributeChangedCallback' in this) {
                    ;(this as unknown as { attributeChangedCallback: (n: string, o: string | null, v: string | null) => void })
                        .attributeChangedCallback(name, prev, value)
                }
            }
            getAttribute(name: string): string | null {
                return this.attrs.get(name) ?? null
            }
            hasAttribute(name: string): boolean {
                return this.attrs.has(name)
            }
            removeAttribute(name: string): void {
                const prev = this.attrs.get(name) ?? null
                if (!this.attrs.has(name)) return
                this.attrs.delete(name)
                const ctor = this.constructor as unknown as { observedAttributes?: string[] }
                if (ctor.observedAttributes?.includes(name) && 'attributeChangedCallback' in this) {
                    ;(this as unknown as { attributeChangedCallback: (n: string, o: string | null, v: string | null) => void })
                        .attributeChangedCallback(name, prev, null)
                }
            }
            append(...nodes: MiniNode[]): void {
                this.children.push(...nodes)
            }
            remove(): void {}
            addEventListener(type: string, fn: (event: unknown) => void): void {
                const list = this.listeners.get(type) ?? []
                list.push(fn)
                this.listeners.set(type, list)
            }
            dispatchEvent(event: { type: string }): boolean {
                for (const fn of this.listeners.get(event.type) ?? []) fn(event)
                return true
            }
            click(): void {
                this.dispatchEvent({ type: 'click' })
            }
            play(): Promise<void> {
                return this.playImpl()
            }
            pause(): void {
                this.paused = true
            }
            getBoundingClientRect() {
                return { width: 200, left: 0 }
            }
            getContext() {
                return { fillStyle: '', setTransform() {}, clearRect() {}, fillRect() {} }
            }
        }

        class MiniShadowRoot {
            private nodes = new Map<string, MiniNode>()
            readonly appended: MiniNode[] = []
            private rawHtml = ''

            set innerHTML(value: string) {
                this.rawHtml = value
                const canvas = new MiniNode('canvas')
                const caption = new MiniNode('div')
                caption.className = 'caption'
                caption.hidden = true
                const toggle = new MiniNode('button')
                toggle.className = 'toggle'
                const track = new MiniNode('div')
                track.className = 'track'
                const fill = new MiniNode('div')
                fill.className = 'fill'
                const time = new MiniNode('span')
                time.className = 'time'
                const cc = new MiniNode('button')
                cc.className = 'cc'
                cc.hidden = true
                const mute = new MiniNode('button')
                mute.className = 'mute'
                mute.hidden = true
                const full = new MiniNode('button')
                full.className = 'full'
                this.nodes = new Map([
                    ['canvas', canvas],
                    ['.caption', caption],
                    ['.toggle', toggle],
                    ['.track', track],
                    ['.fill', fill],
                    ['.time', time],
                    ['.cc', cc],
                    ['.mute', mute],
                    ['.full', full],
                ])
            }
            get innerHTML(): string {
                return this.rawHtml
            }
            querySelector(selector: string): MiniNode | null {
                return this.nodes.get(selector) ?? null
            }
            append(node: MiniNode): void {
                this.appended.push(node)
            }
        }

        ;(MiniNode.prototype as unknown as { querySelectorAll: () => MiniNode[] }).querySelectorAll = function (this: MiniNode) {
            return this.children
        }

        class StubElement extends MiniNode {
            shadowRoot: MiniShadowRoot | null = null
            attachShadow(): MiniShadowRoot {
                this.shadowRoot = new MiniShadowRoot()
                return this.shadowRoot
            }
        }

        let intersectCb: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
        const createdAudios: MiniNode[] = []
        let rejectUnmutedPlay = true
        const registry = new Map<string, CustomElementConstructor>()

        vi.stubGlobal('HTMLElement', StubElement)
        vi.stubGlobal('Element', MiniNode)
        vi.stubGlobal('customElements', {
            get: (name: string) => registry.get(name),
            define: (name: string, ctor: CustomElementConstructor) => registry.set(name, ctor),
        })
        vi.stubGlobal('IntersectionObserver', class {
            constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
                intersectCb = cb
            }
            observe(): void {}
            disconnect(): void {}
        })
        vi.stubGlobal('document', {
            fullscreenElement: null,
            createElement: (tag: string) => {
                const node = new MiniNode(tag)
                if (tag === 'audio') {
                    node.playImpl = async () => {
                        if (rejectUnmutedPlay && !node.muted) {
                            throw new DOMException('Autoplay blocked', 'NotAllowedError')
                        }
                        node.paused = false
                    }
                    createdAudios.push(node)
                }
                return node
            },
        })
        vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(1))
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
        vi.spyOn(performance, 'now').mockReturnValue(0)

        const loadCalls: Array<{ src: string; options?: FilmLoadOptions }> = []
        const load = vi.fn(async (src: string, options?: FilmLoadOptions) => {
            loadCalls.push({ src, options })
            return compileFilm(film({
                bloom: 0,
                look: (options?.look as 'midnight' | 'paper' | 'blueprint' | undefined) ?? 'midnight',
                ...(options?.background ? { background: options.background } : {}),
            }, (s) => {
                s.chapter('Intro')
                s.caption('First spoken line', 2)
                s.wait(2)
                s.chapter('Second')
                s.caption('Second spoken line', 2)
                s.wait(2)
            }))
        })

        try {
            defineFilmElement(load, 'vz-film-test')
            const Ctor = registry.get('vz-film-test') as unknown as {
                new (): VzFilmElement & StubElement & { connectedCallback(): void; disconnectedCallback(): void }
                observedAttributes: string[]
            }
            expect(Ctor.observedAttributes).toEqual(['look', 'background'])

            const el = new Ctor()
            el.setAttribute('src', './demo.js')
            el.setAttribute('look', 'midnight')
            el.setAttribute('audio', './narration.m4a')
            el.setAttribute('autoplay', '')
            el.connectedCallback()

            let readyFired = false
            el.addEventListener('ready', () => {
                readyFired = true
            })
            intersectCb!([{ isIntersecting: true }])
            await vi.waitFor(() => expect(readyFired).toBe(true))

            const player = el.controller!
            const root = el.shadowRoot as unknown as MiniShadowRoot
            const caption = root.querySelector('.caption')!
            const ccBtn = root.querySelector('.cc')!
            const muteBtn = root.querySelector('.mute')!
            const audio = createdAudios[0]!

            // Autoplay rejected unmuted audio -> fell back to muted without stalling playback.
            await vi.waitFor(() => expect(audio.muted).toBe(true))
            expect(player.isPlaying).toBe(true)
            expect(audio.paused).toBe(false)
            expect(muteBtn.hidden).toBe(false)
            expect(muteBtn.getAttribute('aria-pressed')).toBe('true')
            expect(muteBtn.getAttribute('aria-label')).toBe('Unmute')

            // Captions enabled by default and updated on seek.
            expect(ccBtn.hidden).toBe(false)
            expect(ccBtn.getAttribute('aria-pressed')).toBe('true')
            player.seek(0.5)
            expect(caption.hidden).toBe(false)
            expect(caption.textContent).toBe('First spoken line')
            expect(audio.currentTime).toBe(0.5)

            player.seek(2.5)
            expect(caption.textContent).toBe('Second spoken line')
            expect(audio.currentTime).toBe(2.5)

            // CC toggle hides and restores captions.
            ccBtn.click()
            expect(ccBtn.getAttribute('aria-pressed')).toBe('false')
            expect(caption.hidden).toBe(true)
            ccBtn.click()
            expect(caption.hidden).toBe(false)
            expect(caption.textContent).toBe('Second spoken line')

            // Mutating look + background synchronously coalesces into a single recompile and preserves playhead & play state.
            loadCalls.length = 0
            el.setAttribute('look', 'paper')
            el.setAttribute('background', '#f7f3ea')
            await vi.waitFor(() => expect(loadCalls).toHaveLength(1))
            expect(loadCalls[0]).toEqual({ src: './demo.js', options: { look: 'paper', background: '#f7f3ea' } })
            await vi.waitFor(() => expect(player.film.background).toBe('#f7f3ea'))
            expect(player.time).toBe(2.5)
            expect(player.isPlaying).toBe(true)

            // Public reconfigure() overrides look cleanly at the same playhead.
            await el.reconfigure({ look: 'blueprint', background: undefined })
            expect(player.film.background).toBe('#0b2340')
            expect(player.time).toBe(2.5)

            // Pausing player pauses synced audio.
            rejectUnmutedPlay = false
            player.pause()
            expect(audio.paused).toBe(true)

            // Space on a shadow button belongs to its native activation, not the host shortcut.
            for (const button of [ccBtn, muteBtn]) {
                const preventDefault = vi.fn()
                el.dispatchEvent({
                    type: 'keydown', key: ' ', preventDefault,
                    composedPath: () => [button, root, el],
                } as unknown as Event)
                expect.soft(preventDefault).not.toHaveBeenCalled()
                expect.soft(player.isPlaying).toBe(false)
                player.pause()
            }
            const preventDefault = vi.fn()
            el.dispatchEvent({
                type: 'keydown', key: ' ', preventDefault,
                composedPath: () => [el],
            } as unknown as Event)
            expect(preventDefault).toHaveBeenCalledOnce()
            expect(player.isPlaying).toBe(true)
            player.pause()

            // Rejected play requests must not restart cancelled or obsolete playback.
            for (const scenario of ['abort', 'pause', 'resume', 'disconnect'] as const) {
                audio.muted = false
                let rejectPlay!: (error: DOMException) => void
                const pending = new Promise<void>((_, reject) => { rejectPlay = reject })
                const play = vi.fn(() => Promise.resolve()).mockImplementationOnce(() => pending)
                audio.playImpl = play
                player.play()
                if (scenario === 'pause' || scenario === 'resume') player.pause()
                if (scenario === 'resume') player.play()
                if (scenario === 'disconnect') el.disconnectedCallback()
                const callsBeforeRejection = play.mock.calls.length
                rejectPlay(new DOMException('Playback rejected', scenario === 'abort' ? 'AbortError' : 'NotAllowedError'))
                await pending.catch(() => {})
                await Promise.resolve()
                expect.soft(play).toHaveBeenCalledTimes(callsBeforeRejection)
                expect.soft(audio.muted).toBe(false)
                player.pause()
            }

            el.disconnectedCallback()
        } finally {
            vi.restoreAllMocks()
            vi.unstubAllGlobals()
        }
    })
})
