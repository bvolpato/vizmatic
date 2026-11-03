import { FilmPlayer } from '../stage/player'
import type { CompiledFilm } from '../stage/index'

export interface LoopRange {
    from: number
    to: number
}

export interface TransportCallbacks {
    onTime?: (time: number) => void
    onState?: (playing: boolean) => void
}

/**
 * Time control over a film player: speed, a loop region, and playing a short
 * range to preview one beat. The film can change underneath without losing the
 * playhead, which is what makes editing while scrubbing feel direct.
 */
export class Transport {
    player: FilmPlayer | null = null
    time = 0
    playing = false
    speed = 1
    loop: LoopRange | null = null
    loopAll = false
    private raf = 0
    private last = 0
    private stopAt: number | null = null
    private returnTo: number | null = null

    constructor(private readonly canvas: HTMLCanvasElement, private readonly callbacks: TransportCallbacks = {}) {}

    get duration(): number {
        return this.player?.film.duration ?? 0
    }

    /** Swap in a newly compiled film and repaint at the same time. */
    setFilm(film: CompiledFilm): void {
        if (this.player) this.player.swap(film)
        else this.player = new FilmPlayer(this.canvas, film)
        if (this.time > film.duration) this.time = film.duration
        this.player.seek(this.time)
    }

    resize(): void {
        this.player?.resize()
    }

    seek(time: number): void {
        const clamped = Math.max(0, Math.min(this.duration, time))
        this.time = clamped
        this.stopAt = null
        this.returnTo = null
        this.player?.seek(clamped)
        this.callbacks.onTime?.(clamped)
    }

    /** Repaint the current time without notifying listeners. */
    repaint(): void {
        this.player?.seek(this.time)
    }

    play(): void {
        if (this.playing || !this.player) return
        if (this.time >= this.duration - 1e-3) this.time = this.loop ? this.loop.from : 0
        this.playing = true
        this.last = performance.now()
        this.callbacks.onState?.(true)
        this.raf = requestAnimationFrame(this.tick)
    }

    pause(): void {
        if (!this.playing) return
        this.playing = false
        cancelAnimationFrame(this.raf)
        this.stopAt = null
        this.returnTo = null
        this.callbacks.onState?.(false)
    }

    toggle(): void {
        if (this.playing) this.pause()
        else this.play()
    }

    /** Play one stretch of time, then return the playhead to where it stops best. */
    previewRange(from: number, to: number, returnTo: number | null = null): void {
        this.pause()
        this.time = Math.max(0, Math.min(this.duration, from))
        this.play()
        this.stopAt = Math.min(this.duration, to)
        this.returnTo = returnTo
    }

    private readonly tick = (now: number): void => {
        if (!this.playing || !this.player) return
        const delta = Math.min(0.1, (now - this.last) / 1000)
        this.last = now
        let next = this.time + delta * this.speed
        if (this.stopAt !== null && next >= this.stopAt) {
            const landing = this.returnTo ?? this.stopAt
            this.time = landing
            this.player.seek(landing)
            this.callbacks.onTime?.(landing)
            this.pause()
            return
        }
        if (this.loop && next >= this.loop.to) {
            next = this.loop.from + (next - this.loop.to) % Math.max(1e-3, this.loop.to - this.loop.from)
        } else if (next >= this.duration) {
            if (this.loopAll) {
                next = next % Math.max(1e-3, this.duration)
            } else {
                this.time = this.duration
                this.player.seek(this.duration)
                this.callbacks.onTime?.(this.duration)
                this.pause()
                return
            }
        }
        this.time = next
        this.player.seek(next)
        this.callbacks.onTime?.(next)
        this.raf = requestAnimationFrame(this.tick)
    }

    destroy(): void {
        this.pause()
        this.player?.destroy()
        this.player = null
    }
}
