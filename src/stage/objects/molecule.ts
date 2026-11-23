import { ELEMENT_SYMBOLS } from '../../chemistry-elements'
import type { ColorInput } from '../color'
import { rebindCloneParts, type Node } from '../node'
import { Scene3D, line3d, sphere, type Line3D, type Scene3DOptions, type Surface3D, type Vec3 } from '../three'

export type Molecule3DElement =
    | 'H' | 'He' | 'Li' | 'Be' | 'B' | 'C' | 'N' | 'O' | 'F' | 'Ne' | 'Na' | 'Mg' | 'Al' | 'Si' | 'P' | 'S' | 'Cl' | 'Ar'
    | 'K' | 'Ca' | 'Sc' | 'Ti' | 'V' | 'Cr' | 'Mn' | 'Fe' | 'Co' | 'Ni' | 'Cu' | 'Zn' | 'Ga' | 'Ge' | 'As' | 'Se' | 'Br' | 'Kr'
    | 'Rb' | 'Sr' | 'Y' | 'Zr' | 'Nb' | 'Mo' | 'Tc' | 'Ru' | 'Rh' | 'Pd' | 'Ag' | 'Cd' | 'In' | 'Sn' | 'Sb' | 'Te' | 'I' | 'Xe'
    | 'Cs' | 'Ba' | 'La' | 'Ce' | 'Pr' | 'Nd' | 'Pm' | 'Sm' | 'Eu' | 'Gd' | 'Tb' | 'Dy' | 'Ho' | 'Er' | 'Tm' | 'Yb' | 'Lu'
    | 'Hf' | 'Ta' | 'W' | 'Re' | 'Os' | 'Ir' | 'Pt' | 'Au' | 'Hg' | 'Tl' | 'Pb' | 'Bi' | 'Po' | 'At' | 'Rn' | 'Fr' | 'Ra' | 'Ac'
    | 'Th' | 'Pa' | 'U' | 'Np' | 'Pu' | 'Am' | 'Cm' | 'Bk' | 'Cf' | 'Es' | 'Fm' | 'Md' | 'No' | 'Lr' | 'Rf' | 'Db' | 'Sg' | 'Bh'
    | 'Hs' | 'Mt' | 'Ds' | 'Rg' | 'Cn' | 'Nh' | 'Fl' | 'Mc' | 'Lv' | 'Ts' | 'Og'

export interface Molecule3DAtom {
    id: string
    element: Molecule3DElement
    /** Author-supplied or imported coordinates, in one consistent unit. */
    position: Vec3
}

export interface Molecule3DBond {
    from: string
    to: string
    order?: 1 | 1.5 | 2 | 3
}

export interface Molecule3DData {
    atoms: readonly Molecule3DAtom[]
    bonds: readonly Molecule3DBond[]
}

export interface Molecule3DOptions extends Scene3DOptions {
    /** Display radius in coordinate units, not an atomic or van der Waals radius. */
    atomRadius?: number
    atomColors?: Partial<Record<Molecule3DElement, ColorInput>>
    bondColor?: ColorInput
    /** Stroke width in stage pixels at the camera focus. */
    bondWidth?: number
    /** Separation of multiple bond strokes in coordinate units. */
    bondSpacing?: number
}

const elements = new Set<string>(ELEMENT_SYMBOLS)
const bondKey = (a: string, b: string): string => JSON.stringify([a, b].sort())

/** Minimal fixed-column V2000 subset, following MDL CTFile Formats (2003),
 * pp. 9-12: https://www.daylight.com/meetings/mug05/Kappler/ctfile.pdf
 * Reject chemical features the renderer cannot represent instead of losing them.
 */
