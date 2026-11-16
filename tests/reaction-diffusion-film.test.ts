import { expect, it } from 'vitest'
import { simulate } from '../examples/films/_reaction-diffusion/model'

it('keeps the Gray–Scott solution bounded, periodic, and independent of sampling order', () => {
    const model = simulate(32, 20, 201, 24)
    expect(model.frames).toHaveLength(10)
    for (const frame of model.frames) for (const value of frame) {
        expect(Number.isFinite(value) && value >= 0 && value <= 1).toBe(true)
    }
    const saved = model.sample(15.2, 9.7, 82)
    expect(model.sample(15.2 + 32, 9.7 - 20, 82)).toBeCloseTo(saved, 12)
    model.sample(0, 0, 201)
    expect(model.sample(15.2, 9.7, 82)).toBe(saved)
    expect(model.sample(0, 0, 201)).toBe(model.frames.at(-1)![0])
    const initial = simulate(32, 20, 201, 24)
    expect(model.frames).toEqual(initial.frames)
    expect(model.frames[0]).not.toEqual(model.frames.at(-1))
})
