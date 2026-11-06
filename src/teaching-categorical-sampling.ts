import type { CanvasBounds } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'

export interface SamplingCategory { id: string, label: string, mass: number, color?: string, focusTarget?: string }
export interface SuppliedCategoricalDraw { id: string, uniform: number }
export interface CategoricalSamplingOptions {
    categories: readonly SamplingCategory[]
    draws: readonly SuppliedCategoricalDraw[]
    /** probabilities must sum to one within 1e-12; weights are explicitly normalized. */
    normalization: 'probabilities' | 'weights'
}
export interface CategoricalSamplingModel {
    inputTotal: number
    normalization: CategoricalSamplingOptions['normalization']
    categories: (SamplingCategory & { probability: number, lower: number, upper: number, count: number, empiricalProbability: number | null })[]
    draws: (SuppliedCategoricalDraw & { categoryId: string, categoryIndex: number })[]
}

/** Explicit inverse-CDF sampling: [lower, upper), zero-mass intervals never win, and u=1 is invalid. */
export function categoricalSampling(options: CategoricalSamplingOptions): CategoricalSamplingModel {
    if (options.normalization !== 'probabilities' && options.normalization !== 'weights') throw new Error('Sampling requires an explicit mass normalization contract')
    if (!options.categories.length) throw new Error('Sampling needs at least one category')
    const ids = new Set<string>()
    let total = 0
    for (const category of options.categories) {
        if (!category.id || ids.has(category.id) || !category.label.trim()) throw new Error('Sampling category IDs must be unique and labels nonempty')
        if (!Number.isFinite(category.mass) || category.mass < 0) throw new Error('Sampling masses must be finite and nonnegative')
        ids.add(category.id); total += category.mass
    }
    if (!Number.isFinite(total) || total <= 0) throw new Error('Sampling total mass must be finite and positive')
    if (options.normalization === 'probabilities' && Math.abs(total - 1) > 1e-12) throw new Error('Sampling probabilities must sum to one within 1e-12')
    let cumulative = 0
    let lastPositive = 0
    options.categories.forEach((category, index) => { if (category.mass > 0) lastPositive = index })
    const categories = options.categories.map((category, index) => {
        const lower = cumulative, probability = category.mass / total
        cumulative = index === lastPositive ? 1 : Math.min(1, cumulative + probability)
        if (category.mass > 0 && (probability === 0 || cumulative <= lower)) throw new Error('Positive category is too small for cumulative floating-point precision')
        return { ...category, probability, lower, upper: cumulative, count: 0, empiricalProbability: null as number | null }
    })
    ids.clear()
    const draws = options.draws.map(draw => {
        if (!draw.id || ids.has(draw.id)) throw new Error('Sampling draw IDs must be nonempty and unique')
        if (!Number.isFinite(draw.uniform) || draw.uniform < 0 || draw.uniform >= 1) throw new Error('Supplied uniform draws must be finite inside [0, 1)')
        ids.add(draw.id)
        const categoryIndex = categories.findIndex(category => category.mass > 0 && draw.uniform >= category.lower && draw.uniform < category.upper)
        if (categoryIndex < 0) throw new Error('Supplied draw could not be represented by the normalized intervals')
        categories[categoryIndex].count += 1
        return { ...draw, categoryId: categories[categoryIndex].id, categoryIndex }
    })
    if (draws.length) categories.forEach(category => { category.empiricalProbability = category.count / draws.length })
    return { inputTotal: total, normalization: options.normalization, categories, draws }
}

export interface TeachingCategoricalSamplingOptions extends CategoricalSamplingOptions, CanvasBounds {
    /** Number of retained, visible samples. Hidden draws never paint their category or result. */
    visibleDraws?: number
    /** Motion of the next supplied draw: neutral approach, interval landing, then copying to its sample slot. */
    drawProgress?: number
    /** Explicit reveal; allowed only after every supplied draw has retained. */
    showEmpirical?: boolean
    fontSize?: number
    columns?: number
    color?: string
    trackColor?: string
    sampleFocusTarget?: string
    formatProbability?: (value: number) => string
}

const COLORS = ['#79A6FF', '#FF8DC3', '#63DEEC', '#FFCE73', '#A6DF91']

