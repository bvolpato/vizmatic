import React from 'react'
import { describe, expect, it } from 'vitest'
import { Resvg } from '@resvg/resvg-js'
import { renderToSvg } from '../src/render'
import { getThemeColors } from '../src/theme'
import {
    MoleculeDiagram,
    ELEMENT_SYMBOLS,
    ReactionEnergyDiagram,
    ReactionEquation,
    reactionBalance,
    type MoleculeAtom,
    type MoleculeBond,
    type ElementComposition,
    type ReactionTerm,
} from '../src/primitives/science-chemistry'

type Element = React.ReactElement<Record<string, unknown> & { children?: unknown }>

function elements(node: unknown, found: Element[] = []): Element[] {
    if (Array.isArray(node)) {
        for (const child of node) elements(child, found)
        return found
    }
    if (!React.isValidElement(node)) return found
    const element = node as Element
    found.push(element)
    elements(element.props.children, found)
    return found
}

function textContent(node: unknown): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textContent).join('')
    if (!React.isValidElement(node)) return ''
    return textContent((node as Element).props.children)
}

function molecule(atoms: MoleculeAtom[], bonds: MoleculeBond[], theme: 'dark' | 'light' = 'light') {
    return MoleculeDiagram({ c: getThemeColors(theme), atoms, bonds })
}

describe('MoleculeDiagram', () => {
    it('fits coordinates at one scale and draws distinct explicit bond orders', () => {
        const diagram = molecule(
            [
                { id: 'a', element: 'C', x: 0, y: 0 },
                { id: 'b', element: 'C', x: 2, y: 0 },
                { id: 'c', element: 'C', x: 4, y: 0 },
                { id: 'd', element: 'C', x: 6, y: 0 },
                { id: 'e', element: 'C', x: 8, y: 0 },
            ],
            [
                { from: 'a', to: 'b', order: 1 },
                { from: 'b', to: 'c', order: 1.5 },
                { from: 'c', to: 'd', order: 2 },
                { from: 'd', to: 'e', order: 3 },
            ],
        )
        const lines = elements(diagram).filter((element) => element.type === 'line')
        const atomCircles = elements(diagram).filter((element) => element.type === 'circle')
        expect(lines).toHaveLength(8)
        expect(lines.filter((line) => line.props['data-bond-order'] === 1)).toHaveLength(1)
        expect(lines.filter((line) => line.props['data-bond-order'] === 1.5)).toHaveLength(2)
        expect(lines.filter((line) => line.props['data-bond-order'] === 2)).toHaveLength(2)
        expect(lines.filter((line) => line.props['data-bond-order'] === 3)).toHaveLength(3)
        expect(lines.some((line) => line.props.strokeDasharray === '3 4')).toBe(true)
        expect(Number(lines[0].props.x1)).toBeGreaterThan(Number(atomCircles[0].props.cx))
        expect(Number(lines[0].props.x2)).toBeLessThan(Number(atomCircles[1].props.cx))

        const square = molecule([
            { id: 'origin', element: 'C', x: 0, y: 0 },
            { id: 'x', element: 'O', x: 1, y: 0 },
            { id: 'y', element: 'N', x: 0, y: 1 },
        ], [])
        const circles = elements(square).filter((element) => element.type === 'circle')
        const dx = Math.abs(Number(circles[0].props.cx) - Number(circles[1].props.cx))
        const dy = Math.abs(Number(circles[0].props.cy) - Number(circles[2].props.cy))
        expect(dx).toBeCloseTo(dy, 8)
    })

    it('keeps element, isotope, charge, and custom labels explicit', () => {
        const diagram = MoleculeDiagram({
            c: getThemeColors('dark'),
            atoms: [{ id: 'carbon-13', element: 'C', x: 0, y: 0, isotope: 13, charge: -1, label: 'labeled carbon' }],
            bonds: [],
            title: 'Carbon ion',
        })
        const text = elements(diagram).map((element) => textContent(element)).join(' ')
        expect(text).toContain('C')
        expect(text).toContain('13')
        expect(text).toContain('1−')
        expect(text).toContain('labeled carbon')
        expect((diagram as Element).props['aria-description']).toContain('explicit bonds')
        expect(elements(diagram).some((element) => element.type === 'text')).toBe(false)
    })

    it('rejects malformed symbols, nonfinite and coincident coordinates, duplicate bonds, and degenerate bond geometry', () => {
        const c = getThemeColors('light')
        expect(() => MoleculeDiagram({ c, atoms: [{ id: 'x', element: 'Xx' as never, x: 0, y: 0 }], bonds: [] }))
            .toThrow('invalid element symbol')
        expect(() => MoleculeDiagram({ c, atoms: [{ id: 'x', element: 'Og', x: Number.NaN, y: 0 }], bonds: [] }))
            .toThrow('finite number')
        expect(() => MoleculeDiagram({ c, atoms: [
            { id: 'x', element: 'C', x: 0, y: 0 }, { id: 'y', element: 'O', x: 0, y: 0 },
        ], bonds: [] })).toThrow('coincident coordinates')
        const pair: MoleculeAtom[] = [
            { id: 'x', element: 'C', x: 0, y: 0 }, { id: 'y', element: 'O', x: 2, y: 0 },
        ]
        expect(() => MoleculeDiagram({ c, atoms: pair, bonds: [
            { from: 'x', to: 'y', order: 1 }, { from: 'y', to: 'x', order: 2 },
        ] })).toThrow('duplicated')
        expect(() => MoleculeDiagram({ c, atoms: pair, bonds: [{ from: 'x', to: 'x', order: 1 }] }))
            .toThrow('itself')
        expect(() => MoleculeDiagram({ c, atoms: [
            { id: 'same', element: 'C', x: 0, y: 0 }, { id: 'same', element: 'O', x: 2, y: 0 },
        ], bonds: [] })).toThrow('duplicated')
        expect(() => MoleculeDiagram({ c, atoms: pair, bonds: [{ from: 'x', to: 'missing', order: 1 }] }))
            .toThrow('unknown atom')
        expect(() => MoleculeDiagram({ c, atoms: pair, bonds: [{ from: 'x', to: 'y', order: 4 as never }] }))
            .toThrow('order must be')
        expect(() => MoleculeDiagram({ c, atoms: Array.from({ length: 65 }, (_, index) => ({ id: `a${index}`, element: 'C' as const, x: index, y: 0 })), bonds: [] }))
            .toThrow('at most 64 atoms')
        expect(() => MoleculeDiagram({ c, atoms: [
            { id: 'x', element: 'C', x: 0, y: 0 },
            { id: 'y', element: 'O', x: 0.01, y: 0 },
            { id: 'extent', element: 'H', x: 0.01, y: 100 },
        ], bonds: [{ from: 'x', to: 'y', order: 1 }] })).toThrow('far enough apart')
    })
})

