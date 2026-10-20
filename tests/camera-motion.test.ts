import { describe, expect, it } from 'vitest'
import {
    cameraSvgTransform,
    interpolateCamera,
    projectWorldPoint,
    type Camera2D,
} from '../src/camera-motion'

describe('camera motion', () => {
    it('holds exact camera endpoints and clamps out-of-range progress', () => {
        const from = { x: 10, y: 20, zoom: 1 }
        const to = { x: 90, y: -20, zoom: 4 }

        expect(interpolateCamera(from, to, 0)).toEqual(from)
        expect(interpolateCamera(from, to, 1)).toEqual(to)
        expect(interpolateCamera(from, to, -2)).toEqual(from)
        expect(interpolateCamera(from, to, 2)).toEqual(to)

        const endpoint = interpolateCamera(from, to, 1)
        expect(endpoint).not.toBe(to)
    })

    it('uses smoothstep for pan and logarithmic zoom by default', () => {
        const middle = interpolateCamera(
            { x: 0, y: 20, zoom: 1 },
            { x: 100, y: 60, zoom: 16 },
            0.5,
        )

        expect(middle).toEqual({ x: 50, y: 40, zoom: 4 })
    })

    it('anchors the camera center at the viewport center for projection and SVG', () => {
        const camera = { x: 125, y: -30, zoom: 2.5 }
        const viewport = { width: 1920, height: 1080 }

        expect(projectWorldPoint({ x: camera.x, y: camera.y }, camera, viewport)).toEqual({
            x: 960,
            y: 540,
        })
        expect(cameraSvgTransform(camera, viewport)).toBe(
            'translate(960 540) scale(2.5) translate(-125 30)',
        )
    })

    it('combines pan and zoom around the viewport center', () => {
        expect(
            projectWorldPoint(
                { x: 110, y: 80 },
                { x: 100, y: 50, zoom: 2 },
                { width: 800, height: 600 },
            ),
        ).toEqual({ x: 420, y: 360 })
    })

    it('applies optional zoom limits to both endpoints and the interpolated result', () => {
        const from = { x: 0, y: 0, zoom: 2 }
        const to = { x: 10, y: 10, zoom: 8 }

        expect(interpolateCamera(from, to, 0.5, { minZoom: 2, maxZoom: 8 }).zoom).toBe(4)
        expect(() => interpolateCamera(from, to, 0.5, { minZoom: 3 })).toThrow('outside the configured range')
        expect(() => interpolateCamera(from, to, 0.5, { maxZoom: 7 })).toThrow('outside the configured range')
        expect(() => interpolateCamera(from, to, 0.5, { minZoom: 9, maxZoom: 8 })).toThrow(
            'minZoom cannot exceed maxZoom',
        )
    })

    it('rejects non-finite values and non-positive zoom or viewport dimensions', () => {
        const camera = { x: 0, y: 0, zoom: 1 }
        const viewport = { width: 800, height: 600 }

        expect(() => interpolateCamera(camera, camera, Number.NaN)).toThrow('Camera progress must be finite')
        expect(() => interpolateCamera(camera, { x: Infinity, y: 0, zoom: 1 }, 0.5)).toThrow(
            'coordinates must be finite',
        )
        expect(() => interpolateCamera(camera, { x: 0, y: 0, zoom: 0 }, 0.5)).toThrow(
            'greater than zero',
        )
        expect(() => interpolateCamera(camera, camera, 0.5, { minZoom: Number.NaN })).toThrow(
            'minZoom must be finite',
        )
        expect(() => interpolateCamera(camera, camera, 0.5, { easing: () => Infinity })).toThrow(
            'finite number',
        )
        expect(() => cameraSvgTransform(camera, { width: 0, height: 600 })).toThrow(
            'width must be finite and greater than zero',
        )
        expect(() => projectWorldPoint({ x: 0, y: Number.NaN }, camera, viewport)).toThrow(
            'World point coordinates must be finite',
        )

        const invalidResult: Camera2D = { x: Number.MAX_VALUE, y: 0, zoom: Number.MAX_VALUE }
        expect(() => projectWorldPoint({ x: -Number.MAX_VALUE, y: 0 }, invalidResult, viewport)).toThrow('Projected world point coordinates must be finite')
    })

    it('does not mutate camera inputs or return endpoint aliases', () => {
        const from = { x: 0, y: 0, zoom: 1 }
        const to = { x: 20, y: 10, zoom: 4 }
        const originalFrom = { ...from }
        const originalTo = { ...to }

        const result = interpolateCamera(from, to, 0.4)
        result.x = 999

        expect(from).toEqual(originalFrom)
        expect(to).toEqual(originalTo)
    })
})
