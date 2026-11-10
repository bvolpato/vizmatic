import { expect, it } from 'vitest'
import { compileFilm, film, group, passage, type Passage, type PassageLink, type Node } from '../src/stage/index'

it('edits the cloned passage while the source keeps its text, marks and selection', async () => {
    await compileFilm(film((s) => {
        const source = s.add(passage('alpha beta', { width: 400 }))
        const count = source.counter('words')
        s.play(source.mark('alpha', 'supported'), source.select('alpha beta'))
        const copy = s.add(source.clone().at(500, 0))
        s.play(copy.mark('beta', 'claim'), copy.mark('alpha', 'removed'))
        s.play(copy.diff('alpha gamma'))
        s.play(copy.accept())
        s.play(copy.select('gamma'))

        expect(source.text).toBe('alpha beta')
        expect(source.spans).toEqual([{ words: 'alpha', kind: 'supported' }])
        expect(count.value).toBe(2)
        expect(copy.counter('words').value).toBe(1)
        expect(copy.text).toBe('alpha gamma')
        expect(copy.spans).toEqual([{ words: 'alpha', kind: 'removed' }, { words: 'gamma', kind: 'claim' }])
        expect(copy.find('alpha')[0]!.parent).toBe(copy.words)
        expect(copy.span('alpha').passage).toBe(copy)
        expect(copy.span('alpha').words).toBe('alpha')
    }))
})

it('accepts a pending edit on the copy while the source still shows both versions', async () => {
    await compileFilm(film((s) => {
        const source = s.add(passage('old policy', { width: 400 }))
        const old = source.find('old')[0]!
        s.play(source.diff('new policy'))
        const copy = s.add(source.clone().at(500, 0))
        const copiedOld = copy.words.chars[0]!
        s.play(copy.accept())

        expect(source.changes).toBe(1)
        expect(old.get('visible')).toBe(true)
        expect(copy.changes).toBe(0)
        expect(copiedOld.get('visible')).toBe(false)
        expect(copy.text).toBe('new policy')
    }))
})

it('can change a clone at time zero in a new film', async () => {
    let copy!: ReturnType<typeof passage>
    await compileFilm(film((s) => {
        const source = s.add(passage('alpha beta', { width: 400 }))
        s.play(source.mark('alpha'))
        copy = source.clone()
    }))
    await compileFilm(film((s) => {
        s.play(copy.diff('alpha gamma'))
        expect(copy.text).toBe('alpha gamma')
    }))
})

it('edits the passage inside a cloned group independently', async () => {
    await compileFilm(film((s) => {
        const source = passage('alpha beta', { width: 400 })
        const original = s.add(group(source))
        s.play(source.mark('beta', 'claim'))
        const copy = s.add(original.clone()).children[0] as Passage
        s.play(copy.diff('alpha gamma'))
        s.play(copy.accept())
        expect(source.text).toBe('alpha beta')
        expect(source.span('beta').words).toBe('beta')
        expect(copy.span('gamma').passage).toBe(copy)
        expect(copy.find('gamma')[0]!.parent).toBe(copy.words)
    }))
})

it('breaks and draws a cloned link independently between the same external endpoints', async () => {
    await compileFilm(film((s) => {
        const source = s.add(passage('a fact'))
        const target = s.add(passage('evidence').at(500, 100))
        const original = s.add(source.link('fact', target))
        const copy = s.add(original.clone())
        s.play(copy.break())
        const dashes = (link: PassageLink) => (link.draw!(0) as Node[]).filter((part) => part.get('dash'))
        expect(dashes(original)).toHaveLength(0)
        expect(dashes(copy)).toHaveLength(2)
        expect(copy.routeNow()).toEqual(original.routeNow())
    }))
})

it('lifts a copied slip from its copied passage when the slip comes first in the group', async () => {
    await compileFilm(film((s) => {
        const source = passage('alpha beta')
        const slip = source.slip('beta').at(500, 0)
        const [part, page] = s.add(group(slip, source).clone()).children as [Passage, Passage]
        s.play(page.lift(part))
        expect(() => source.lift(part)).toThrow(/make one with slip/i)
    }))
})

it('follows the endpoints of each generation when cloning a group that starts with its link', async () => {
    await compileFilm(film((s) => {
        const a = passage('a fact', { width: 400 }), b = passage('a source', { width: 400 }).at(500, 100)
        s.play(b.mark('source'))
        const link = a.link('fact', b.span('source'))
        const original = s.add(group(link, a, b))
        const copy = s.add(original.clone())
        const [copyLink, first, second] = copy.children as [PassageLink, Passage, Passage]
        const initial = link.routeNow()!
        s.play(first.diff('a longer fact'), second.diff('a longer source'))
        s.play(first.accept(), second.accept())
        const route = copyLink.routeNow()!
        expect(route[0]).toEqual(first.toWorld(...first.leader('fact', 'right')[0]))
        expect(route.at(-1)).toEqual(second.toWorld(...second.leader('source', 'left')[0]))
        expect(route[0]).not.toEqual(initial[0])
        expect(route.at(-1)).not.toEqual(initial.at(-1))
        expect(link.routeNow()).toEqual(initial)

        const [nextLink, nextPage] = s.add(copy.clone()).children as [PassageLink, Passage, Passage]
        expect(nextLink.routeNow()).toEqual(route)
        s.play(nextPage.diff('a longer'))
        s.play(nextPage.accept())
        expect(nextLink.routeNow()).toBeNull()
        expect(first.text).toBe('a longer fact')
        expect(copyLink.routeNow()).toEqual(route)
        expect(link.routeNow()).toEqual(initial)
    }))
})
