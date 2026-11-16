import { expect, it } from 'vitest'
import { braceLabel, compileFilm, film, group, linear, rect, surroundingBox, to, type Node } from '../src/stage/index'

it('follows moving and resizing targets through parent transforms and backward seeks, with static defaults', async () => {
    let target!: Node, box!: Node, brace!: Node, fixed!: Node
    const compiled = await compileFilm(film((s) => {
        target = rect(160, 80).at(-180, -40)
        box = surroundingBox(target, { follow: true, pad: 16 })
        brace = braceLabel(target, 'width', { follow: true, plain: true, gap: 20, size: 26 })
        fixed = surroundingBox(target, { pad: 16 })
        const parent = group(target, box, brace)
        s.add(parent, fixed)
        s.play(to(target, (n) => n.shift(270, 70).scale(1.5)), to(parent, (n) => n.shift(80, 30).rotate(0.3).scale(1.2)), { duration: 2, ease: linear })
    }))
    const fixedBounds = fixed.bounds()
    for (const time of [0, 1, 2, 0.4, 1.6, 0]) {
        compiled.frame(time)
        const b = target.bounds(), outline = box.bounds()
        expect(outline.x).toBeCloseTo(b.x - 16)
        expect(outline.y).toBeCloseTo(b.y - 16)
        expect(outline.width).toBeCloseTo(b.width + 32)
        expect(outline.height).toBeCloseTo(b.height + 32)
        expect(brace.bounds().y).toBeCloseTo(b.y + b.height + 20)
        expect(fixed.bounds()).toEqual(fixedBounds)
    }
})

it('rebinds a following annotation to copied targets when a group is cloned', async () => {
    await compileFilm(film((s) => {
        const target = rect(100, 50)
        const original = group(target, surroundingBox(target, { follow: true, pad: 10 }))
        const copy = original.clone().shift(300, 100)
        s.add(original, copy)
        copy.children[0]!.scale(2)
        expect(original.children[1]!.bounds().width).toBeCloseTo(120)
        expect(copy.children[1]!.bounds().width).toBeCloseTo(220)
        expect(copy.children[1]!.center).toEqual(copy.children[0]!.center)
    }))
})
