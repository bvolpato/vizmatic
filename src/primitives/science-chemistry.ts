import React from 'react'
import { getReadableColor, getReadableTextColor, type ThemeColors } from '../theme'
import { SvgMathText } from './layout'

type OverlayTextProps = Parameters<typeof SvgMathText>[0]

function overlayText(key: React.Key, props: OverlayTextProps): React.ReactElement {
    return React.createElement(React.Fragment, { key }, SvgMathText(props))
}

/** IUPAC element symbols. Runtime validation uses this complete periodic table. */
export type ElementSymbol =
    | 'H' | 'He' | 'Li' | 'Be' | 'B' | 'C' | 'N' | 'O' | 'F' | 'Ne'
    | 'Na' | 'Mg' | 'Al' | 'Si' | 'P' | 'S' | 'Cl' | 'Ar'
    | 'K' | 'Ca' | 'Sc' | 'Ti' | 'V' | 'Cr' | 'Mn' | 'Fe' | 'Co' | 'Ni' | 'Cu' | 'Zn'
    | 'Ga' | 'Ge' | 'As' | 'Se' | 'Br' | 'Kr'
    | 'Rb' | 'Sr' | 'Y' | 'Zr' | 'Nb' | 'Mo' | 'Tc' | 'Ru' | 'Rh' | 'Pd' | 'Ag' | 'Cd'
    | 'In' | 'Sn' | 'Sb' | 'Te' | 'I' | 'Xe'
    | 'Cs' | 'Ba' | 'La' | 'Ce' | 'Pr' | 'Nd' | 'Pm' | 'Sm' | 'Eu' | 'Gd' | 'Tb' | 'Dy' | 'Ho' | 'Er' | 'Tm' | 'Yb' | 'Lu'
    | 'Hf' | 'Ta' | 'W' | 'Re' | 'Os' | 'Ir' | 'Pt' | 'Au' | 'Hg'
    | 'Tl' | 'Pb' | 'Bi' | 'Po' | 'At' | 'Rn'
    | 'Fr' | 'Ra' | 'Ac' | 'Th' | 'Pa' | 'U' | 'Np' | 'Pu' | 'Am' | 'Cm' | 'Bk' | 'Cf' | 'Es' | 'Fm' | 'Md' | 'No' | 'Lr'
    | 'Rf' | 'Db' | 'Sg' | 'Bh' | 'Hs' | 'Mt' | 'Ds' | 'Rg' | 'Cn' | 'Nh' | 'Fl' | 'Mc' | 'Lv' | 'Ts' | 'Og'

const ELEMENTS = new Set<ElementSymbol>([
    'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
    'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
    'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
    'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
    'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac',
    'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh',
    'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
])
export const ELEMENT_SYMBOLS: readonly ElementSymbol[] = Object.freeze(Array.from(ELEMENTS))

export type MoleculeAtomId = string
export type MoleculeBondOrder = 1 | 1.5 | 2 | 3

/** An explicitly positioned atom; x/y are arbitrary diagram units, not pixels. */
export interface MoleculeAtom {
    id: MoleculeAtomId
    element: ElementSymbol
    x: number
    y: number
    charge?: number
    isotope?: number
    /** Optional secondary label. The element symbol is always shown. */
    label?: string
}

/** A bond joins two atom IDs. No valence or stereochemistry is inferred. */
export interface MoleculeBond {
    from: MoleculeAtomId
    to: MoleculeAtomId
    order: MoleculeBondOrder
}

export interface MoleculeDiagramProps {
    c: ThemeColors
    atoms: MoleculeAtom[]
    bonds: MoleculeBond[]
    width?: number
    height?: number
    title?: string
}

const MOLECULE_LIMITS = { atoms: 64, bonds: 96, width: [300, 1200], height: [240, 900] } as const

