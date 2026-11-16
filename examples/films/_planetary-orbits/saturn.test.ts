import { beforeAll, describe, expect, it } from 'vitest'
import { compileFilm, film, type CompiledFilm, type StageImage, type Vec3 } from 'vizmatic/stage'
import { saturnPortrait } from './saturn'

const tilt = 26.73 * Math.PI / 180
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: Vec3): Vec3 => { const length = Math.hypot(...v); return [v[0] / length, v[1] / length, v[2] / length] }
const camera = (time: number): Vec3 => {
    const theta = -0.4 + (time - 27) * 0.025, phi = 1.16 - (time - 27) * 0.016
    return [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)]
}
const ringPoint = (radius: number, degrees: number): Vec3 => {
    const angle = degrees * Math.PI / 180
    return [radius * Math.cos(angle), radius * Math.sin(angle) * Math.cos(tilt), radius * Math.sin(angle) * Math.sin(tilt)]
}

// Independent numerical occupancy oracle, deliberately without quadratic roots.
function crossesPlanet(point: Vec3, direction: Vec3): boolean {
    const axis: Vec3 = [0, -Math.sin(tilt), Math.cos(tilt)]
    for (let step = 1; step < 400; step++) {
        const p: Vec3 = [point[0] + direction[0] * step / 100, point[1] + direction[1] * step / 100, point[2] + direction[2] * step / 100]
        const height = dot(p, axis)
        if (dot(p, p) + height * height * (1 / 0.902 ** 2 - 1) < 1) return true
    }
    return false
}

type Pixels = NonNullable<StageImage['pixels']>
let compiled: CompiledFilm
function pixels(time: number): Pixels {
    const image = compiled.frame(time).ops.find(op => op.kind === 'image')
    if (!image?.image.pixels) throw new Error('Saturn portrait did not emit pixels')
    return image.image.pixels
}
function atPoint(image: Pixels, point: Vec3, time = 32): number[] {
    const direction = camera(time), right = unit(cross([0, 0, 1], direction)), up = cross(direction, right)
    const col = Math.round((dot(point, right) + 2.5) / 5 * (image.width - 1))
    const row = Math.round((1.875 - dot(point, up)) / 3.75 * (image.height - 1))
    return Array.from(image.data.slice((row * image.width + col) * 4, (row * image.width + col) * 4 + 4))
}

beforeAll(async () => {
    compiled = await compileFilm(film({ width: 885, height: 664, background: null, bloom: 0 }, s => {
        s.add(saturnPortrait()); s.wait(40)
    }))
})

describe('the private Saturn portrait', () => {
    it('puts the near ring over the body and hides the far ring behind it', () => {
        const image = pixels(32), direction = camera(32)
        const near = ringPoint(1.4, 330), far = ringPoint(1.4, 200)
        expect(crossesPlanet(near, direction)).toBe(false)
        expect(crossesPlanet(near, [-direction[0], -direction[1], -direction[2]])).toBe(true)
        expect(crossesPlanet(far, direction)).toBe(true)
        const unobscured = atPoint(image, ringPoint(1.4, 90))
        expect(Math.abs(atPoint(image, near)[0] - unobscured[0])).toBeLessThan(3)
        expect(atPoint(image, far)[0]).toBeGreaterThan(unobscured[0] + 10)
    })

    it('casts the oblate planet shadow only along the forward light ray', () => {
        const image = pixels(32), light = unit([-0.7, -0.35, 0.3])
        const shadow = ringPoint(1.7, 0), lit = ringPoint(1.7, 90)
        expect(crossesPlanet(shadow, light)).toBe(true)
        expect(crossesPlanet(lit, light)).toBe(false)
        expect(atPoint(image, shadow)[0]).toBeLessThan(atPoint(image, lit)[0] * 0.6)
        expect(atPoint(image, shadow)[3]).toBe(255)
    })

    it('keeps ring gaps transparent and antialiases silhouettes without dark fringes', () => {
        for (const time of [27, 32, 38]) {
            const image = pixels(time)
            for (const radius of [1.1, 1.99, 2.4]) expect(atPoint(image, ringPoint(radius, 90), time)[3]).toBe(0)
            for (const radius of [1.4, 1.7, 2.15]) expect(atPoint(image, ringPoint(radius, 90), time)[3]).toBe(255)
            let partial = 0
            for (let i = 0; i < image.data.length; i += 4) {
                if (image.data[i + 3] > 0 && image.data[i + 3] < 255) {
                    partial++
                    expect(image.data[i]).toBeGreaterThan(30)
                }
            }
            expect(partial).toBeGreaterThan(1000)
            expect(image.data[3]).toBe(0)
        }
    })

    it('reuses repeated frames and preserves earlier pixels across out-of-order seeks', () => {
        const initial = pixels(27), saved = initial.data.slice()
        expect(pixels(27)).toBe(initial)
        pixels(38); pixels(32)
        expect(initial.data).toEqual(saved)
        expect(pixels(27).data).toEqual(saved)
    })
})
