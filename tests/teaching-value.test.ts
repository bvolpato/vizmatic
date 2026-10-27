import { describe, expect, it } from 'vitest'
import { createTeachingValueChange, valueChangeState } from '../src/teaching-value'
import type { CanvasPainter } from '../src/canvas-components'

function host() {
    let alpha = 1
    const events: { kind: string, alpha: number, value?: string, color?: string }[] = []
    const painter: CanvasPainter = {
        rect() { events.push({ kind: 'rect', alpha }) },
        text(value, _x, _y, _size, color) { events.push({ kind: 'text', alpha, value, color }) },
        container(_bounds, draw) { draw() },
        labelScope(_bounds, draw) { draw() },
        circle() {},
        opacity(amount, draw) {
            const previous = alpha
            alpha *= amount
            try { draw() } finally { alpha = previous }
        },
    }
    return { scene: createTeachingValueChange(painter), events, alpha: () => alpha }
}

describe('value change cues', () => {
    it('interpolates from the same explicit numerical update at any frame order', () => {
        const options = { from: 100, to: 160, progress: 0.5 }
        expect(valueChangeState(options)).toMatchObject({ value: 130, previous: 100, target: 160, delta: 60, changed: true, emphasis: 1 })
        valueChangeState({ ...options, progress: 0.9 })
        expect(valueChangeState(options).value).toBe(130)
        expect(valueChangeState({ ...options, progress: -1 }).value).toBe(100)
        expect(valueChangeState({ ...options, progress: 2 }).value).toBe(160)
    })

    it('highlights an update and releases the cue when it settles, while unchanged values stay quiet', () => {
        const update = { from: 20, to: 10 }
        expect(valueChangeState({ ...update, progress: 0 }).emphasis).toBe(0)
        expect(valueChangeState({ ...update, progress: 0.2 }).emphasis).toBe(1)
        expect(valueChangeState({ ...update, progress: 0.8 }).emphasis).toBeLessThan(1)
        expect(valueChangeState({ ...update, progress: 1 }).emphasis).toBe(0)
        expect(valueChangeState({ from: 10, to: 10, progress: 0.5, emphasis: 1 })).toMatchObject({ changed: false, emphasis: 0, delta: 0 })
    })

    it('can hold one steady emphasis across an accelerated sequence without pulsing each iteration', () => {
        expect(valueChangeState({ from: 3, to: 2, progress: 1, emphasis: 0.8 }).emphasis).toBe(0.8)
    })

    it('accepts the numeric state from a richer drawing options object', () => {
        const options = {from: 20, to: 10, progress: 0.5, x: 100, y: 100, width: 300, height: 120, label: 'Slope', color: '#fc0'}
        expect(valueChangeState(options).value).toBe(15)
    })

    it('keeps host containment checking active for compact two-line cards', () => {
        const h = host()
        h.scene.valueChange({x: 0, y: 0, width: 300, height: 83, label: 'Slope', showDelta: false, from: 20, to: 10, progress: 1})
        const texts = h.events.filter(event => event.kind === 'text')
        expect(texts.map(event => event.value)).toEqual(['Slope', '10.0'])
        const painter: CanvasPainter = {
            rect() {}, text() {}, circle() {}, container(_bounds, draw) {draw()}, opacity(_value, draw) {draw()},
            labelScope() {throw new Error('host containment rejected label')},
        }
        expect(() => createTeachingValueChange(painter).valueChange({x: 0, y: 0, width: 200, height: 140, from: 0, to: 1, progress: 1})).toThrow('host containment')
    })

    it('draws the highlight below the existing equation through checked host primitives', () => {
        const h = host()
        const result = h.scene.changeCue({ x: 10, y: 20, width: 200, height: 70, from: 20, to: 10, progress: 0.5, color: '#fc0' }, (state) => {
            h.events.push({ kind: 'equation', alpha: h.alpha(), value: `m=${state.value}`, color: state.color })
        })
        expect(h.events.map(event => event.kind)).toEqual(['rect', 'rect', 'equation'])
        expect(h.events.at(-1)).toMatchObject({ value: 'm=15', color: '#fc0', alpha: 1 })
        expect(result.value).toBe(15)
        expect(h.alpha()).toBe(1)
    })

    it('retains the before/after relationship and signed delta in a numeric card', () => {
        const h = host()
        h.scene.valueChange({ x: 0, y: 0, width: 420, height: 140, label: 'Slope', from: 20, to: 10, progress: 1, format: value => value.toFixed(0) })
        expect(h.events.filter(event => event.kind === 'text').map(event => event.value)).toEqual(['Slope', '10', '20 → 10  ·  Δ -10'])
        expect(h.events.every(event => event.kind !== 'rect')).toBe(true)
    })

    it('keeps fixed values unhighlighted and rejects invalid geometry or numerical updates', () => {
        const h = host()
        const options = { x: 0, y: 0, width: 200, height: 140, from: 10, to: 10, progress: 0.5 }
        h.scene.changeCue(options)
        expect(h.events).toEqual([])
        expect(() => h.scene.changeCue({ ...options, width: -1 })).toThrow('bounds')
        expect(() => h.scene.valueChange({ ...options, height: 30 })).toThrow('height')
        expect(() => valueChangeState({ from: NaN, to: 1, progress: 0 })).toThrow('finite')
        expect(() => valueChangeState({ from: 0, to: 1, progress: Infinity })).toThrow('finite')
    })
})