describe('reactionBalance and ReactionEquation', () => {
    it('weights explicit composition and charge maps by coefficient', () => {
        const reactants: ReactionTerm[] = [
            { formula: 'H₂', coefficient: 2, composition: { H: 2 } },
            { formula: 'O₂', composition: { O: 2 } },
        ]
        const products: ReactionTerm[] = [{ formula: 'H₂O', coefficient: 2, composition: { H: 2, O: 1 } }]
        expect(reactionBalance(reactants, products)).toEqual({
            status: 'balanced',
            balanced: true,
            elementDeltas: { H: 0, O: 0 },
            chargeDelta: 0,
        })

        const ions: ReactionTerm[] = [
            { formula: 'H⁺', composition: { H: 1 }, charge: 1 },
            { formula: 'OH⁻', composition: { H: 1, O: 1 }, charge: -1 },
        ]
        expect(reactionBalance(ions, [{ formula: 'H₂O', composition: { H: 2, O: 1 } }]).status).toBe('balanced')
        expect(reactionBalance([{ formula: 'H⁺', composition: { H: 1 }, charge: 1 }], [
            { formula: 'H', composition: { H: 1 } },
        ])).toMatchObject({ status: 'unbalanced', balanced: false, elementDeltas: { H: 0 }, chargeDelta: -1 })
    })

    it('reports unavailable balance for missing maps and rejects invalid explicit maps', () => {
        expect(reactionBalance([{ formula: 'H₂' }], [{ formula: 'H₂' }])).toEqual({
            status: 'unavailable', reason: 'composition_missing', missingTerms: ['reactants[0]', 'products[0]'],
        })
        expect(reactionBalance([
            { formula: 'H₂', composition: { H: 2 } }, { formula: 'O₂' },
        ], [{ formula: 'H₂O', composition: { H: 2, O: 1 } }])).toMatchObject({
            status: 'unavailable', missingTerms: ['reactants[1]'],
        })
        expect(() => reactionBalance([{ formula: 'H₂', composition: { H: 0 } }], [{ formula: 'H₂', composition: { H: 2 } }]))
            .toThrow('positive integer')
        expect(() => reactionBalance([{ formula: 'mystery', composition: { Xx: 1 } as never }], [{ formula: 'mystery', composition: { H: 1 } }]))
            .toThrow('invalid element symbol')
        expect(() => reactionBalance(
            [{ formula: 'same literal', composition: { H: 2 } }],
            [{ formula: 'same literal', composition: { O: 2 } }],
        )).toThrow('composition maps for literal formula "same literal" are inconsistent')
        expect(() => reactionBalance([{ formula: 'x', coefficient: 0 }], [{ formula: 'x' }])).toThrow('positive integer')
    })

    it('accepts all 118 periodic-table symbols in explicit composition maps', () => {
        expect(ELEMENT_SYMBOLS).toHaveLength(118)
        const composition = Object.fromEntries(ELEMENT_SYMBOLS.map((element) => [element, 1])) as ElementComposition
        expect(reactionBalance(
            [{ formula: 'explicit reactant', composition }],
            [{ formula: 'explicit product', composition }],
        ).status).toBe('balanced')
    })

    it('renders literal Unicode formulas, coefficients, states, conditions, and transparent balance status', async () => {
        const c = getThemeColors('light')
        const equation = ReactionEquation({
            c,
            reactants: [{ formula: 'NH₄⁺', coefficient: 2, state: 'aq' }],
            products: [{ formula: 'N₂', state: 'g' }],
            conditions: 'heat, then cool',
            reversible: true,
        })
        const text = textContent(equation)
        expect(text).toContain('2')
        expect(text).toContain('NH₄⁺')
        expect(text).toContain('(aq)')
        expect(text).toContain('(g)')
        expect(text).toContain('Conditions: heat, then cool')
        expect(text).toContain('Balance unavailable')
        expect((equation as Element).props['aria-label']).toContain('NH₄⁺')

        const complete = ReactionEquation({
            c,
            reactants: [{ formula: 'H₂', composition: { H: 2 } }],
            products: [{ formula: 'H₂', composition: { H: 2 } }],
        })
        expect(textContent(complete)).toContain('Balanced by supplied composition and charge')
    })
})

