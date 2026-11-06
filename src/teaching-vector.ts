import type { CanvasBounds, CanvasPoint } from './canvas-components'
import type { TeachingPainter, TeachingPlot } from './teaching-canvas'

export interface WeightedVectorTerm {
    id: string
    label?: string
    weight: number
    values: readonly number[]
    color?: string
}

export interface WeightedVectorOptions {
    terms: readonly WeightedVectorTerm[]
    progress: number
    initial?: readonly number[]
}

export type WeightedVectorStatus = 'pending' | 'current' | 'completed'

export interface WeightedVectorTermState extends WeightedVectorTerm {
    label: string
    values: number[]
    status: WeightedVectorStatus
    progress: number
    contribution: number[]
    applied: number[]
    start: number[]
    end: number[]
    currentEnd: number[]
    zero: boolean
}

export interface WeightedVectorState {
    progress: number
    dimensions: number
    initial: number[]
    terms: WeightedVectorTermState[]
    completedCount: number
    current: WeightedVectorTermState | null
    completedSum: number[]
    sum: number[]
    total: number[]
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const cleanZero = (value: number) => value === 0 ? 0 : value

function finite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
    return value
}

function vector(values: readonly number[], dimensions: number, name: string): number[] {
    if (values.length !== dimensions) throw new Error(`${name} must have ${dimensions} coordinates`)
    return values.map(value => cleanZero(finite(value, name)))
}

function add(left: readonly number[], right: readonly number[]): number[] {
    return left.map((value, index) => cleanZero(finite(value + right[index], 'Weighted vector sum')))
}

/** Equal progress intervals preserve every term, including zero contributions. No frame history is retained. */
export function weightedVectorState(options: WeightedVectorOptions): WeightedVectorState {
    const progress = clamp(finite(options.progress, 'Weighted vector progress'))
    const dimensions = options.initial?.length ?? options.terms[0]?.values.length ?? 0
    if (!dimensions) throw new Error('Weighted vectors require at least one coordinate; an empty sum needs an initial vector')
    const initial = options.initial ? vector(options.initial, dimensions, 'Initial vector') : Array(dimensions).fill(0) as number[]
    const ids = new Set<string>()
    let prefix = [...initial]
    const position = progress * options.terms.length
    const completedCount = Math.min(options.terms.length, Math.floor(position))
    const terms = options.terms.map((term, index): WeightedVectorTermState => {
        if (typeof term.id !== 'string' || !term.id.trim() || term.id !== term.id.trim() || ids.has(term.id)) {
            throw new Error('Weighted vector terms require distinct nonempty IDs without surrounding whitespace')
        }
        ids.add(term.id)
        const label = term.label ?? term.id
        if (typeof label !== 'string' || !label.trim()) throw new Error('Weighted vector labels must be nonempty')
        const weight = finite(term.weight, 'Vector weight')
        const values = vector(term.values, dimensions, `Vector ${term.id}`)
        const contribution = values.map(value => cleanZero(finite(weight * value, 'Weighted vector contribution')))
        const start = [...prefix], end = add(start, contribution)
        prefix = end
        const fraction = clamp(position - index)
        const status = fraction === 1 ? 'completed' : index === completedCount && progress < 1 ? 'current' : 'pending'
        const applied = contribution.map(value => cleanZero(value * fraction))
        return { ...term, label, values, weight, status, progress: fraction, contribution, applied,
            start, end, currentEnd: add(start, applied), zero: contribution.every(value => value === 0) }
    })
    const completedSum = completedCount ? [...terms[completedCount - 1].end] : [...initial]
    const current = terms.find(term => term.status === 'current') ?? null
    return { progress, dimensions, initial, terms, completedCount, current, completedSum,
        sum: current ? [...current.currentEnd] : [...completedSum], total: [...prefix] }
}

export interface TeachingVectorProjection {
    label: string
    point(values: readonly number[]): readonly [number, number]
}

export interface TeachingVectorAccumulationOptions extends WeightedVectorOptions {
    plot: TeachingPlot
    /** Required to display more than two coordinates. The declaration is also painted above the term ledger. */
    projection?: TeachingVectorProjection
    ledger: CanvasBounds
    fontSize?: number
    color?: string
    restColor?: string
    completedOpacity?: number
    width?: number
    endpointRadius?: number
    revealTotal?: boolean
    totalLabel?: string
    totalTarget?: string
    format?: (value: number) => string
}

export interface TeachingVectorSegment {
    id: string
    status: 'current' | 'completed'
    from: CanvasPoint
    to: CanvasPoint
    zero: boolean
}

function positive(value: number, name: string): void {
    if (finite(value, name) <= 0) throw new Error(`${name} must be positive`)
}

function bounds(value: CanvasBounds, name: string): void {
    finite(value.x, `${name} x`)
    finite(value.y, `${name} y`)
    positive(value.width, `${name} width`)
    positive(value.height, `${name} height`)
}

