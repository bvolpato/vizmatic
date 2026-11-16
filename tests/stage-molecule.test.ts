import { describe, expect, it } from 'vitest'
import { fadeOut, film, compileFilm, frameToSvg } from '../src/stage/index'
import { molecule3d, type Molecule3DData } from '../src/stage/objects/molecule'
import { at, expectPure } from './helpers/stage-objects'

const pair: Molecule3DData = {
    atoms: [{ id: 'a', element: 'C', position: [-1, 0, 0] }, { id: 'b', element: 'O', position: [1, 0, 0] }],
    bonds: [{ from: 'a', to: 'b', order: 2 }],
}

describe('molecule3d', () => {
    it('validates geometry and topology before drawing', () => {
        expect(() => molecule3d({ atoms: [], bonds: [] })).toThrow('explicitly positioned')
        for (const position of [[0, NaN, 1], [0, Infinity, 1], [0, 1], [0, 0, 1e7]]) {
            expect(() => molecule3d({ atoms: [{ ...pair.atoms[0], position: position as never }], bonds: [] })).toThrow('three finite coordinates')
        }
        expect(() => molecule3d({ atoms: [pair.atoms[0], pair.atoms[0]], bonds: [] })).toThrow('duplicate atom ID')
        expect(() => molecule3d({ atoms: [pair.atoms[0], { ...pair.atoms[1], position: pair.atoms[0].position }], bonds: [] })).toThrow('coincident coordinates')
        expect(() => molecule3d({ atoms: [{ ...pair.atoms[0], element: 'Xx' as never }], bonds: [] })).toThrow('invalid element')
        expect(() => molecule3d({ ...pair, bonds: [{ from: 'a', to: 'missing', order: 1 }] })).toThrow('unknown atom')
        expect(() => molecule3d({ ...pair, bonds: [{ from: 'a', to: 'a', order: 1 }] })).toThrow('itself')
        expect(() => molecule3d({ ...pair, bonds: [pair.bonds[0], { from: 'b', to: 'a', order: 1 }] })).toThrow('duplicate bond')
        expect(() => molecule3d({ ...pair, bonds: [{ from: 'a', to: 'b', order: 4 as never }] })).toThrow('bond order')
        expect(() => molecule3d(pair, { atomRadius: 2 })).toThrow('reduce atomRadius')
        expect(() => molecule3d(pair, { bondSpacing: 0 })).toThrow('positive and finite')
    })

    it.each([1, 1.5, 2, 3] as const)('renders order %s along each coordinate axis without singular bond offsets', async (order) => {
        for (const end of [[2, 0, 0], [0, 2, 0], [0, 0, 2]] as const) {
            const compiled = await compileFilm(film((s) => {
                s.add(molecule3d({ atoms: [{ ...pair.atoms[0], position: [0, 0, 0] }, { ...pair.atoms[1], position: end }], bonds: [{ from: 'a', to: 'b', order }] }))
                s.wait(1)
            }))
            const svg = frameToSvg(compiled.frame(0.5))
            expect(svg).not.toMatch(/NaN|Infinity/)
            expect(compiled.frame(0.5).ops.length).toBeGreaterThan(100)
        }
    })

    it('animates bonds and camera with deterministic backward scrubbing in both looks', async () => {
        for (const look of ['midnight', 'paper'] as const) {
            const compiled = await compileFilm(film({ look }, (s) => {
                const model = molecule3d(pair)
                expect(model.bond('a', 'b')).toBe(model.bond('b', 'a'))
                expect(() => model.atom('missing')).toThrow('no atom')
                expect(() => model.bond('a', 'missing')).toThrow('no bond')
                s.add(model)
                s.wait(0.5)
                s.play(fadeOut([...model.bond('a', 'b')]), model.orbit({ theta: 0.7 }), { duration: 1 })
                s.wait(0.5)
            }))
            expectPure(compiled, [0.2, 0.9, 1.8])
            const early = compiled.frame(0.2).ops.filter((op) => op.kind === 'path' && op.stroke)
            const late = compiled.frame(1.8).ops.filter((op) => op.kind === 'path' && op.stroke && op.strokeAlpha > 0.01)
            expect(early.length).toBeGreaterThan(0)
            expect(late).toHaveLength(0)
        }
    })

    it('rebinds cloned atom and bond targets without changing the original camera or appearance', async () => {
        let original!: ReturnType<typeof molecule3d>, copy!: ReturnType<typeof molecule3d>
        const compiled = await compileFilm(film((s) => {
            original = molecule3d(pair).at(-250, 0)
            copy = original.clone().at(250, 0)
            expect(copy.atom('a')).not.toBe(original.atom('a'))
            expect(copy.bond('a', 'b')[0]).not.toBe(original.bond('a', 'b')[0])
            expect(copy.atom('a').parent).toBe(copy)
            s.add(original, copy)
            s.play(fadeOut(copy.atom('a')), fadeOut(copy.bond('a', 'b')), copy.orbit({ theta: 1.1 }), { duration: 1 })
            s.wait(0.5)
        }))
        expect(at(1.2, () => [original.atom('a').get('visible'), copy.atom('a').get('visible')])).toEqual([true, false])
        expect(at(1.2, () => original.theta.value)).not.toBe(at(1.2, () => copy.theta.value))
        expectPure(compiled, [0, 0.6, 1.2])
    })
})