describe('ReactionEnergyDiagram', () => {
    it('keeps endpoints fixed, lowers the catalytic peak, and reveals paths by progress', () => {
        const chart = ReactionEnergyDiagram({
            c: getThemeColors('dark'),
            reactants: 20,
            products: -40,
            barrier: 120,
            catalyzedBarrier: 65,
            unit: 'kJ/mol',
            progress: 0.6,
        })
        const paths = elements(chart).filter((element) => element.type === 'path')
        expect(paths).toHaveLength(2)
        const uncat = paths.find((path) => path.props['data-energy-path'] === 'uncatalyzed')!
        const cat = paths.find((path) => path.props['data-energy-path'] === 'catalyzed')!
        expect(uncat.props['data-progress']).toBe(0.6)
        expect(uncat.props.pathLength).toBeUndefined()
        expect(uncat.props.strokeDasharray).toBeUndefined()
        expect(uncat.props.clipPath).toContain('reaction-energy-reveal')
        const uncatNumbers = String(uncat.props.d).match(/-?\d+(?:\.\d+)?/g)!.map(Number)
        const catNumbers = String(cat.props.d).match(/-?\d+(?:\.\d+)?/g)!.map(Number)
        expect(uncatNumbers.slice(0, 2)).toEqual(catNumbers.slice(0, 2))
        expect(uncatNumbers.slice(-2)).toEqual(catNumbers.slice(-2))
        expect(uncatNumbers[5]).toBeLessThan(catNumbers[5])
        expect(textContent(chart)).toContain('Ea (uncatalyzed) = 100 kJ/mol')
        expect(textContent(chart)).toContain('Ea (catalyzed) = 45 kJ/mol')
        expect(textContent(chart)).toContain('ΔE = −60 kJ/mol')
        expect((chart as Element).props['aria-description']).toContain('endpoints are unchanged')
    })

    it('rasterizes an empty path at progress zero and a continuous curve at progress one', async () => {
        const c = getThemeColors('light')
        const render = async (progress: number) => {
            const element = ReactionEnergyDiagram({ c, reactants: 20, products: -40, barrier: 120, unit: 'kJ/mol', progress })
            const svg = await renderToSvg(element, 760, 400, { theme: 'light' })
            return new Resvg(svg).render()
        }
        const empty = await render(0)
        const full = await render(1)
        const redPixels = (image: typeof full, xStart: number, xEnd: number, yStart: number, yEnd: number) => {
            const pixels = image.pixels
            let count = 0
            for (let y = yStart; y < yEnd; y += 1) {
                for (let x = xStart; x < xEnd; x += 1) {
                    const offset = (y * image.width + x) * 4
                    if (pixels[offset] > 120 && pixels[offset + 1] < 100 && pixels[offset + 2] < 100 && pixels[offset + 3] > 100) count += 1
                }
            }
            return count
        }
        expect(redPixels(empty, 150, 650, 60, 282)).toBe(0)
        for (const start of [150, 250, 350, 450, 550, 600]) {
            expect(redPixels(full, start, start + 45, 60, 282)).toBeGreaterThan(10)
        }
    })

    it('rejects nonfinite values, impossible barriers, invalid progress, and unbounded dimensions', () => {
        const c = getThemeColors('light')
        const base = { c, reactants: 0, products: -2, barrier: 4 }
        expect(() => ReactionEnergyDiagram({ ...base, reactants: Number.NaN })).toThrow('finite number')
        expect(() => ReactionEnergyDiagram({ ...base, barrier: -3 })).toThrow('at least the higher endpoint')
        expect(() => ReactionEnergyDiagram({ ...base, catalyzedBarrier: 5 })).toThrow('must be lower')
        expect(() => ReactionEnergyDiagram({ ...base, catalyzedBarrier: 4 })).toThrow('must be lower')
        expect(() => ReactionEnergyDiagram({ ...base, catalyzedBarrier: -3 })).toThrow('at least the higher endpoint')
        expect(() => ReactionEnergyDiagram({ ...base, progress: 1.1 })).toThrow('progress')
        expect(() => ReactionEnergyDiagram({ ...base, width: 5000 })).toThrow('width must be between')
        expect(() => ReactionEnergyDiagram({ ...base, height: Number.POSITIVE_INFINITY })).toThrow('finite number')
    })
})

