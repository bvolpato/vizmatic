import type { Molecule3DData } from 'vizmatic/stage'

// Schematic Gibbs-energy profiles in arbitrary units. These are author-chosen
// teaching curves, not measured barriers or a computed hydrogenation pathway.
export const direct = [[0, 0], [0.45, 85], [1, -25]] as const
export const catalyzed = [[0, 0], [0.26, 37], [0.5, -5], [0.73, 28], [1, -25]] as const

export function energy(knots: readonly (readonly [number, number])[], x: number): number {
    const i = Math.max(0, Math.min(knots.length - 2, knots.findIndex(([at]) => at >= x) - 1))
    const [a, ya] = knots[i], [b, yb] = knots[i + 1]
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
    return ya + (yb - ya) * (1 - Math.cos(Math.PI * t)) / 2
}

// Author-supplied diagram coordinates. The nickel patch is a visual symbol for
// a catalyst surface, not a crystallographic facet. No force field is applied.
const nickel: Molecule3DData['atoms'] = [-1.8, -0.6, 0.6, 1.8].map((x, i) => ({ id: `ni${i}`, element: 'Ni', position: [x, 0, -1.6] }))
const attached: Molecule3DData['bonds'] = [
    { from: 'c1', to: 'h1', order: 1 }, { from: 'c1', to: 'h2', order: 1 },
    { from: 'c2', to: 'h3', order: 1 }, { from: 'c2', to: 'h4', order: 1 },
]
export const reactants: Molecule3DData = {
    atoms: [
        { id: 'c1', element: 'C', position: [-0.7, 0, 0.5] },
        { id: 'c2', element: 'C', position: [0.7, 0, 0.5] },
        { id: 'h1', element: 'H', position: [-1.3, 0, 1.45] },
        { id: 'h2', element: 'H', position: [-1.3, 0, -0.45] },
        { id: 'h3', element: 'H', position: [1.3, 0, 1.45] },
        { id: 'h4', element: 'H', position: [1.3, 0, -0.45] },
        { id: 'h5', element: 'H', position: [-0.5, 0, 2.9] },
        { id: 'h6', element: 'H', position: [0.5, 0, 2.9] },
        ...nickel,
    ],
    bonds: [...attached, { from: 'c1', to: 'c2', order: 2 }, { from: 'h5', to: 'h6', order: 1 }],
}
export const products: Molecule3DData = {
    atoms: [
        { id: 'c1', element: 'C', position: [-0.77, 0, 0.5] },
        { id: 'c2', element: 'C', position: [0.77, 0, 0.5] },
        { id: 'h1', element: 'H', position: [-1.13, 0.94, 0.5] },
        { id: 'h2', element: 'H', position: [-1.13, -0.47, -0.31] },
        { id: 'h3', element: 'H', position: [1.13, 0.47, 1.31] },
        { id: 'h4', element: 'H', position: [1.13, 0.47, -0.31] },
        { id: 'h5', element: 'H', position: [-1.13, -0.47, 1.31] },
        { id: 'h6', element: 'H', position: [1.13, -0.94, 0.5] },
        ...nickel,
    ],
    bonds: [...attached, { from: 'c1', to: 'c2', order: 1 }, { from: 'c1', to: 'h5', order: 1 }, { from: 'c2', to: 'h6', order: 1 }],
}