function readMol(source: string): Molecule3DData {
    if (source.length > 1_000_000) throw new RangeError('molecule3d MOL/SDF input must be at most 1000000 characters.')
    const lines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
    const counts = lines[3] ?? ''
    if (counts.slice(33).trim() !== 'V2000') throw new TypeError('molecule3d requires a V2000 MOL counts line after three header lines; V3000 is unsupported.')
    const integer = (field: string, name: string): number => {
        if (!/^\d+$/.test(field.trim())) throw new TypeError(`molecule3d MOL ${name} must be an integer in its fixed-width field.`)
        return Number(field)
    }
    const plain = (fields: string, name: string): void => {
        if (!/^[ 0]*$/.test(fields)) throw new TypeError(`molecule3d MOL ${name} is unsupported; only plain element atoms and explicit bonds are imported.`)
    }
    const atomCount = integer(counts.slice(0, 3), 'atom count'), bondCount = integer(counts.slice(3, 6), 'bond count')
    if (atomCount < 1 || atomCount > 256 || bondCount > 512) throw new RangeError('molecule3d MOL supports 1 to 256 atoms and at most 512 bonds.')
    plain(counts.slice(6, 30), 'counts flags')
    if (counts.slice(30, 33).trim()) integer(counts.slice(30, 33), 'property count')
    const end = 4 + atomCount + bondCount
    if (lines.length <= end) throw new TypeError('molecule3d MOL atom/bond block is truncated or missing M  END.')
    const atoms: Molecule3DAtom[] = Array.from({ length: atomCount }, (_, i) => {
        const record = lines[4 + i]
        const coordinates = [0, 10, 20].map((offset) => {
            const field = record.slice(offset, offset + 10).trim()
            if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(field)) throw new TypeError(`molecule3d MOL atom ${i + 1} has an invalid fixed-width coordinate.`)
            return Number(field)
        })
        if (record[30] !== ' ') throw new TypeError(`molecule3d MOL atom ${i + 1} has an invalid symbol column.`)
        const element = record.slice(31, 34).trim()
        if (!elements.has(element)) throw new TypeError(`molecule3d MOL atom ${i + 1} has an invalid element symbol.`)
        plain(record.slice(34), `atom ${i + 1} charge, isotope, stereo, or query field`)
        return { id: String(i + 1), element: element as Molecule3DElement, position: coordinates as [number, number, number] }
    })
    const bonds: Molecule3DData['bonds'] = Array.from({ length: bondCount }, (_, i) => {
        const record = lines[4 + atomCount + i]
        const from = integer(record.slice(0, 3), `bond ${i + 1} first atom`), to = integer(record.slice(3, 6), `bond ${i + 1} second atom`)
        const type = integer(record.slice(6, 9), `bond ${i + 1} type`)
        if (![1, 2, 3, 4].includes(type)) throw new TypeError(`molecule3d MOL bond ${i + 1} type must be 1, 2, 3, or 4 (aromatic); query bonds are unsupported.`)
        plain(record.slice(9), `bond ${i + 1} stereo or topology field`)
        return { from: String(from), to: String(to), order: type === 4 ? 1.5 : type as 1 | 2 | 3 }
    })
    if (lines[end].trim() !== 'M  END') throw new TypeError('molecule3d MOL requires M  END after the bonds; property blocks (including charges, isotopes, and Sgroups) are unsupported.')
    const tail = lines.slice(end + 1)
    if (tail.some((line) => line.trim())) {
        const delimiter = tail.findIndex((line) => line.trim() === '$$$$')
        if (delimiter < 0) throw new TypeError('molecule3d SDF data must end with $$$$.')
        if (tail.slice(delimiter + 1).some((line) => line.trim())) throw new TypeError('molecule3d imports one SDF record at a time; multiple records are unsupported.')
        let inValue = false
        for (const line of tail.slice(0, delimiter)) {
            if (!line.trim()) inValue = false
            else if (!inValue) {
                if (!/^>.*<[^<>]+>/.test(line)) throw new TypeError('molecule3d SDF data must use named > <field> headers.')
                inValue = true
            }
        }
    }
    return { atoms, bonds }
}

function positive(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`molecule3d ${name} must be positive and finite.`)
    return value
}

function validate(data: Molecule3DData): Map<string, Molecule3DAtom> {
    if (!data || !Array.isArray(data.atoms) || data.atoms.length === 0 || data.atoms.length > 256) {
        throw new TypeError('molecule3d needs between 1 and 256 explicitly positioned atoms.')
    }
    if (!Array.isArray(data.bonds) || data.bonds.length > 512) throw new TypeError('molecule3d bonds must be an array of at most 512 bonds.')
    const atoms = new Map<string, Molecule3DAtom>(), positions = new Set<string>()
    for (const atom of data.atoms) {
        if (!atom || typeof atom.id !== 'string' || !atom.id.trim()) throw new TypeError('molecule3d atom needs a non-empty ID.')
        if (atoms.has(atom.id)) throw new TypeError(`molecule3d duplicate atom ID "${atom.id}".`)
        if (!elements.has(atom.element)) throw new TypeError(`molecule3d atom "${atom.id}" has an invalid element symbol.`)
        if (!Array.isArray(atom.position) || atom.position.length !== 3 || !atom.position.every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6)) {
            throw new TypeError(`molecule3d atom "${atom.id}" needs three finite coordinates with magnitude at most 1000000.`)
        }
        const position = JSON.stringify(atom.position)
        if (positions.has(position)) throw new TypeError(`molecule3d atom "${atom.id}" has coincident coordinates.`)
        positions.add(position)
        atoms.set(atom.id, atom)
    }
    const pairs = new Set<string>()
    for (const bond of data.bonds) {
        if (!bond || !atoms.has(bond.from) || !atoms.has(bond.to)) throw new TypeError('molecule3d bond references an unknown atom.')
        if (bond.from === bond.to) throw new TypeError('molecule3d bond cannot connect an atom to itself.')
        if (![1, 1.5, 2, 3].includes(bond.order)) throw new TypeError('molecule3d bond order must be 1, 1.5, 2, or 3.')
        const key = bondKey(bond.from, bond.to)
        if (pairs.has(key)) throw new TypeError(`molecule3d duplicate bond "${bond.from}" to "${bond.to}".`)
        pairs.add(key)
    }
    return atoms
}

