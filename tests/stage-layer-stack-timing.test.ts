import { describe, expect, it } from 'vitest'
import { compileFilm, delay, film, lagged, layerStack, par, rect, seq, type Stage } from '../src/stage/index'

const compile = (build: (stage: Stage) => void) => compileFilm(film(build))
const conflict = /layerStack: .*seq/
const hidden = () => layerStack([{ branch: ['adapter'], shown: false }], { cells: 1 })

describe('layer stack timing', () => {
    it('refuses an earlier light after a later light has been scheduled', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a', 'b']))
            expect(() => s.play(par(delay(stack.light('a'), 2), stack.light('b')))).toThrow(conflict)
            expect(stack.current).toBe(0)
        })
    })

    it('refuses an earlier mark and overlapping state changes on the same block', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a', 'b']))
            expect(() => s.play(delay(stack.mark('a', 'frozen'), 2), stack.mark('a', 'live'))).toThrow(conflict)
            expect(stack.stateOf('a')).toBe('frozen')
            expect(() => s.play(lagged([stack.mark('b', 'frozen'), stack.mark('b', 'live')], { lag: 0.5 }))).toThrow(conflict)
        })
    })

    it('checks the start of each staggered state change against replacements of that block', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a', 'b']))
            expect(() => s.play(stack.mark(['a', 'b'], 'frozen', { lag: 1 }), stack.replace('b', 'new'))).toThrow(conflict)
            expect(stack.labelOf('b')).toBe('b')
        })
    })

    it('protects a future state request even when the block already has that state', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a']))
            expect(() => s.play(delay(stack.mark('a', 'live'), 2), stack.mark('a', 'frozen'))).toThrow(conflict)
            expect(stack.stateOf('a')).toBe('live')
        })
    })

    it('protects a future close even when the stack starts with no open block', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a']))
            expect(() => s.play(delay(stack.close(), 2), stack.open('a', rect(50, 50).at(500, 0)))).toThrow(conflict)
            expect(stack.opened).toBeNull()
        })
    })

    it('keeps same-time lights and replacements with state changes in either order', async () => {
        for (const markFirst of [true, false]) {
            await compile((s) => {
                const stack = s.add(layerStack(['a', 'b'], { states: { live: {}, skip: { dash: true, dim: true } } }))
                const mark = stack.mark('a', 'skip', { duration: 0.2 })
                const replace = stack.replace('a', { label: 'new', color: 'red' }, { duration: 1 })
                s.play(stack.light('a'), stack.light('b'), ...(markFirst ? [mark, replace] : [replace, mark]))
                expect(stack.current).toBe(1)
                expect(stack.blocks.map(block => block.children[1]!.children[2]!.get('opacity'))).toEqual([0, 1])
                expect(stack.stateOf('a')).toBe('skip')
                expect(stack.boxes[0]!.get('dash')).toBeTruthy()
                expect(stack.boxes[0]!.get('stroke')).toEqual(rect(1, 1, { stroke: 'red' }).get('stroke'))
                expect(stack.labelOf('a')).toBe('new')
            })
        }
    })

    it('checks when a predicate reads the label and visibility of each block', async () => {
        await compile((s) => {
            const stack = s.add(hidden())
            expect(() => s.play(delay(stack.replace('adapter', 'new'), 2), stack.mark(b => b.label === 'new', 'frozen'))).toThrow(conflict)
            expect(stack.stateOf('adapter')).toBe('live')
            const second = s.add(hidden())
            expect(() => s.play(delay(second.mark(b => b.shown, 'frozen'), 2), second.show('adapter'))).toThrow(conflict)
            expect(second.find(b => b.shown)).toEqual([])
        })
    })

    it('applies a state transition to whichever replacement label is visible', async () => {
        for (const markFirst of [true, false]) {
            await compile((s) => {
                const stack = s.add(layerStack(['a', 'control']))
                const old = stack.labels[0]!
                const control = stack.labels[1]!.children[0]!
                const mark = stack.mark(['a', 'control'], 'frozen', { duration: 2 })
                const replace = stack.replace('a', 'b', { duration: 1 })
                s.play(...(markFirst ? [mark, replace] : [replace, mark]))
                const current = stack.labels[0]!
                s.at(0.25, () => expect(old.children[0]!.get('fill')).toEqual(control.get('fill')))
                s.at(0.75, () => expect(current.children[0]!.get('fill')).toEqual(control.get('fill')))
            })
        }
    })

    it('refuses passes, close-ups, lights, and earlier reveals that depend on a future reveal', async () => {
        for (const verb of ['pass', 'open', 'light', 'show'] as const) {
            await compile((s) => {
                const stack = s.add(hidden())
                s.play(stack.feed([1]), { duration: 0 })
                const anim = { pass: () => stack.pass('adapter', [2]), open: () => stack.open('adapter', rect(50, 50).at(500, 0)), light: () => stack.light('adapter'), show: () => stack.show('adapter') }[verb]()
                expect(() => s.play(delay(stack.show('adapter'), 3), anim)).toThrow(conflict)
                expect([stack.passed, stack.values, stack.opened, stack.current]).toEqual([0, [1], null, null])
            })
        }
    })

    it('refuses a reveal during a pass already scheduled through the hidden branch', async () => {
        await compile((s) => {
            const stack = s.add(hidden())
            s.play(stack.feed([1]), { duration: 0 })
            expect(() => s.play(stack.pass('adapter', null, { duration: 2 }), delay(stack.show('adapter'), 1))).toThrow(conflict)
            expect(stack.find(b => b.shown)).toEqual([])
        })
    })

    it('can reveal a branch while the vector still passes an earlier layer', async () => {
        await compile((s) => {
            const stack = s.add(layerStack(['a', { branch: ['adapter'], shown: false }], { cells: 1 }))
            s.play(stack.feed([1]), { duration: 0 })
            s.play(stack.show('adapter', { duration: 1 }), stack.pass('adapter', [2], { duration: 4 }))
            expect([stack.passed, stack.values, stack.find(b => b.shown)]).toEqual([2, [2], [0, 1]])
        })
    })

    it('refuses to open a block with a future appearance or change the appearance read by a future open', async () => {
        for (const openFirst of [true, false]) {
            await compile((s) => {
                const stack = s.add(layerStack(['a']))
                const open = stack.open('a', rect(50, 50).at(500, 0))
                const replace = stack.replace('a', { label: 'b', color: 'red' })
                const [later, earlier] = openFirst ? [open, replace] : [replace, open]
                expect(() => s.play(delay(later, 2), earlier)).toThrow(conflict)
            })
        }
    })

    it('allows a zero-duration reveal followed by a pass, light, and close-up at the same time', async () => {
        await compile((s) => {
            const stack = s.add(hidden())
            s.play(seq(stack.feed([1], { duration: 0 }), stack.show('adapter', { duration: 0 }), par(stack.pass('adapter', [2]), stack.light('adapter'), stack.open('adapter', rect(50, 50).at(500, 0)))))
            expect([stack.passed, stack.values, stack.current, stack.opened]).toEqual([1, [2], 0, 0])
        })
    })
})
