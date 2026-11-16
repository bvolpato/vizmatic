import { describe, expect, it } from 'vitest'
import { action, actionIntegral, distance, flightTime, gravity, mass, path, velocity } from './model'

describe('the stationary-action film model', () => {
    it('keeps both positions and times fixed for every displayed variation', () => {
        for (const epsilon of [-1.6, -0.8, 0, 0.8, 1.6]) {
            expect(path(0, epsilon)).toEqual([0, 0])
            expect(path(flightTime, epsilon)[0]).toBe(distance)
            expect(path(flightTime, epsilon)[1]).toBeCloseTo(0, 12)
        }
    })

    it('has Newtonian acceleration and constant mechanical energy on the physical path', () => {
        const dt = 1e-4
        const initialEnergy = mass * (velocity(0)[0] ** 2 + velocity(0)[1] ** 2) / 2
        for (const t of [0.1, 0.51, 1, 1.68, 1.9]) {
            expect((velocity(t + dt)[1] - velocity(t - dt)[1]) / (2 * dt)).toBeCloseTo(-gravity, 9)
            const [vx, vy] = velocity(t)
            expect(mass * (vx * vx + vy * vy) / 2 + mass * gravity * path(t)[1]).toBeCloseTo(initialEnergy, 11)
        }
    })

    it('matches independent quadrature, including the displayed action values', () => {
        for (const epsilon of [-1.6, -0.8, 0, 0.1, 0.8, 1.6]) {
            expect(actionIntegral(epsilon, flightTime, 800)).toBeCloseTo(action(epsilon), 9)
        }
        expect(action()).toBeCloseTo(3.9213, 10)
        expect(action(1.6)).toBeCloseTo(7.079573408348595, 10)
    })

    it('has zero first variation and a quadratic action difference', () => {
        for (const epsilon of [1.6, 0.8, 0.4, 0.2]) {
            expect((actionIntegral(epsilon) - actionIntegral(-epsilon)) / (2 * epsilon)).toBeCloseTo(0, 7)
            expect((action(epsilon) - action()) / (action(epsilon / 2) - action())).toBeCloseTo(4, 10)
        }
    })
})
