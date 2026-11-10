import { describe, expect, it } from 'vitest'
import { compileFilm, film, group, layerStack, rect, type Node } from '../src/stage/index'
import { clock } from '../src/stage/track'

function at<T>(time: number, read: () => T): T {
    const saved = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = saved
    }
}

function shows(node: Node): number {
    let opacity = 1
    for (let part: Node | null = node; part; part = part.parent) {
        if (!part.get('visible')) return 0
        opacity *= part.get('opacity')
    }
    return opacity
}

describe('LayerStack.clone', () => {
    it('starts closed and does not close the original stack\'s external close-up', async () => {
        let original!: ReturnType<typeof layerStack>
        let copy!: ReturnType<typeof layerStack>
        let detail!: Node
        let copyWasOpen: number | null = null
        let copyZoomWasVisible = true

        await compileFilm(film((stage) => {
            original = layerStack(['a']).at(-400, 0)
            const parent = stage.add(group(original))
            detail = rect(100, 100).at(300, 0)
            stage.play(original.open('a', detail), { duration: 1 })
            copy = parent.clone().children[0] as typeof original
            copyWasOpen = copy.opened
            copyZoomWasVisible = copy.zoom.get('visible')
            stage.add(copy.at(-400, 300))
            stage.play(copy.close(), { duration: 1 })
            stage.wait(1)
        }))

        expect(copyWasOpen).toBeNull()
        expect(copyZoomWasVisible).toBe(false)
        expect(original.opened).toBe(0)
        expect(copy.opened).toBeNull()
        expect(at(2, () => [shows(original.zoom), shows(detail)])).toEqual([1, 1])
    })

    it('uses fresh timing claims when a snapshot moves to a new film', async () => {
        let copy!: ReturnType<typeof layerStack>
        let next!: ReturnType<typeof layerStack>

        await compileFilm(film((stage) => {
            const original = stage.add(layerStack(['a', 'b']))
            stage.play(original.feed([1, 0, 0, 0]), { duration: 1 })
            copy = original.clone()
        }))

        await compileFilm(film((stage) => {
            stage.add(copy)
            stage.play(copy.pass('a'))
            next = copy.clone()
        }))

        await compileFilm(film((stage) => {
            stage.add(next)
            stage.play(next.pass('b', [0, 1, 0, 0]))
        }))

        expect(copy.passed).toBe(1)
        expect(copy.values).toEqual([1, 0, 0, 0])
        expect(next.passed).toBe(2)
        expect(next.values).toEqual([0, 1, 0, 0])
    })
})
