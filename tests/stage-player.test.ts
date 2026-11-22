import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineFilmElement, FilmPlayer, type FilmLoadOptions, type VzFilmElement } from '../src/stage/player'
import { compileFilm, film, Suspend, type CompiledFilm } from '../src/stage/stage'

function createCanvasMock() {
    const fills: string[] = []
    const ctx = {
        fillStyle: '',
        save() {},
        restore() {},
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

function animationClock() {
    const pending = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        pending.set(++id, callback)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => pending.delete(handle))
    vi.spyOn(performance, 'now').mockReturnValue(0)
    return {
        pending,
        frame(now: number) {
            for (const [handle, callback] of [...pending]) {
                pending.delete(handle)
                callback(now)
            }
        },
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return { promise, resolve, reject }
}

describe('FilmPlayer lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('paints once on construction and skips unchanged paused resizes', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const { canvas, fills } = createCanvasMock()
        const player = new FilmPlayer(canvas, compiled, { pixelRatio: 2, initialTime: 1.25 })
        try {
            expect(player.time).toBe(1.25)
            expect(fills).toHaveLength(1)
            player.resize()
            expect(fills).toHaveLength(1)
        } finally {
            player.destroy()
        }
    })

    it('seeks with a prepared frame without reevaluating, preserving callbacks and playback', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const prepared = { ...compiled.frame(2), background: '#123456' }
        const { canvas, fills } = createCanvasMock()
        const clock = animationClock()
        const onSeek = vi.fn(), onTime = vi.fn()
        const player = new FilmPlayer(canvas, compiled, { onSeek, onTime })
        const evaluate = vi.spyOn(compiled, 'frame')
        try {
            player.play()
            fills.length = 0
            player.seek(99, prepared)
            expect(evaluate).not.toHaveBeenCalled()
            expect(fills).toEqual(['#123456'])
            expect(player.time).toBe(2)
            expect(onSeek).toHaveBeenCalledExactlyOnceWith(2)
            expect(onTime).toHaveBeenCalledExactlyOnceWith(2)
            expect(player.isPlaying).toBe(true)
            expect(clock.pending.size).toBe(1)
            player.destroy()
            player.seek(0, prepared)
            expect(fills).toHaveLength(1)
            expect(onTime).toHaveBeenCalledTimes(1)
        } finally {
            player.destroy()
        }
    })

    it('a prepared seek cancels an obsolete suspended paint', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const prepared = compiled.frame(1)
        const asset = deferred<void>()
        const evaluate = vi.spyOn(compiled, 'frame').mockImplementation(() => { throw new Suspend(asset.promise) })
        const { canvas, fills } = createCanvasMock()
        const player = new FilmPlayer(canvas, compiled)
        try {
            evaluate.mockClear()
            player.seek(1, prepared)
            asset.resolve()
            await asset.promise
            expect(evaluate).not.toHaveBeenCalled()
            expect(fills).toHaveLength(1)
            expect(player.time).toBe(1)
        } finally {
            player.destroy()
        }
    })

    it('repaints a changed buffer immediately during playback and while paused', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const { canvas, fills } = createCanvasMock()
        const clock = animationClock()
        const player = new FilmPlayer(canvas, compiled, { pixelRatio: 2 })
        try {
            fills.length = 0
            player.play()
            vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect)
            player.resize()
            expect(canvas.width).toBe(400)
            expect(fills).toHaveLength(1)
            expect(clock.pending.size).toBe(1)
            player.pause()
            player.resize()
            expect(fills).toHaveLength(1)
            canvas.width = 2
            player.resize()
            expect(fills).toHaveLength(2)
        } finally {
            player.destroy()
        }
    })

    it.each(['swap', 'setFilm'] as const)('%s paints a resized film once while paused or playing', async (method) => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const paper = await compileFilm(film({ bloom: 0, look: 'paper', width: 640, height: 360 }, s => { s.wait(2) }))
        const { canvas, fills } = createCanvasMock()
        animationClock()
        const player = new FilmPlayer(canvas, compiled)
        try {
            fills.length = 0
            player[method](paper)
            expect(fills).toEqual(['#f7f3ea'])
            player.play()
            fills.length = 0
            player[method](compiled)
            expect(fills).toEqual(['#0b0c10'])
        } finally {
            player.destroy()
        }
    })

    it.each(['pause', 'restart', 'destroy'] as const)('keeps one RAF owner when onTime requests %s', async (action) => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const clock = animationClock()
        const { canvas } = createCanvasMock()
        const player = new FilmPlayer(canvas, compiled, {
            onTime: () => {
                if (action === 'destroy') player.destroy()
                else {
                    player.pause()
                    if (action === 'restart') player.play()
                }
            },
        })
        try {
            player.play()
            clock.frame(16)
            expect(clock.pending.size).toBe(action === 'restart' ? 1 : 0)
            clock.frame(32)
            expect(clock.pending.size).toBe(action === 'restart' ? 1 : 0)
        } finally {
            player.destroy()
        }
        expect(clock.pending.size).toBe(0)
    })

    it('does not schedule a second RAF when onState restarts playback or revives a destroyed player', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const clock = animationClock()
        const { canvas } = createCanvasMock()
        let restart = true
        const player = new FilmPlayer(canvas, compiled, {
            onState: ({ playing }) => {
                if (playing && restart) {
                    restart = false
                    player.pause()
                    player.play()
                } else if (!playing && !restart) player.play()
            },
        })
        try {
            player.play()
            expect(clock.pending.size).toBe(1)
        } finally {
            player.destroy()
        }
        expect(player.isPlaying).toBe(false)
        expect(clock.pending.size).toBe(0)
    })

    it('caps default backing-store width to authored resolution and to 1280 on CPU bloom fallback', async () => {
        vi.stubGlobal('devicePixelRatio', 2)
        const wideRect = () => ({ width: 2560, height: 1440, left: 0 } as DOMRect)
        const lightFilm = await compileFilm(film({ width: 1920, height: 1080, bloom: 0 }, s => { s.wait(1) }))
        const darkBloomFilm = await compileFilm(film({ width: 1920, height: 1080, bloom: 0.3, look: 'midnight' }, s => { s.wait(1) }))

        const lightMock = createCanvasMock()
        lightMock.canvas.getBoundingClientRect = wideRect
        const lightPlayer = new FilmPlayer(lightMock.canvas, lightFilm)
        try {
            expect(lightMock.canvas.width).toBe(1920)
            expect(lightMock.canvas.height).toBe(1080)
        } finally {
            lightPlayer.destroy()
        }

        const customMock = createCanvasMock()
        customMock.canvas.getBoundingClientRect = wideRect
        const customPlayer = new FilmPlayer(customMock.canvas, lightFilm, { maxWidth: 1440 })
        try {
            expect(customMock.canvas.width).toBe(1440)
            expect(customMock.canvas.height).toBe(810)
        } finally {
            customPlayer.destroy()
        }

        // Mock canvas has no WebGL2 context, so dark bloom falls back to CPU and caps at 1280px.
        const bloomMock = createCanvasMock()
        bloomMock.canvas.getBoundingClientRect = wideRect
        ;(bloomMock.ctx as Record<string, unknown>).getImageData = (_x: number, _y: number, w: number, h: number) => ({
            width: w, height: h, data: new Uint8ClampedArray(w * h * 4),
        })
        ;(bloomMock.ctx as Record<string, unknown>).putImageData = () => {}
        const bloomPlayer = new FilmPlayer(bloomMock.canvas, darkBloomFilm)
        try {
            expect(bloomMock.canvas.width).toBe(1280)
            expect(bloomMock.canvas.height).toBe(720)
        } finally {
            bloomPlayer.destroy()
        }
    })

    it('loops and bounces cleanly inside a [loopStart, loopEnd] window', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(10) }))
        const clock = animationClock()
        const repeatMock = createCanvasMock()
        const repeatPlayer = new FilmPlayer(repeatMock.canvas, compiled, {
            loop: true, loopStart: 2, loopEnd: 2.2, loopMode: 'repeat',
        })
        try {
            repeatPlayer.seek(2.15)
            repeatPlayer.play()
            clock.frame(80) // +0.08s -> 2.23 -> wraps to 2.03
            expect(repeatPlayer.time).toBeCloseTo(2.03, 2)
        } finally {
            repeatPlayer.destroy()
        }

        const bounceClock = animationClock()
        const bounceMock = createCanvasMock()
        const bouncePlayer = new FilmPlayer(bounceMock.canvas, compiled, {
            loop: true, loopStart: 2, loopEnd: 2.2, loopMode: 'bounce',
        })
        try {
            bouncePlayer.seek(2.15)
            bouncePlayer.play()
            bounceClock.frame(80) // +0.08s -> 2.23 -> bounces back to 2.17 (moving backward)
            expect(bouncePlayer.time).toBeCloseTo(2.17, 2)
            bounceClock.frame(160) // -0.08s -> 2.09 (still moving backward)
            expect(bouncePlayer.time).toBeCloseTo(2.09, 2)
            bounceClock.frame(260) // -0.10s -> 1.99 -> bounces forward to 2.01
            expect(bouncePlayer.time).toBeCloseTo(2.01, 2)
        } finally {
            bouncePlayer.destroy()
        }
    })

    it('retries a suspended frame once after multiple ticks, at the latest playhead', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const asset = deferred<void>()
        let loaded = false
        const render = compiled.frame.bind(compiled)
        const frame = vi.spyOn(compiled, 'frame').mockImplementation((time: number) => {
            if (!loaded) throw new Suspend(asset.promise)
            return render(time)
        })
        const { canvas, fills } = createCanvasMock()
        const clock = animationClock()
        const player = new FilmPlayer(canvas, compiled)
        try {
            player.play()
            clock.frame(16)
            clock.frame(32)
            player.pause()
            frame.mockClear()
            loaded = true
            asset.resolve()
            await asset.promise
            expect(frame).toHaveBeenCalledExactlyOnceWith(player.time)
            expect(fills).toHaveLength(1)
        } finally {
            player.destroy()
        }
    })

    it.each(['destroy', 'setFilm', 'swap', 'seek'] as const)('ignores a suspended render made obsolete by %s', async (action) => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const asset = deferred<void>()
        let loaded = false
        const render = compiled.frame.bind(compiled)
        const frame = vi.spyOn(compiled, 'frame').mockImplementation((time: number) => {
            if (!loaded && time === 0) throw new Suspend(asset.promise)
            return render(time)
        })
        const { canvas, fills } = createCanvasMock()
        const player = new FilmPlayer(canvas, compiled)
        try {
            if (action === 'destroy') player.destroy()
            else if (action === 'seek') player.seek(1)
            else player[action](await compileFilm(film({ bloom: 0 }, s => { s.wait(2) })))
            fills.length = 0
            frame.mockClear()
            loaded = true
            asset.resolve()
            await asset.promise
            expect(frame).not.toHaveBeenCalled()
            expect(fills).toHaveLength(0)
        } finally {
            player.destroy()
        }
    })

    it('keeps only the new film retry when setFilm suspends on the same asset', async () => {
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const asset = deferred<void>()
        let loaded = false
        const render = compiled.frame.bind(compiled)
        const frame = (time: number) => {
            if (!loaded) throw new Suspend(asset.promise)
            return render(time)
        }
        vi.spyOn(compiled, 'frame').mockImplementation(frame)
        const replacement = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        vi.spyOn(replacement, 'frame').mockImplementation(frame)
        const { canvas, fills } = createCanvasMock()
        const player = new FilmPlayer(canvas, compiled)
        try {
            player.setFilm(replacement)
            loaded = true
            asset.resolve()
            await asset.promise
            expect(fills).toHaveLength(1)
        } finally {
            player.destroy()
        }
    })
})

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
        const { createElement, createdAudios, intersect, allowUnmutedPlay } = setupFilmElement()

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
            const el = createElement(load)
            expect((el.constructor as { observedAttributes?: string[] }).observedAttributes).toEqual(['look', 'background'])
            el.setAttribute('src', './demo.js')
            el.setAttribute('look', 'midnight')
            el.setAttribute('audio', './narration.m4a')
            el.setAttribute('autoplay', '')
            el.connectedCallback()

            let readyFired = false
            el.addEventListener('ready', () => {
                readyFired = true
            })
            intersect()
            await vi.waitFor(() => expect(readyFired).toBe(true))

            const player = el.controller!
            const root = el.shadowRoot!
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
            allowUnmutedPlay()
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