function finiteNumber(value: unknown, description: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${description} must be a finite number.`)
    }
}

function boundedDimension(value: number, label: string, min: number, max: number): number {
    finiteNumber(value, `${label}`)
    if (value < min || value > max) throw new RangeError(`${label} must be between ${min} and ${max} pixels.`)
    return value
}

function isElementSymbol(value: unknown): value is ElementSymbol {
    return typeof value === 'string' && ELEMENTS.has(value as ElementSymbol)
}

function validateMolecule(atoms: MoleculeAtom[], bonds: MoleculeBond[]): void {
    if (!Array.isArray(atoms) || atoms.length < 1) throw new TypeError('MoleculeDiagram needs at least one atom.')
    if (atoms.length > MOLECULE_LIMITS.atoms) throw new RangeError(`MoleculeDiagram supports at most ${MOLECULE_LIMITS.atoms} atoms.`)
    if (!Array.isArray(bonds)) throw new TypeError('MoleculeDiagram bonds must be an array.')
    if (bonds.length > MOLECULE_LIMITS.bonds) throw new RangeError(`MoleculeDiagram supports at most ${MOLECULE_LIMITS.bonds} bonds.`)

    const ids = new Set<string>()
    const positions = new Map<string, string>()
    for (const [index, atom] of atoms.entries()) {
        if (!atom || typeof atom !== 'object') throw new TypeError(`MoleculeDiagram atom ${index} must be an object.`)
        if (typeof atom.id !== 'string' || atom.id.trim().length === 0) throw new TypeError(`MoleculeDiagram atom ${index} needs a non-empty ID.`)
        if (ids.has(atom.id)) throw new TypeError(`MoleculeDiagram atom ID "${atom.id}" is duplicated.`)
        ids.add(atom.id)
        if (!isElementSymbol(atom.element)) throw new TypeError(`MoleculeDiagram atom "${atom.id}" has an invalid element symbol.`)
        finiteNumber(atom.x, `MoleculeDiagram atom "${atom.id}" x`)
        finiteNumber(atom.y, `MoleculeDiagram atom "${atom.id}" y`)
        if (atom.charge !== undefined && (!Number.isSafeInteger(atom.charge) || Math.abs(atom.charge) > 99)) {
            throw new TypeError(`MoleculeDiagram atom "${atom.id}" charge must be an integer between -99 and 99.`)
        }
        if (atom.isotope !== undefined && (!Number.isSafeInteger(atom.isotope) || atom.isotope <= 0 || atom.isotope > 300)) {
            throw new TypeError(`MoleculeDiagram atom "${atom.id}" isotope must be a positive integer no greater than 300.`)
        }
        if (atom.label !== undefined && (typeof atom.label !== 'string' || atom.label.length > 32)) {
            throw new TypeError(`MoleculeDiagram atom "${atom.id}" label must be a string of at most 32 characters.`)
        }
        const positionKey = `${atom.x},${atom.y}`
        const existing = positions.get(positionKey)
        if (existing) throw new TypeError(`MoleculeDiagram atoms "${existing}" and "${atom.id}" have coincident coordinates.`)
        positions.set(positionKey, atom.id)
    }

    const bondPairs = new Set<string>()
    for (const [index, bond] of bonds.entries()) {
        if (!bond || typeof bond !== 'object') throw new TypeError(`MoleculeDiagram bond ${index} must be an object.`)
        if (typeof bond.from !== 'string' || typeof bond.to !== 'string') throw new TypeError(`MoleculeDiagram bond ${index} needs atom IDs for both endpoints.`)
        if (!ids.has(bond.from)) throw new TypeError(`MoleculeDiagram bond ${index} references unknown atom "${bond.from}".`)
        if (!ids.has(bond.to)) throw new TypeError(`MoleculeDiagram bond ${index} references unknown atom "${bond.to}".`)
        if (bond.from === bond.to) throw new TypeError(`MoleculeDiagram bond ${index} cannot connect an atom to itself.`)
        if (![1, 1.5, 2, 3].includes(bond.order)) throw new TypeError(`MoleculeDiagram bond ${index} order must be 1, 1.5, 2, or 3.`)
        const pairKey = bond.from < bond.to ? `${bond.from}\u0000${bond.to}` : `${bond.to}\u0000${bond.from}`
        if (bondPairs.has(pairKey)) throw new TypeError(`MoleculeDiagram bond "${bond.from}"–"${bond.to}" is duplicated.`)
        bondPairs.add(pairKey)
    }
}

interface Point { x: number; y: number }

function moleculeLayout(atoms: MoleculeAtom[], width: number, height: number, titleInset: number): Map<string, Point> {
    const left = 42
    const right = width - 42
    const top = titleInset
    const bottom = height - 42
    const maxAbs = Math.max(...atoms.flatMap((atom) => [Math.abs(atom.x), Math.abs(atom.y)]))
    if (maxAbs === 0) return new Map(atoms.map((atom) => [atom.id, { x: width / 2, y: (top + bottom) / 2 }]))

    // Normalize x and y by the same scale to preserve equal-unit geometry even
    // when valid finite input values are close to Number.MAX_VALUE.
    const normalized = atoms.map((atom) => ({ atom, x: atom.x / maxAbs, y: atom.y / maxAbs }))
    const minX = Math.min(...normalized.map((point) => point.x))
    const maxX = Math.max(...normalized.map((point) => point.x))
    const minY = Math.min(...normalized.map((point) => point.y))
    const maxY = Math.max(...normalized.map((point) => point.y))
    const spanX = maxX - minX
    const spanY = maxY - minY
    const plotWidth = right - left
    const plotHeight = bottom - top
    const scale = spanX === 0 && spanY === 0
        ? 1
        : Math.min(spanX === 0 ? Number.POSITIVE_INFINITY : plotWidth / spanX, spanY === 0 ? Number.POSITIVE_INFINITY : plotHeight / spanY)
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    return new Map(normalized.map(({ atom, x, y }) => [atom.id, {
        x: (left + right) / 2 + (x - centerX) * scale,
        y: (top + bottom) / 2 - (y - centerY) * scale,
    }]))
}

interface BondSegment { x1: number; y1: number; x2: number; y2: number; dashed: boolean }

function bondSegments(from: Point, to: Point, order: MoleculeBondOrder, atomRadius = 19): BondSegment[] {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy)
    if (!Number.isFinite(length) || length <= atomRadius * 2) {
        throw new RangeError('MoleculeDiagram bond endpoints must be far enough apart to draw atom labels.')
    }
    const ux = dx / length
    const uy = dy / length
    const nx = -uy
    const ny = ux
    const offsets = order === 1 ? [0] : order === 3 ? [-4.6, 0, 4.6] : [-3.2, 3.2]
    const start = atomRadius + 1
    const end = length - atomRadius - 1
    return offsets.map((offset, index) => ({
        x1: from.x + ux * start + nx * offset,
        y1: from.y + uy * start + ny * offset,
        x2: from.x + ux * end + nx * offset,
        y2: from.y + uy * end + ny * offset,
        dashed: order === 1.5 && index === 1,
    }))
}

function atomColor(element: ElementSymbol, c: ThemeColors): string {
    if (element === 'O' || element === 'S' || element === 'Se') return getReadableColor('critical', c)
    if (element === 'N' || element === 'P') return getReadableColor('info', c)
    if (element === 'F' || element === 'Cl' || element === 'Br' || element === 'I') return getReadableColor('positive', c)
    if (element === 'C') return c.textPrimary
    return getReadableColor('secondary', c)
}

/**
 * Draws only the atoms and bonds explicitly supplied by the caller. Coordinates
 * are uniformly scaled diagram units; this component makes no valence, 3D, or
 * stereochemistry claims.
 */
export function MoleculeDiagram({
    c,
    atoms,
    bonds,
    width = 520,
    height = 360,
    title,
}: MoleculeDiagramProps): React.ReactElement {
    if (title !== undefined && (typeof title !== 'string' || title.length > 64)) {
        throw new TypeError('MoleculeDiagram title must be a string of at most 64 characters.')
    }
    validateMolecule(atoms, bonds)
    const svgWidth = boundedDimension(width, 'MoleculeDiagram width', ...MOLECULE_LIMITS.width)
    const svgHeight = boundedDimension(height, 'MoleculeDiagram height', ...MOLECULE_LIMITS.height)
    const points = moleculeLayout(atoms, svgWidth, svgHeight, title ? 60 : 48)
    const accessibleTitle = title ?? 'Molecule diagram'
    const description = `${atoms.length} explicitly positioned atoms and ${bonds.length} explicit bonds. Bond order does not imply inferred valence, three-dimensional geometry, or stereochemistry.`
    const bondNodes = bonds.flatMap((bond, bondIndex) => {
        const from = points.get(bond.from)!
        const to = points.get(bond.to)!
        return bondSegments(from, to, bond.order).map((segment, segmentIndex) => React.createElement('line', {
            key: `bond-${bondIndex}-${segmentIndex}`,
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2,
            stroke: c.textSecondary,
            strokeWidth: bond.order === 1 ? 2.5 : 2,
            strokeLinecap: 'round',
            ...(segment.dashed ? { strokeDasharray: '3 4' } : {}),
            'data-bond-from': bond.from,
            'data-bond-to': bond.to,
            'data-bond-order': bond.order,
            'data-bond-line-index': segmentIndex,
            'aria-hidden': true,
        }))
    })
    const atomNodes = atoms.map((atom) => {
        const point = points.get(atom.id)!
        const accent = atomColor(atom.element, c)
        return React.createElement('g', { key: atom.id, 'data-atom-id': atom.id, 'data-element': atom.element },
            React.createElement('circle', { cx: point.x, cy: point.y, r: 19, fill: c.bgCard, stroke: accent, strokeWidth: 2 }),
        )
    })
    const textNodes = atoms.flatMap((atom) => {
        const point = points.get(atom.id)!
        const labelY = point.y + 34 <= svgHeight - 10 ? point.y + 34 : point.y - 25
        return [
            overlayText(`atom-${atom.id}-element`, { text: atom.element, x: point.x, y: point.y + 1, fill: atomColor(atom.element, c), fontSize: atom.element.length === 1 ? 17 : 14, fontFamily: c.fontSans, fontWeight: 700 }),
            ...(atom.isotope === undefined ? [] : [overlayText(`atom-${atom.id}-isotope`, { text: String(atom.isotope), x: point.x - 15, y: point.y - 12, fill: c.textPrimary, fontSize: 10, fontFamily: c.fontSans, fontWeight: 700, textAnchor: 'end' })]),
            ...(atom.charge === undefined || atom.charge === 0 ? [] : [overlayText(`atom-${atom.id}-charge`, { text: `${Math.abs(atom.charge)}${atom.charge > 0 ? '+' : '−'}`, x: point.x + 15, y: point.y - 12, fill: c.textPrimary, fontSize: 10, fontFamily: c.fontSans, fontWeight: 700, textAnchor: 'start' })]),
            ...(atom.label ? [overlayText(`atom-${atom.id}-label`, { text: atom.label, x: point.x, y: labelY, fill: c.textSecondary, fontSize: 10, fontFamily: c.fontSans, textAnchor: 'middle' })] : []),
        ]
    })
    const geometry = React.createElement('svg', {
        width: svgWidth,
        height: svgHeight,
        viewBox: `0 0 ${svgWidth} ${svgHeight}`,
        'aria-hidden': true,
        style: { position: 'absolute' as const, left: 0, top: 0, display: 'block' },
    },
        React.createElement('rect', { x: 0, y: 0, width: svgWidth, height: svgHeight, rx: 14, fill: c.bgCard, stroke: c.borderSubtle }),
        ...bondNodes,
        ...atomNodes,
    )
    return React.createElement('div', {
        role: 'img',
        'aria-label': accessibleTitle,
        'aria-description': description,
        title: accessibleTitle,
        'data-vizmatic-component': 'MoleculeDiagram',
        style: { position: 'relative', width: svgWidth, height: svgHeight, overflow: 'hidden' },
    },
        geometry,
        ...(title ? [overlayText('molecule-title', { text: title, x: svgWidth / 2, y: 24, fill: c.textPrimary, fontSize: 15, fontFamily: c.fontSans, fontWeight: 700 })] : []),
        ...textNodes,
    )
}

export type ReactionState = 's' | 'l' | 'g' | 'aq'

/** Sparse element counts supplied explicitly by the author; omitted elements are zero. */
export type ElementComposition = Partial<Record<ElementSymbol, number>>

export interface ReactionTerm {
    /** Displayed verbatim. It is never parsed to infer atom counts. */
    formula: string
    coefficient?: number
    state?: ReactionState
    /** A complete explicit element-count map for this term, when available. */
    composition?: ElementComposition
    /** Charge for this complete explicit term; omission means neutral. */
    charge?: number
}

export interface ReactionEquationProps {
    c: ThemeColors
    reactants: ReactionTerm[]
    products: ReactionTerm[]
    conditions?: string
    reversible?: boolean
    width?: number
}

export type ReactionBalanceResult =
    | { status: 'unavailable'; reason: 'composition_missing'; missingTerms: string[] }
    | {
        status: 'balanced' | 'unbalanced'
        balanced: boolean
        /** Product totals minus reactant totals, weighted by each coefficient. */
        elementDeltas: Partial<Record<ElementSymbol, number>>
        /** Product charge minus reactant charge, weighted by each coefficient. */
        chargeDelta: number
    }

const MAX_REACTION_TERMS = 16
const MAX_FORMULA_LENGTH = 256

function validateComposition(composition: unknown, description: string): asserts composition is ElementComposition {
    if (!composition || typeof composition !== 'object' || Array.isArray(composition)) {
        throw new TypeError(`${description} must be an element-count object.`)
    }
    const entries = Object.entries(composition)
    if (entries.length === 0) throw new TypeError(`${description} must contain at least one explicit element count.`)
    for (const [element, count] of entries) {
        if (!isElementSymbol(element)) throw new TypeError(`${description} contains invalid element symbol "${element}".`)
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0 || count > 1_000_000) {
            throw new TypeError(`${description} count for ${element} must be a positive integer no greater than 1000000.`)
        }
    }
}

function validateReactionTerms(terms: ReactionTerm[], side: string): void {
    if (!Array.isArray(terms) || terms.length === 0) throw new TypeError(`ReactionEquation ${side} must contain at least one term.`)
    if (terms.length > MAX_REACTION_TERMS) throw new RangeError(`ReactionEquation ${side} supports at most ${MAX_REACTION_TERMS} terms.`)
    for (const [index, term] of terms.entries()) {
        if (!term || typeof term !== 'object') throw new TypeError(`ReactionEquation ${side}[${index}] must be an object.`)
        if (typeof term.formula !== 'string' || term.formula.trim().length === 0) {
            throw new TypeError(`ReactionEquation ${side}[${index}] formula must be a non-empty string.`)
        }
        if (term.formula.length > MAX_FORMULA_LENGTH) {
            throw new RangeError(`ReactionEquation ${side}[${index}] formula must be at most ${MAX_FORMULA_LENGTH} characters.`)
        }
        if (term.coefficient !== undefined && (!Number.isSafeInteger(term.coefficient) || term.coefficient <= 0 || term.coefficient > 1_000_000)) {
            throw new TypeError(`ReactionEquation ${side}[${index}] coefficient must be a positive integer no greater than 1000000.`)
        }
        if (term.state !== undefined && !['s', 'l', 'g', 'aq'].includes(term.state)) {
            throw new TypeError(`ReactionEquation ${side}[${index}] state must be s, l, g, or aq.`)
        }
        if (term.charge !== undefined && (!Number.isSafeInteger(term.charge) || Math.abs(term.charge) > 1_000_000)) {
            throw new TypeError(`ReactionEquation ${side}[${index}] charge must be an integer between -1000000 and 1000000.`)
        }
        if (term.composition !== undefined) validateComposition(term.composition, `ReactionEquation ${side}[${index}] composition`)
    }
}

/**
 * Checks only the explicit element maps and charges provided by the caller.
 * Formula strings are never parsed. Every term needs a complete composition map
 * before the function can report a balance result; an omitted map is unavailable.
 */
export function reactionBalance(reactants: ReactionTerm[], products: ReactionTerm[]): ReactionBalanceResult {
    validateReactionTerms(reactants, 'reactants')
    validateReactionTerms(products, 'products')
    const compositionByFormula = new Map<string, string>()
    for (const term of [...reactants, ...products]) {
        if (!term.composition) continue
        const signature = JSON.stringify(Object.fromEntries(Object.entries(term.composition).sort(([left], [right]) => left.localeCompare(right))))
        const prior = compositionByFormula.get(term.formula)
        if (prior !== undefined && prior !== signature) {
            throw new TypeError(`ReactionEquation composition maps for literal formula "${term.formula}" are inconsistent.`)
        }
        compositionByFormula.set(term.formula, signature)
    }
    const missingTerms = [
        ...reactants.flatMap((term, index) => term.composition ? [] : [`reactants[${index}]`]),
        ...products.flatMap((term, index) => term.composition ? [] : [`products[${index}]`]),
    ]
    if (missingTerms.length > 0) return { status: 'unavailable', reason: 'composition_missing', missingTerms }

    const deltas: Partial<Record<ElementSymbol, number>> = {}
    let chargeDelta = 0
    const addSide = (terms: ReactionTerm[], sign: 1 | -1) => {
        for (const term of terms) {
            const coefficient = term.coefficient ?? 1
            for (const [element, count] of Object.entries(term.composition!)) {
                const symbol = element as ElementSymbol
                deltas[symbol] = (deltas[symbol] ?? 0) + sign * coefficient * count
            }
            chargeDelta += sign * coefficient * (term.charge ?? 0)
        }
    }
    addSide(reactants, -1)
    addSide(products, 1)
    const balanced = Object.values(deltas).every((delta) => delta === 0) && chargeDelta === 0
    return { status: balanced ? 'balanced' : 'unbalanced', balanced, elementDeltas: deltas, chargeDelta }
}

function equationTerm(term: ReactionTerm, index: number, c: ThemeColors): React.ReactElement {
    return React.createElement('span', {
        key: `term-${index}-${term.formula}`,
        style: {
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            minWidth: 0,
            maxWidth: '100%',
            overflowWrap: 'anywhere',
            color: c.textPrimary,
        },
    },
        term.coefficient && term.coefficient !== 1
            ? React.createElement('span', { style: { color: getReadableColor('primary', c), fontWeight: 700, marginRight: 5 } }, `${term.coefficient}`)
            : null,
        React.createElement('span', { style: { overflowWrap: 'anywhere' } }, term.formula),
        term.state
            ? React.createElement('span', { style: { marginLeft: 5, color: c.textSecondary, fontSize: '0.9em' } }, `(${term.state})`)
            : null,
    )
}

function equationSide(terms: ReactionTerm[], label: string, c: ThemeColors): React.ReactElement {
    const children: React.ReactNode[] = []
    terms.forEach((term, index) => {
        if (index > 0) children.push(React.createElement('span', {
            key: `plus-${index}`,
            style: { color: c.textSecondary, padding: '0 7px', flex: '0 0 auto' },
            'aria-hidden': true,
        }, '+'))
        children.push(equationTerm(term, index, c))
    })
    return React.createElement('div', {
        role: 'group',
        'aria-label': label,
        style: {
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            alignContent: 'center',
            gap: '8px 0',
            flex: '1 1 0',
            minWidth: 0,
            lineHeight: 1.5,
            fontSize: 20,
        },
    }, ...children)
}

/**
 * Displays literal formula strings. Balance is computed only from complete,
 * caller-supplied composition maps, never by parsing the displayed formulas.
 */
export function ReactionEquation({
    c,
    reactants,
    products,
    conditions,
    reversible = false,
    width = 760,
}: ReactionEquationProps): React.ReactElement {
    validateReactionTerms(reactants, 'reactants')
    validateReactionTerms(products, 'products')
    const equationWidth = boundedDimension(width, 'ReactionEquation width', 420, 1400)
    if (conditions !== undefined && typeof conditions !== 'string') throw new TypeError('ReactionEquation conditions must be a string.')
    if (conditions !== undefined && conditions.length > 240) throw new RangeError('ReactionEquation conditions must be at most 240 characters.')
    const balance = reactionBalance(reactants, products)
    const accessibleEquation = `${reactants.map((term) => `${term.coefficient && term.coefficient !== 1 ? `${term.coefficient} ` : ''}${term.formula}${term.state ? ` (${term.state})` : ''}`).join(' + ')} ${reversible ? 'reversibly yields' : 'yields'} ${products.map((term) => `${term.coefficient && term.coefficient !== 1 ? `${term.coefficient} ` : ''}${term.formula}${term.state ? ` (${term.state})` : ''}`).join(' + ')}`
    const balanceText = balance.status === 'unavailable'
        ? 'Balance unavailable: provide a complete composition map for every term.'
        : balance.balanced
            ? 'Balanced by supplied composition and charge.'
            : `Not balanced by supplied composition and charge: ${Object.entries(balance.elementDeltas).filter(([, delta]) => delta !== 0).map(([element, delta]) => `${element} ${delta! > 0 ? '+' : ''}${delta}`).join(', ') || 'elements conserved'}, charge ${balance.chargeDelta > 0 ? '+' : ''}${balance.chargeDelta}.`
    return React.createElement('div', {
        role: 'img',
        'aria-label': `${accessibleEquation}. ${balanceText}${conditions ? ` Conditions: ${conditions}.` : ''}`,
        'data-vizmatic-component': 'ReactionEquation',
        style: {
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            width: equationWidth,
            maxWidth: '100%',
            padding: 18,
            border: `1px solid ${c.borderSubtle}`,
            borderRadius: 14,
            background: c.bgCard,
            color: c.textPrimary,
            fontFamily: c.fontSans,
        },
    },
        React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 },
        },
            equationSide(reactants, 'Reactants', c),
            React.createElement('span', {
                style: { flex: '0 0 auto', color: c.primaryLight, fontSize: 26, fontWeight: 700, padding: '0 2px' },
                'aria-hidden': true,
            }, reversible ? '⇌' : '→'),
            equationSide(products, 'Products', c),
        ),
        conditions !== undefined && conditions.length > 0
            ? React.createElement('div', { style: { color: c.textSecondary, fontSize: 13 } }, `Conditions: ${conditions}`)
            : null,
        React.createElement('div', {
            style: {
                paddingTop: 8,
                borderTop: `1px solid ${c.borderSubtle}`,
                color: balance.status === 'balanced' ? getReadableColor('positive', c) : balance.status === 'unbalanced' ? getReadableColor('critical', c) : c.textSecondary,
                fontSize: 13,
                lineHeight: 1.4,
            },
        }, balanceText),
    )
}

export interface ReactionEnergyDiagramProps {
    c: ThemeColors
    ariaLabel?: string
    /** Explicit relative energy for the reactant endpoint, in the supplied unit. */
    reactants: number
    /** Explicit relative energy for the product endpoint, in the supplied unit. */
    products: number
    /** Absolute peak energy for the uncatalyzed path, in the supplied unit. */
    barrier: number
    /** Absolute peak energy for the catalyzed path; endpoints remain unchanged. */
    catalyzedBarrier?: number
    /** Caller-supplied energy unit. Values are not converted or simulated. */
    unit?: string
    reactantLabel?: string
    productLabel?: string
    width?: number
    height?: number
    /** Static path reveal from 0 to 1; does not change the path or its endpoints. */
    progress?: number
}

const ENERGY_LIMITS = { width: [520, 1200], height: [320, 900], absValue: 1_000_000_000 } as const

function energyText(value: number): string {
    if (Object.is(value, -0) || value === 0) return '0'
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function signedEnergyText(value: number): string {
    return value > 0 ? `+${energyText(value)}` : value < 0 ? `−${energyText(Math.abs(value))}` : '0'
}

function validateEnergyValue(value: number, label: string): void {
    finiteNumber(value, `ReactionEnergyDiagram ${label}`)
    if (Math.abs(value) > ENERGY_LIMITS.absValue) {
        throw new RangeError(`ReactionEnergyDiagram ${label} must be between -${ENERGY_LIMITS.absValue} and ${ENERGY_LIMITS.absValue}.`)
    }
}

function energyPath(x0: number, y0: number, xPeak: number, yPeak: number, x1: number, y1: number): string {
    const leftControl = x0 + (xPeak - x0) * 0.58
    const rightControl = xPeak + (x1 - xPeak) * 0.42
    const leftStartControl = x0 + (xPeak - x0) * 0.42
    const rightEndControl = xPeak + (x1 - xPeak) * 0.58
    return `M ${x0} ${y0} C ${leftStartControl} ${y0}, ${leftControl} ${yPeak}, ${xPeak} ${yPeak} C ${rightControl} ${yPeak}, ${rightEndControl} ${y1}, ${x1} ${y1}`
}

function measurement(x: number, y1: number, y2: number, color: string, key: string, label: string): React.ReactElement {
    const top = Math.min(y1, y2)
    const bottom = Math.max(y1, y2)
    const cap = 5
    return React.createElement('g', { key, 'data-measurement': label, 'aria-hidden': true },
        React.createElement('line', { x1: x, y1: top, x2: x, y2: bottom, stroke: color, strokeWidth: 1.5, strokeDasharray: '3 3' }),
        React.createElement('line', { x1: x - cap, y1: top, x2: x + cap, y2: top, stroke: color, strokeWidth: 1.5 }),
        React.createElement('line', { x1: x - cap, y1: bottom, x2: x + cap, y2: bottom, stroke: color, strokeWidth: 1.5 }),
    )
}

/**
 * Shows an illustrative energy profile from caller-supplied values. It derives
 * Ea and ΔE in that unit only; it does not convert units or simulate kinetics.
 * A catalyst changes the path peak while both paths retain the same endpoints.
 */
export function ReactionEnergyDiagram({
    c,
    ariaLabel,
    reactants,
    products,
    barrier,
    catalyzedBarrier,
    unit = 'energy units',
    reactantLabel = 'Reactants',
    productLabel = 'Products',
    width = 760,
    height = 400,
    progress = 1,
}: ReactionEnergyDiagramProps): React.ReactElement {
    validateEnergyValue(reactants, 'reactants')
    validateEnergyValue(products, 'products')
    validateEnergyValue(barrier, 'barrier')
    if (catalyzedBarrier !== undefined) validateEnergyValue(catalyzedBarrier, 'catalyzedBarrier')
    if (barrier < Math.max(reactants, products)) {
        throw new RangeError('ReactionEnergyDiagram barrier must be at least the higher endpoint energy.')
    }
    if (catalyzedBarrier !== undefined && catalyzedBarrier < Math.max(reactants, products)) {
        throw new RangeError('ReactionEnergyDiagram catalyzedBarrier must be at least the higher endpoint energy.')
    }
    if (catalyzedBarrier !== undefined && catalyzedBarrier >= barrier) {
        throw new RangeError('ReactionEnergyDiagram catalyzedBarrier must be lower than the uncatalyzed barrier.')
    }
    if (typeof unit !== 'string' || unit.trim().length === 0 || unit.length > 32) {
        throw new TypeError('ReactionEnergyDiagram unit must be a non-empty string of at most 32 characters.')
    }
    if (typeof reactantLabel !== 'string' || reactantLabel.trim().length === 0 || reactantLabel.length > 24) {
        throw new TypeError('ReactionEnergyDiagram reactantLabel must be a non-empty string of at most 24 characters.')
    }
    if (typeof productLabel !== 'string' || productLabel.trim().length === 0 || productLabel.length > 24) {
        throw new TypeError('ReactionEnergyDiagram productLabel must be a non-empty string of at most 24 characters.')
    }
    if (ariaLabel !== undefined && (typeof ariaLabel !== 'string' || ariaLabel.trim().length === 0 || ariaLabel.length > 100)) {
        throw new TypeError('ReactionEnergyDiagram ariaLabel must be a non-empty string of at most 100 characters.')
    }
    if (typeof progress !== 'number' || !Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new RangeError('ReactionEnergyDiagram progress must be a finite number from 0 to 1.')
    }
    const svgWidth = boundedDimension(width, 'ReactionEnergyDiagram width', ...ENERGY_LIMITS.width)
    const svgHeight = boundedDimension(height, 'ReactionEnergyDiagram height', ...ENERGY_LIMITS.height)
    const plotLeft = 82
    const plotRight = svgWidth - 82
    const plotTop = 54
    const plotBottom = svgHeight - 118
    const x0 = plotLeft + 14
    const x1 = plotRight - 14
    const xPeak = (x0 + x1) / 2
    const lowest = Math.min(reactants, products)
    const highest = Math.max(barrier, catalyzedBarrier ?? barrier)
    const rawRange = highest - lowest
    const range = rawRange === 0 ? 2 : rawRange
    const padding = rawRange === 0 ? 0 : range * 0.16
    const scaleMin = rawRange === 0 ? lowest - 1 : lowest - padding
    const scaleMax = rawRange === 0 ? highest + 1 : highest + padding
    const yFor = (value: number) => plotBottom - ((value - scaleMin) / (scaleMax - scaleMin)) * (plotBottom - plotTop)
    const yReactants = yFor(reactants)
    const yProducts = yFor(products)
    const yBarrier = yFor(barrier)
    const yCatalyzed = catalyzedBarrier === undefined ? undefined : yFor(catalyzedBarrier)
    const path = energyPath(x0, yReactants, xPeak, yBarrier, x1, yProducts)
    const catalyzedPath = yCatalyzed === undefined ? undefined : energyPath(x0, yReactants, xPeak, yCatalyzed, x1, yProducts)
    const delta = products - reactants
    const activation = barrier - reactants
    const catalyzedActivation = catalyzedBarrier === undefined ? undefined : catalyzedBarrier - reactants
    const chartTitle = 'Reaction energy diagram'
    const desc = `${reactantLabel} energy ${energyText(reactants)} ${unit}; product energy ${energyText(products)} ${unit}; uncatalyzed activation energy ${energyText(activation)} ${unit}; reaction energy change ΔE ${signedEnergyText(delta)} ${unit}.${catalyzedBarrier === undefined ? '' : ` Catalyzed activation energy ${energyText(catalyzedActivation!)} ${unit}; endpoints are unchanged.`}`
    const readableInk = getReadableTextColor(c.bgCard, c)
    const activationX = plotLeft + 24
    const catalyzedActivationX = plotLeft + 38
    const deltaX = plotRight + 16
    const revealClipId = `reaction-energy-reveal-${svgWidth}-${svgHeight}-${String(progress).replace('.', '-')}`
    const revealWidth = progress === 0 ? 0 : (x1 - x0) * progress + 8
    const gridValues = [scaleMin, (scaleMin + scaleMax) / 2, scaleMax]
    const svgNodes: React.ReactNode[] = [
        React.createElement('rect', { key: 'background', x: 0, y: 0, width: svgWidth, height: svgHeight, rx: 14, fill: c.bgCard, stroke: c.borderSubtle }),
        React.createElement('defs', { key: 'reveal-defs' },
            React.createElement('clipPath', { id: revealClipId, clipPathUnits: 'userSpaceOnUse' },
                React.createElement('rect', { x: x0 - 4, y: plotTop, width: revealWidth, height: plotBottom - plotTop }),
            ),
        ),
        React.createElement('line', { key: 'y-axis', x1: plotLeft, y1: plotTop, x2: plotLeft, y2: plotBottom, stroke: c.borderLight, strokeWidth: 1.4 }),
        React.createElement('line', { key: 'x-axis', x1: plotLeft, y1: plotBottom, x2: plotRight, y2: plotBottom, stroke: c.borderLight, strokeWidth: 1.4 }),
        ...gridValues.map((value, index) => React.createElement('line', {
            key: `grid-${index}`,
            x1: plotLeft,
            y1: yFor(value),
            x2: plotRight,
            y2: yFor(value),
            stroke: c.borderSubtle,
            strokeWidth: 1,
            strokeDasharray: '3 5',
        })),
        React.createElement('path', {
            key: 'uncatalyzed-path',
            d: path,
            fill: 'none',
            stroke: c.critical,
            strokeWidth: 4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            clipPath: `url(#${revealClipId})`,
            'data-energy-path': 'uncatalyzed',
            'data-progress': progress,
        }),
        catalyzedPath === undefined ? null : React.createElement('path', {
            key: 'catalyzed-path',
            d: catalyzedPath,
            fill: 'none',
            stroke: c.positive,
            strokeWidth: 4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            clipPath: `url(#${revealClipId})`,
            'data-energy-path': 'catalyzed',
            'data-progress': progress,
        }),
        measurement(activationX, yReactants, yBarrier, c.critical, 'activation-uncatalyzed', 'activation-uncatalyzed'),
        yCatalyzed === undefined ? null : measurement(catalyzedActivationX, yReactants, yCatalyzed, c.positive, 'activation-catalyzed', 'activation-catalyzed'),
        measurement(deltaX, yReactants, yProducts, c.secondary, 'reaction-energy-change', 'reaction-energy-change'),
    ]
    const overlayNodes = [
        overlayText('title', { text: `${chartTitle} · ${unit}`, x: svgWidth / 2, y: 24, fill: c.textPrimary, fontSize: 16, fontFamily: c.fontSans, fontWeight: 700 }),
        React.createElement('div', {
            key: 'energy-label',
            style: {
                position: 'absolute' as const,
                left: 22,
                top: (plotTop + plotBottom) / 2,
                display: 'flex',
                color: c.textSecondary,
                fontSize: 12,
                fontFamily: c.fontSans,
                lineHeight: 1,
                whiteSpace: 'nowrap' as const,
                transform: 'translate(-50%, -50%) rotate(-90deg)',
            },
        }, 'Energy'),
        ...gridValues.map((value, index) => overlayText(`grid-label-${index}`, { text: energyText(value), x: plotLeft - 8, y: yFor(value) + 4, fill: readableInk, fontSize: 12, fontFamily: c.fontSans, textAnchor: 'end' })),
        overlayText('reactant-label', { text: reactantLabel, x: x0, y: plotBottom + 25, fill: c.textPrimary, fontSize: 13, fontFamily: c.fontSans, fontWeight: 600 }),
        overlayText('product-label', { text: productLabel, x: x1, y: plotBottom + 25, fill: c.textPrimary, fontSize: 13, fontFamily: c.fontSans, fontWeight: 600 }),
        overlayText('activation-value', { text: `Ea (uncatalyzed) = ${energyText(activation)} ${unit}`, x: svgWidth / 2, y: svgHeight - (catalyzedActivation === undefined ? 45 : 57), fill: getReadableColor('critical', c), fontSize: 12, fontFamily: c.fontSans }),
        ...(catalyzedActivation === undefined ? [] : [overlayText('catalyzed-activation-value', { text: `Ea (catalyzed) = ${energyText(catalyzedActivation)} ${unit}`, x: svgWidth / 2, y: svgHeight - 39, fill: getReadableColor('positive', c), fontSize: 12, fontFamily: c.fontSans })]),
        overlayText('delta-value', { text: `ΔE = ${signedEnergyText(delta)} ${unit}`, x: svgWidth / 2, y: svgHeight - 21, fill: getReadableColor('secondary', c), fontSize: 12, fontFamily: c.fontSans }),
    ]
    const geometry = React.createElement('svg', {
        width: svgWidth,
        height: svgHeight,
        viewBox: `0 0 ${svgWidth} ${svgHeight}`,
        'aria-hidden': true,
        style: { position: 'absolute' as const, left: 0, top: 0, display: 'block' },
    },
        ...svgNodes,
    )
    return React.createElement('div', {
        role: 'img',
        'aria-label': ariaLabel ?? `${chartTitle} (${unit})`,
        'aria-description': desc,
        title: `${chartTitle} (${unit})`,
        'data-vizmatic-component': 'ReactionEnergyDiagram',
        style: { position: 'relative', width: svgWidth, height: svgHeight, overflow: 'hidden' },
    }, geometry, ...overlayNodes)
}