describe('science chemistry render compatibility', () => {
    it('renders chemistry components through the standard renderer in light and dark themes', async () => {
        for (const theme of ['light', 'dark'] as const) {
            const c = getThemeColors(theme)
            const moleculeView = MoleculeDiagram({
                c,
                atoms: [{ id: 'c', element: 'C', x: 0, y: 0 }, { id: 'o', element: 'O', x: 1, y: 0, isotope: 18 }],
                bonds: [{ from: 'c', to: 'o', order: 2 }],
            })
            const energyView = ReactionEnergyDiagram({ c, reactants: 2, products: -1, barrier: 5, catalyzedBarrier: 3, unit: 'kJ/mol' })
            const equationView = ReactionEquation({
                c,
                reactants: [{ formula: 'H₂', composition: { H: 2 }, state: 'g' }],
                products: [{ formula: '2H⁺', composition: { H: 1 }, coefficient: 2, state: 'aq' }],
                reversible: true,
            })
            const [moleculeSvg, energySvg, equationSvg] = await Promise.all([
                renderToSvg(moleculeView, 520, 360, { theme }),
                renderToSvg(energyView, 760, 400, { theme }),
                renderToSvg(equationView, 760, 200, { theme }),
            ])
            expect(moleculeSvg).toContain('data-atom-id')
            expect(moleculeSvg).toContain('data-element')
            expect(energySvg).toContain('data-energy-path')
            expect(equationSvg).toContain('<svg')
            expect(moleculeSvg).not.toContain('<text')
            expect(energySvg).not.toContain('<text')
        }
    })
})
