import { describe, expect, it } from 'vitest'
import { type DrawOp } from '../src/stage/display'
import { IDENTITY } from '../src/stage/geometry'
import { group } from '../src/stage/node'
import { clock } from '../src/stage/track'
import { point3d, scene3d, type Scene3D } from '../src/stage/three'

function render(scene: Scene3D): DrawOp[] {
    const ops: DrawOp[] = []
    scene.rawOps!(IDENTITY, 1, ops)
    return ops
}

describe('Scene3D static clones', () => {
    it('binds rendering to copied children, including a scene cloned inside a group', () => {
        const scene = scene3d({ perspective: false })
        scene.add(point3d([1, 0, 0]))
        const copy = group(scene).clone().children[0] as Scene3D
        expect(render(copy)).toEqual(render(scene))
        copy.children[0].set('opacity', 0)
        expect(render(copy)).toEqual([])
        expect(render(scene).length).toBeGreaterThan(0)
    })

    it('snapshots independent camera values and captures accumulated spin without continuing it', () => {
        const saved = clock.now
        try {
            clock.now = 0
            const scene = scene3d({ theta: 0.2, phi: 1.1, perspective: false, focus: [1, 2, 3] })
            scene.spin(0.5)
            clock.now = 2
            const point = [2, 0, 1] as const, expected = scene.stagePoint(point)
            const copy = scene.clone()
            expect(copy.stagePoint(point)).toEqual(expected)
            for (const key of ['phi', 'theta', 'distance', 'unit', 'focusX', 'focusY', 'focusZ'] as const) {
                expect(copy[key]).not.toBe(scene[key])
            }
            copy.stopSpin()
            clock.now = 4
            expect(copy.stagePoint(point)).toEqual(expected)
            expect(scene.stagePoint(point)).not.toEqual(expected)
            copy.focusX.set(9)
            copy.theta.set(-1)
            expect(scene.focusX.value).toBe(1)
            expect(scene.theta.value).toBe(0.2)
            scene.phi.set(0.1)
            expect(copy.phi.value).toBe(1.1)
        } finally {
            clock.now = saved
        }
    })
})