/** Draw only earned contribution geometry, using the host's checked painter for every mark. */
export function createTeachingVectorAccumulation<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return (options: TeachingVectorAccumulationOptions) => {
        const state = weightedVectorState(options)
        const { plot, ledger, projection, fontSize = 28, color = '#63DEEC', restColor = '#8D9CB9',
            completedOpacity = 0.45, width = 4, endpointRadius = 5, revealTotal = false,
            totalLabel = 'Accumulated vector', format = (value: number) => String(Number(value.toPrecision(4))) } = options
        bounds(plot.bounds, 'Vector plot')
        bounds(ledger, 'Vector ledger')
        positive(fontSize, 'Vector font size')
        positive(width, 'Vector stroke width')
        positive(endpointRadius, 'Vector endpoint radius')
        finite(completedOpacity, 'Completed vector opacity')
        if (completedOpacity < 0 || completedOpacity > 1) throw new Error('Completed vector opacity must lie between zero and one')
        const [x0, x1] = plot.xDomain, [y0, y1] = plot.yDomain
        for (const value of [x0, x1, y0, y1]) finite(value, 'Vector plot domain')
        if (x1 <= x0 || y1 <= y0) throw new Error('Vector plot domains must increase')
        const sx = plot.bounds.width / (x1 - x0), sy = plot.bounds.height / (y1 - y0)
        if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0 || Math.abs(sx - sy) > Math.max(sx, sy) * 1e-9) {
            throw new Error('Weighted vector drawing requires equal-unit plot geometry')
        }
        if (state.dimensions !== 2 && !projection) throw new Error('Weighted vector drawing requires 2D values or an explicit projection')
        if (projection && !projection.label.trim()) throw new Error('Vector projection requires a visible declaration')
        const rowHeight = fontSize * 2.5, headerHeight = fontSize * 1.6
        if (ledger.height < headerHeight + state.terms.length * rowHeight + fontSize * 1.8) {
            throw new Error('Vector ledger height must contain the identities, contributions and result')
        }
        const point = (values: readonly number[]): CanvasPoint => {
            const projected = projection ? projection.point([...values]) : values
            if (projected.length !== 2) throw new Error('Vector projection must return exactly two coordinates')
            const [x, y] = projected
            finite(x, 'Projected vector x'); finite(y, 'Projected vector y')
            if (x < x0 || x > x1 || y < y0 || y > y1) throw new Error('Vector endpoints must lie inside the declared plot domains')
            const p = plot.point(x, y)
            finite(p.x, 'Vector endpoint x'); finite(p.y, 'Vector endpoint y')
            const expectedX = finite(plot.bounds.x + (x - x0) * sx, 'Declared vector endpoint x')
            const expectedY = finite(plot.bounds.y + plot.bounds.height - (y - y0) * sy, 'Declared vector endpoint y')
            const tolerance = Math.max(1, Math.abs(expectedX), Math.abs(expectedY), plot.bounds.width, plot.bounds.height) * 1e-9
            if (Math.abs(p.x - expectedX) > tolerance || Math.abs(p.y - expectedY) > tolerance) {
                throw new Error('Vector plot mapping must match its declared equal-unit transform')
            }
            return p
        }
        // Preflight the complete plan so a bad later term cannot leave a partly painted figure.
        const segments: TeachingVectorSegment[] = []
        for (const term of state.terms) {
            const from = point(term.start)
            point(term.end)
            const to = point(term.currentEnd)
            if (term.status !== 'pending') segments.push({ id: term.id, status: term.status, from, to,
                zero: Math.hypot(to.x - from.x, to.y - from.y) < 1e-9 })
        }
        const endpoint = point(state.sum)
        const vectorText = (values: readonly number[]) => `(${values.map(format).join(', ')})`
        const target = (id: string, draw: () => void) => painter.target ? painter.target(id, draw) : draw()
        const paintedTerms = state.terms.map((term, index) => ({ term, index,
            input: `${term.label}: ${format(term.weight)} × ${vectorText(term.values)}`,
            detail: term.status === 'pending' ? 'pending' : `${term.status}: ${vectorText(term.applied)}` }))
        const totalText = `${totalLabel}: ${revealTotal ? vectorText(state.sum) : '?'}`
        for (const segment of segments) {
            const term = state.terms.find(term => term.id === segment.id)!
            const ink = term.color ?? color
            target(term.id, () => painter.opacity(term.status === 'completed' ? completedOpacity : 1, () => {
                if (segment.zero) painter.circle(segment.to.x, segment.to.y, endpointRadius, 'transparent', ink, width)
                else painter.arrow(segment.from.x, segment.from.y, segment.to.x, segment.to.y, ink, width)
            }))
        }
        if (revealTotal) {
            const mark = () => { painter.circle(endpoint.x, endpoint.y, endpointRadius * 1.5, color) }
            if (options.totalTarget) target(options.totalTarget, mark)
            else mark()
        }
        painter.labelScope(ledger, () => {
            painter.text(projection ? `Projection: ${projection.label}` : 'Weighted contributions', ledger.x + 12,
                ledger.y + fontSize, fontSize * 0.85, restColor)
            for (const { term, index, input, detail } of paintedTerms) target(term.id, () => {
                const ink = term.color ?? color
                const y = ledger.y + headerHeight + index * rowHeight
                painter.text(input, ledger.x + 12, y + fontSize, fontSize, term.status === 'pending' ? restColor : ink)
                painter.text(detail, ledger.x + 12, y + fontSize * 1.9, fontSize * 0.8, restColor)
            })
            const result = () => {
                painter.text(totalText, ledger.x + 12, ledger.y + headerHeight + state.terms.length * rowHeight + fontSize,
                    fontSize, revealTotal ? color : restColor)
            }
            if (options.totalTarget) target(options.totalTarget, result)
            else result()
        }, { padding: 4 })
        return { state, segments, endpoint }
    }
}