describe('<vz-film> connection lifecycle', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('starts eager elements immediately at their start time without waiting for IntersectionObserver', async () => {
        const { createElement } = setupFilmElement()
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(5) }))
        const evaluate = vi.spyOn(compiled, 'frame')
        const load = vi.fn(async () => compiled)
        const el = createElement(load)
        el.setAttribute('src', './hero.js')
        el.setAttribute('start', '1.7')
        el.setAttribute('eager', '')
        el.setAttribute('autoplay', '')
        let readyFired = false
        el.addEventListener('ready', () => { readyFired = true })
        el.connectedCallback()
        try {
            await vi.waitFor(() => expect(readyFired).toBe(true))
            expect(load).toHaveBeenCalledTimes(1)
            expect(el.controller?.time).toBe(1.7)
            expect(el.controller?.isPlaying).toBe(true)
            expect(evaluate).toHaveBeenCalledTimes(1)
            expect(evaluate).toHaveBeenCalledWith(1.7)
        } finally {
            el.disconnectedCallback()
        }
    })

    it('preloads first frame before intersecting and respects speed attribute when playback starts', async () => {
        const { createElement, intersect } = setupFilmElement()
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(10) }))
        const load = vi.fn(async () => compiled)
        const el = createElement(load)
        el.setAttribute('src', './lorenz.js')
        el.setAttribute('preload', '')
        el.setAttribute('root-margin', '0px')
        el.setAttribute('loop', '')
        el.setAttribute('loop-start', '2')
        el.setAttribute('loop-end', '5')
        el.setAttribute('loop-mode', 'bounce')
        el.setAttribute('speed', '0.5')
        el.setAttribute('autoplay', '')
        let readyFired = false
        el.addEventListener('ready', () => { readyFired = true })
        el.connectedCallback()
        try {
            await vi.waitFor(() => expect(readyFired).toBe(true))
            expect(el.controller?.time).toBe(2)
            expect(el.controller?.speed).toBe(0.5)
            expect(el.controller?.isPlaying).toBe(false)
            intersect()
            expect(el.controller?.isPlaying).toBe(true)
        } finally {
            el.disconnectedCallback()
        }
    })

    it('applies theme changes during initial loading without invalidating the connection', async () => {
        const { createElement, intersect } = setupFilmElement()
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const paper = await compileFilm(film({ bloom: 0, look: 'paper' }, s => { s.wait(2) }))
        const pending = deferred<CompiledFilm>()
        const load = vi.fn(() => Promise.resolve(paper)).mockImplementationOnce(() => pending.promise)
        const el = createElement(load)
        el.setAttribute('src', './demo.js')
        el.connectedCallback()
        intersect()
        try {
            el.setAttribute('look', 'paper')
            await Promise.resolve()
            pending.resolve(compiled)
            await vi.waitFor(() => expect(el.controller?.film).toBe(paper))
            expect(load).toHaveBeenLastCalledWith('./demo.js', { look: 'paper', background: undefined })
        } finally {
            el.disconnectedCallback()
        }
    })

    it.each(['initial', 'theme reload', 'reconfigure', 'failure'] as const)('discards an obsolete %s after reconnecting', async (phase) => {
        const { createElement, createdAudios, intersect, allowUnmutedPlay } = setupFilmElement()
        allowUnmutedPlay()
        const clock = animationClock()
        const compiled = await compileFilm(film({ bloom: 0 }, s => { s.wait(2) }))
        const pending = deferred<CompiledFilm>()
        const reload = deferred<CompiledFilm>()
        const load = vi.fn(() => Promise.resolve(compiled)).mockImplementationOnce(() => pending.promise)
        const el = createElement(load)
        const ready = vi.fn()
        const error = vi.fn()
        const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
        el.setAttribute('src', './demo.js')
        el.setAttribute('autoplay', '')
        el.setAttribute('audio', './narration.m4a')
        el.addEventListener('ready', ready)
        el.addEventListener('error', error)
        el.connectedCallback()
        intersect()
        let reconfigured: Promise<void> | undefined
        try {
            if (phase === 'theme reload') {
                load.mockImplementationOnce(() => reload.promise)
                el.setAttribute('look', 'paper')
                await Promise.resolve()
                pending.resolve(compiled)
                await pending.promise
                expect(load).toHaveBeenCalledTimes(2)
            } else if (phase === 'reconfigure') {
                pending.resolve(compiled)
                await pending.promise
                load.mockImplementationOnce(() => reload.promise)
                reconfigured = el.reconfigure({ look: 'paper' })
            }
            el.disconnectedCallback()
            ready.mockClear()
            el.connectedCallback()
            intersect()
            await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce())
            const current = el.controller!
            const fills = vi.spyOn(current, 'setFilm')
            const loadCount = load.mock.calls.length
            if (phase === 'failure') pending.reject(new Error('Obsolete load failed'))
            else pending.resolve(compiled)
            reload.resolve(compiled)
            await pending.promise.catch(() => {})
            await reload.promise
            await reconfigured
            expect(el.controller).toBe(current)
            expect(ready).toHaveBeenCalledOnce()
            expect(error).not.toHaveBeenCalled()
            expect(logError).not.toHaveBeenCalled()
            expect(load).toHaveBeenCalledTimes(loadCount)
            expect(fills).not.toHaveBeenCalled()
            expect(clock.pending.size).toBe(1)
            expect(createdAudios.filter(audio => !audio.paused)).toHaveLength(1)
            el.disconnectedCallback()
            expect(clock.pending.size).toBe(0)
            expect(createdAudios.every(audio => audio.paused)).toBe(true)
        } finally {
            el.disconnectedCallback()
        }
    })
})

function setupFilmElement() {
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
            return { fillStyle: '', save() {}, restore() {}, setTransform() {}, clearRect() {}, fillRect() {} }
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

    const createElement = (load: (src: string, options?: FilmLoadOptions) => Promise<CompiledFilm>) => {
        defineFilmElement(load, 'vz-film-test')
        const Ctor = registry.get('vz-film-test') as unknown as {
            new (): Omit<VzFilmElement, 'shadowRoot'> & StubElement & { connectedCallback(): void; disconnectedCallback(): void }
        }
        return new Ctor()
    }
    return {
        createElement,
        createdAudios,
        intersect: () => intersectCb!([{ isIntersecting: true }]),
        allowUnmutedPlay: () => { rejectUnmutedPlay = false },
    }
}