/** Paint original probabilities, causal supplied draws, persistent sample IDs, and a separately revealed empirical distribution. */
export function createTeachingCategoricalSampling<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    return (options: TeachingCategoricalSamplingOptions) => {
        const model = categoricalSampling(options)
        const { x, y, width, height, fontSize = 28, color = '#DEE7F5', trackColor = '#18283B', visibleDraws = 0, drawProgress = 0, showEmpirical = false, formatProbability = value => value.toFixed(3) } = options
        if (![x, y, x + width, y + height, fontSize].every(Number.isFinite) || fontSize <= 0 || width <= 0 || height <= 0) throw new Error('Sampling needs finite positive bounds and font size')
        if (!Number.isInteger(visibleDraws) || visibleDraws < 0 || visibleDraws > model.draws.length) throw new Error('Visible sample count must be an integer inside the supplied draw count')
        if (!Number.isFinite(drawProgress) || drawProgress < 0 || drawProgress > 1 || (visibleDraws === model.draws.length && drawProgress !== 0)) throw new Error('Sampling progress must be inside [0, 1] for an available next draw')
        if (showEmpirical && visibleDraws !== model.draws.length) throw new Error('Empirical reveal requires every supplied sample to be retained')
        const columns = options.columns ?? Math.max(1, Math.min(8, model.draws.length))
        if (!Number.isInteger(columns) || columns < 1) throw new Error('Sampling columns must be a positive integer')
        const railWidth = fontSize * 2, contentWidth = width - railWidth
        const gap = fontSize * .5, cellWidth = (contentWidth - 4 - (columns - 1) * gap) / columns, cellHeight = fontSize * 1.9
        const legendColumns = Math.min(3, model.categories.length), legendRows = Math.ceil(model.categories.length / legendColumns), legendHeight = legendRows * fontSize * 1.7
        const bandY = y + fontSize * 4, bandHeight = fontSize * 1.3, legendY = bandY + bandHeight + fontSize * 1.5
        const captionY = legendY + legendHeight + fontSize * .5, poolY = captionY + fontSize * 3.3, rows = Math.ceil(model.draws.length / columns), empiricalY = poolY + Math.max(1, rows) * (cellHeight + gap) + fontSize * 2
        if (cellWidth < fontSize * 2 || contentWidth / legendColumns < fontSize * 5 || empiricalY + bandHeight + fontSize * 1.7 > y + height) throw new Error('Sampling bounds cannot fit probability labels, sample IDs and empirical strip')
        const inset = fontSize * .22 + 2, stripX = x + inset, stripWidth = contentWidth - inset * 2
        const point = (u: number) => stripX + u * stripWidth
        const categoryColor = (index: number) => model.categories[index].color ?? COLORS[index % COLORS.length]
        const target = <Result>(id: string | undefined, draw: () => Result): Result => id && painter.target ? painter.target(id, draw) : draw()
        const label = (value: string, bounds: CanvasBounds, align: 'left' | 'center' | 'right' = 'left', ink = color, size = fontSize) => painter.labelScope(bounds, () => painter.text(value, align === 'center' ? bounds.x + bounds.width / 2 : align === 'right' ? bounds.x + bounds.width : bounds.x, bounds.y + size * 1.05, size, ink, align), { padding: 0 })
        const strip = (top: number, empirical: boolean) => {
            painter.rect(stripX, top, stripWidth, bandHeight, trackColor, undefined, 0)
            let cumulative = 0
            model.categories.forEach((category, index) => {
                const probability = empirical ? category.empiricalProbability ?? 0 : category.probability
                const left = cumulative; cumulative += probability
                if (probability > 0) target(category.focusTarget, () => painter.rect(point(left), top, stripWidth * probability, bandHeight, categoryColor(index), undefined, 0))
            })
        }
        const sampleBounds = model.draws.map((_draw, index) => ({ x: x + 2 + (index % columns) * (cellWidth + gap), y: poolY + Math.floor(index / columns) * (cellHeight + gap), width: cellWidth, height: cellHeight }))
        const shapes: Shape[] = []
        painter.container({ x, y, width, height }, () => {
            label(options.normalization === 'weights' ? 'Original probabilities · normalized supplied weights' : 'Original probabilities · supplied distribution', { x, y, width: contentWidth, height: fontSize * 1.6 })
            strip(bandY, false)
            label('0', { x, y: bandY + bandHeight + 2, width: fontSize * 2, height: fontSize * 1.2 }, 'left', color, fontSize * .8)
            label('1', { x: x + contentWidth - fontSize * 2, y: bandY + bandHeight + 2, width: fontSize * 2, height: fontSize * 1.2 }, 'right', color, fontSize * .8)
            model.categories.forEach((category, index) => {
                const bounds = { x: x + index % legendColumns * contentWidth / legendColumns, y: legendY + Math.floor(index / legendColumns) * fontSize * 1.7, width: contentWidth / legendColumns - gap, height: fontSize * 1.5 }
                target(category.focusTarget, () => label(`${category.label}: ${formatProbability(category.probability)}`, bounds, 'left', categoryColor(index)))
            })
            label(`Supplied samples · ${visibleDraws} retained / ${model.draws.length}`, { x, y: poolY - fontSize * 1.8, width: contentWidth, height: fontSize * 1.5 })
            for (let index = 0; index < visibleDraws; index += 1) target(options.sampleFocusTarget, () => {
                const draw = model.draws[index], bounds = sampleBounds[index]
                shapes.push(painter.rect(bounds.x, bounds.y, bounds.width, bounds.height, trackColor, categoryColor(draw.categoryIndex), 4))
                label(draw.id, bounds, 'center', categoryColor(draw.categoryIndex))
            })
            if (drawProgress > 0 && visibleDraws < model.draws.length) target(options.sampleFocusTarget, () => {
                const draw = model.draws[visibleDraws], destination = sampleBounds[visibleDraws], landed = drawProgress >= .4
                const from = { x: point(draw.uniform), y: bandY - fontSize * 1.2 }, onBand = { x: point(draw.uniform), y: bandY + bandHeight / 2 }
                const progress = landed ? (drawProgress - .4) / .6 : drawProgress / .4
                const destinationPoint = { x: destination.x + destination.width / 2, y: destination.y + destination.height / 2 }
                const railX = x + width - inset
                const route = landed ? [onBand, from, { x: railX, y: from.y }, { x: railX, y: destinationPoint.y }, destinationPoint] : [from, onBand]
                const lengths = route.slice(1).map((point, index) => Math.hypot(point.x - route[index].x, point.y - route[index].y))
                let remaining = progress * lengths.reduce((sum, length) => sum + length, 0)
                let marker = route[route.length - 1]
                for (let index = 0; index < lengths.length; index += 1) {
                    const length = lengths[index]
                    if (remaining <= length && length > 0) {
                        const ratio = remaining / length
                        marker = { x: route[index].x + (route[index + 1].x - route[index].x) * ratio, y: route[index].y + (route[index + 1].y - route[index].y) * ratio }
                        break
                    }
                    remaining -= length
                }
                const ink = landed ? categoryColor(draw.categoryIndex) : color
                painter.circle(marker.x, marker.y, fontSize * .22, ink, trackColor, 3)
                const caption = `${landed ? 'Copy' : 'Draw'} ${draw.id} · supplied u=${draw.uniform.toFixed(3)}`
                label(caption, { x, y: captionY, width: contentWidth, height: fontSize * 1.3 }, 'left', ink, fontSize * .8)
            })
            if (showEmpirical) {
                label(model.draws.length ? 'Empirical frequencies · supplied sample only' : 'No samples · empirical distribution undefined', { x, y: empiricalY - fontSize * 1.7, width: contentWidth, height: fontSize * 1.5 })
                if (model.draws.length) {
                    strip(empiricalY, true)
                    const text = model.categories.map(category => `${category.label}: ${category.count}/${model.draws.length}`).join(' · ')
                    label(text, { x, y: empiricalY + bandHeight + fontSize * .25, width: contentWidth, height: fontSize * 1.3 }, 'left', color, fontSize * .8)
                }
            }
        }, { padding: 0 })
        return { model, sampleBounds, shapes, point, visibleDraws }
    }
}
