import { expect, it, vi } from 'vitest'
import { FilmPlayer } from '../src/stage/player'
import { compileFilm, film } from '../src/stage/stage'

it('holds the next chapter when a frame lands just before it', async () => {
    const deck = await compileFilm(film({ bloom: 0 }, s => {
        s.chapter('The write')
        s.wait(1)
        s.chapter('Missing mapping')
        s.wait(1)
        s.chapter('Allocated page')
        s.wait(1)
    }))
    const canvas = {
        getBoundingClientRect: () => ({ width: 160 }),
        getContext: () => ({ setTransform() {}, clearRect() {}, fillRect() {} }),
    } as unknown as HTMLCanvasElement
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
