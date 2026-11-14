import { describe, expect, it } from 'vitest'
import { createCanvasReadback } from '../src/canvas-readback'

describe('serial canvas readback', () => {
    it('executes each draw and returns the captured pixels until the command, font or native state changes', () => {
        const ink: string[] = []
        const context = {
            font: '',
            reset() { ink.length = 0; this.font = '' },
            fillText(label: string) { ink.push(this.font + label) },
            getImageData() { return ink.join() },
        }
        let reads = 0, draws = 0
        const cache = createCanvasReadback(context, () => { reads++; return new TextEncoder().encode(ink.join()) })
        const draw = (font: string) => cache.frame(ctx => { draws++; ctx.font = font; ctx.fillText('7') })
        const first = draw('12px serif')
        expect(draw('12px serif')).toBe(first)
        expect(draw('14px serif')).not.toEqual(first)
        cache.frame(ctx => { ctx.fillText('8'); expect(ctx.getImageData()).toBe('8') })
        draw('14px serif')
        expect(reads).toBe(4)
        expect(draws).toBe(4)
        expect(cache.stats()).toEqual({ frames: 5, reused: 1, tracking: false })
    })
})

it('keeps native gradient identity and mutable paint state after a reused frame', () => {
    const context = {
        fillStyle: '' as string | { color: string },
        ink: '',
        reset() { this.fillStyle = ''; this.ink = '' },
        fillRect() { this.ink = typeof this.fillStyle === 'string' ? this.fillStyle : this.fillStyle.color },
        createLinearGradient() { return { color: 'red' } },
    }
    const frames = createCanvasReadback(context, () => new TextEncoder().encode(context.ink))
    const flat = () => frames.frame(ctx => { ctx.fillStyle = 'blue'; ctx.fillRect() })
    expect(flat()).toBe(flat())
    const gradient = context.createLinearGradient()
    const paint = () => frames.frame(ctx => { ctx.fillStyle = gradient; expect(ctx.fillStyle).toBe(gradient); ctx.fillRect() })
    expect(new TextDecoder().decode(paint())).toBe('red')
    gradient.color = 'green'
    expect(new TextDecoder().decode(paint())).toBe('green')
    expect(frames.stats()).toEqual({ frames: 4, reused: 1, tracking: false })
})