// Fixed-column V2000 example with nonzero x/y/z, no inferred hydrogens.
const mol = [
    'Explicit coordinate fixture',
    '  vizmatic          3D',
    '',
    '  2  1  0  0  0  0            999 V2000',
    '   -1.2500    0.5000    2.7500 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '    0.3500   -0.2500    3.5000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  2  0  0  0  0',
    'M  END',
].join('\n')

const explicit: Molecule3DData = {
    atoms: [{ id: '1', element: 'O', position: [-1.25, 0.5, 2.75] }, { id: '2', element: 'C', position: [0.35, -0.25, 3.5] }],
    bonds: [{ from: '1', to: '2', order: 2 }],
}

async function renderMolecule(data: Molecule3DData | string): Promise<string> {
    const compiled = await compileFilm(film((s) => { s.add(molecule3d(data)); s.wait(1) }))
    return frameToSvg(compiled.frame(0.5))
}

describe('molecule3d V2000 MOL/SDF import', () => {
    it.each([1, 2, 3, 4])('preserves coordinates and bond type %s exactly through the renderer', async (type) => {
        const imported = mol.replace('  1  2  2  0', `  1  2  ${type}  0`)
        const supplied: Molecule3DData = { ...explicit, bonds: [{ from: '1', to: '2', order: type === 4 ? 1.5 : type as 1 | 2 | 3 }] }
        expect(await renderMolecule(imported)).toBe(await renderMolecule(supplied))
    })

    it('accepts a single SDF record and CRLF without adding hydrogens or changing planar coordinates', async () => {
        const planar = mol.replace('    2.7500', '    0.0000').replace('    3.5000', '    0.0000')
        const sdf = `${planar}\n>  <NAME>\nExplicit fixture\n\n$$$$\n`.replace(/\n/g, '\r\n')
        expect(await renderMolecule(sdf)).toBe(await renderMolecule({ ...explicit, atoms: explicit.atoms.map((atom) => ({ ...atom, position: [atom.position[0], atom.position[1], 0] })) }))
        expect(() => molecule3d(sdf).atom('3')).toThrow('no atom')
    })

    it.each([
        [mol.replace('V2000', 'V3000'), 'V2000'],
        [mol.replace('  2  1  0', '  x  1  0'), 'atom count'],
        [mol.replace('   -1.2500', '       NaN'), 'coordinate'],
        [mol.replace(' O   0', ' Xx  0'), 'element symbol'],
        [mol.replace('  1  2  2  0', '  1  9  2  0'), 'unknown atom'],
        [mol.replace('  1  2  2  0', '  1  2  8  0'), 'query bonds'],
        [mol.replace('  1  2  2  0', '  1  2  1  1'), 'stereo or topology'],
        [mol.replace(' O   0  0', ' O   0  3'), 'charge, isotope'],
        [mol.replace('M  END', 'M  CHG  1   1  -1\nM  END'), 'property blocks'],
        [mol.replace('M  END', ''), 'M  END'],
        [mol.split('\n').slice(0, 5).join('\n'), 'truncated'],
        [`${mol}\n$$$$\n${mol}\n$$$$`, 'one SDF record'],
        [`${mol}\n>  <NAME>\nmissing delimiter`, 'end with $$$$'],
        [`${mol}\ngarbage\n$$$$`, 'named > <field>'],
    ])('rejects malformed or unsupported records (%s)', (source, message) => {
        expect(() => molecule3d(source)).toThrow(message)
    })
})