function atomColor(element: Molecule3DElement): ColorInput {
    if (element === 'O') return 'red'
    if (element === 'N') return 'blue'
    if (element === 'S' || element === 'P') return 'yellow'
    if (['F', 'Cl', 'Br', 'I'].includes(element)) return 'green'
    return element === 'C' ? 'dim' : 'ink'
}

/** Explicit ball-and-stick geometry, using the Stage camera and depth sorter.
 * No bonds, hydrogens, valence, stereochemistry, or force-field geometry are inferred.
 * Positions and bond orders are snapshotted at construction. Camera and individual
 * atom/bond appearance can be animated with the ordinary Stage verbs.
 */
export class Molecule3D extends Scene3D {
    private atomNodes = new Map<string, Surface3D>()
    private bondNodes = new Map<string, readonly Line3D[]>()

    constructor(input: Molecule3DData | string, options: Molecule3DOptions = {}) {
        const data = typeof input === 'string' ? readMol(input) : input
        const atoms = validate(data)
        const radius = positive(options.atomRadius ?? 0.28, 'atomRadius')
        const spacing = positive(options.bondSpacing ?? 0.12, 'bondSpacing')
        const width = positive(options.bondWidth ?? 5, 'bondWidth')
        super(options)
        for (const atom of atoms.values()) {
            const node = sphere(radius, { center: atom.position, color: options.atomColors?.[atom.element] ?? atomColor(atom.element), resolution: [32, 20] })
            this.atomNodes.set(atom.id, node)
            this.add(node)
        }
        for (const bond of data.bonds) {
            const a = atoms.get(bond.from)!.position, b = atoms.get(bond.to)!.position
            const delta = b.map((v, i) => v - a[i])
            const length = Math.hypot(...delta)
            if (length <= radius * 2) throw new RangeError(`molecule3d bond "${bond.from}" to "${bond.to}" is shorter than two display radii; reduce atomRadius.`)
            const [x, y, z] = delta.map((v) => v / length)
            // Cross with the least-aligned coordinate axis. This remains stable
            // for bonds along any axis and is independent of camera orientation.
            const axis = Math.abs(x) <= Math.abs(y) && Math.abs(x) <= Math.abs(z) ? 0 : Math.abs(y) <= Math.abs(z) ? 1 : 2
            const cross = axis === 0 ? [0, z, -y] : axis === 1 ? [-z, 0, x] : [y, -x, 0]
            const norm = Math.hypot(...cross)
            const normal = cross.map((v) => v / norm)
            const offsets = bond.order === 1 ? [0] : bond.order === 3 ? [-spacing, 0, spacing] : [-spacing / 2, spacing / 2]
            const lines = offsets.flatMap((offset, index) => {
                const point = (t: number): Vec3 => [a[0] + delta[0] * t + normal[0] * offset, a[1] + delta[1] * t + normal[1] * offset, a[2] + delta[2] * t + normal[2] * offset]
                const style = { color: options.bondColor ?? 'dim', width, pieces: 12 }
                // Aromatic order is a solid line plus a dashed parallel line.
                return bond.order === 1.5 && index === 1
                    ? Array.from({ length: 8 }, (_, i) => line3d(point(i / 8), point((i + 0.55) / 8), style))
                    : [line3d(point(0), point(1), style)]
            })
            this.bondNodes.set(bondKey(bond.from, bond.to), Object.freeze(lines))
            this.add(...lines)
        }
    }

    atom(id: string): Surface3D {
        const node = this.atomNodes.get(id)
        if (!node) throw new RangeError(`molecule3d has no atom "${id}".`)
        return node
    }

    /** All strokes for this bond, including the dashed half of aromatic bonds. */
    bond(from: string, to: string): readonly Line3D[] {
        const nodes = this.bondNodes.get(bondKey(from, to))
        if (!nodes) throw new RangeError(`molecule3d has no bond "${from}" to "${to}".`)
        return nodes
    }

    protected override [rebindCloneParts](copy: this, parts: ReadonlyMap<Node, Node>): void | (() => void) {
        const connect = super[rebindCloneParts]?.(copy, parts)
        copy.atomNodes = new Map([...this.atomNodes].map(([id, node]) => [id, parts.get(node) as Surface3D]))
        copy.bondNodes = new Map([...this.bondNodes].map(([id, nodes]) => [id, Object.freeze(nodes.map((node) => parts.get(node) as Line3D))]))
        return connect
    }
}

/** Draw supplied coordinates, or import one V2000 MOL/SDF record. Imported atom
 * IDs are 1-based strings. All x/y/z values are preserved, including planar z=0;
 * the caller is responsible for the geometry and its units. No conformation or
 * missing hydrogen is generated. The import subset supports plain elements and
 * bond types 1/2/3/4 (aromatic), and ignores named SDF data fields. Charges,
 * isotopes, stereo/query flags, property blocks, and multiple records are rejected.
 */
export function molecule3d(data: Molecule3DData | string, options: Molecule3DOptions = {}): Molecule3D {
    return new Molecule3D(data, options)
}
