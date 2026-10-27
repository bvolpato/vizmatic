import { pointAlongPath } from './motion'

export interface CanvasPoint {
    x: number
    y: number
}

export interface CanvasBounds extends CanvasPoint {
    width: number
    height: number
    radius?: number
}

export interface CanvasScopeOptions {
    padding?: number
    id?: string
}

/** Inject checked drawing methods to retain the host renderer's audit metadata. */
export interface CanvasPainter<Shape = unknown> {
    target?<Result>(id: string, draw: () => Result): Result
    rect(x: number, y: number, width: number, height: number, fill?: string, stroke?: string, radius?: number): Shape
    text(value: string, x: number, y: number, size: number, color?: string, align?: 'left' | 'center' | 'right', font?: string): unknown
    container(bounds: CanvasBounds, draw: () => void, options?: CanvasScopeOptions): unknown
    labelScope(bounds: CanvasBounds, draw: () => void, options?: CanvasScopeOptions): unknown
    opacity(alpha: number, draw: () => void): unknown
    circle(x: number, y: number, radius: number, fill?: string, stroke?: string, width?: number): unknown
}

export interface CanvasPanelStyle {
    focusTarget?: string
    fill?: string
    stroke?: string
    radius?: number
    padding?: number
    id?: string
    scope?: 'container' | 'label'
    opacity?: number
}

export interface CanvasPanelOptions extends CanvasBounds, CanvasPanelStyle {}

export interface CanvasCardStyle extends CanvasPanelStyle {
    fontSize?: number
    font?: string
    textColor?: string
    baselineOffset?: number
    labelOpacity?: number
}

export interface CanvasCardOptions extends CanvasBounds, CanvasCardStyle {
    label: string | number
}

export interface CanvasMatrixOptions<Value = string | number> {
    values: readonly (readonly Value[])[]
    x: number
    y: number
    cellSize?: number
    gap?: number
    inset?: number
    format?: (value: Value, row: number, column: number) => string | number
    style?: CanvasCardStyle
    cellStyle?: (value: Value, row: number, column: number) => CanvasCardStyle | undefined
}

export interface TokenRowLayoutOptions {
    centerX?: number
    x?: number
    advance?: number
    gap?: number
    minWidth?: number
    paddingX?: number
    width?: number
}

export interface TokenRowItem {
    text: string
    x: number
    width: number
}

export interface CanvasTokenRowOptions extends TokenRowLayoutOptions, CanvasCardStyle {
    values: readonly (string | number)[]
    y: number
    height?: number
    reveal?: number
}

export interface CanvasParticleOptions {
    points: readonly CanvasPoint[]
    progress: number
    radius?: number
    fill: string
    stroke?: string
    strokeWidth?: number
}

function finite(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`)
}

function nonnegative(value: number, name: string): void {
    finite(value, name)
    if (value < 0) throw new Error(`${name} must be nonnegative`)
}

function positive(value: number, name: string): void {
    finite(value, name)
    if (value <= 0) throw new Error(`${name} must be positive`)
}

function normalizedOpacity(value: number, name = 'Canvas opacity'): number {
    finite(value, name)
    return Math.max(0, Math.min(1, value))
}

function validateBounds(bounds: CanvasBounds): void {
    finite(bounds.x, 'Canvas x')
    finite(bounds.y, 'Canvas y')
    positive(bounds.width, 'Canvas width')
    positive(bounds.height, 'Canvas height')
    nonnegative(bounds.radius ?? 14, 'Canvas radius')
}

/** Lay out token cards using literal text length, or an explicit fixed width. */
export function layoutTokenRow(
    values: readonly (string | number)[],
    options: TokenRowLayoutOptions = {},
): TokenRowItem[] {
    const { advance = 24, gap = 16, minWidth = 64, paddingX = 17, width } = options
    nonnegative(advance, 'Token advance')
    nonnegative(gap, 'Token gap')
    positive(minWidth, 'Token minimum width')
    nonnegative(paddingX, 'Token horizontal padding')
    if (width !== undefined) positive(width, 'Token width')
    if (options.x !== undefined) finite(options.x, 'Token x')
    if (options.centerX !== undefined) finite(options.centerX, 'Token center x')

    const items = values.map((value) => {
        const text = String(value)
        return { text, x: 0, width: width ?? Math.max(minWidth, text.length * advance + 2 * paddingX) }
    })
    const totalWidth = items.reduce((total, item) => total + item.width, 0) + Math.max(0, items.length - 1) * gap
    let x = options.x ?? ((options.centerX ?? 0) - totalWidth / 2)
    finite(x, 'Token row origin')
    for (const item of items) {
        item.x = x
        x += item.width + gap
        finite(x, 'Token row extent')
    }
    return items
}

/** Compose reusable Canvas geometry exclusively through an injected painter. */
export function createCanvasComponents<Shape>(painter: CanvasPainter<Shape>) {
    function fade(alpha: number, draw: () => void): void {
        const amount = normalizedOpacity(alpha)
        if (amount > 0) painter.opacity(amount, draw)
    }

    function panel(options: CanvasPanelOptions, draw?: () => void): Shape {
        validateBounds(options)
        const { x, y, width, height, fill, stroke, radius = 14, padding = 10, id, scope = 'container', opacity = 1 } = options
        nonnegative(padding, 'Canvas padding')
        const alpha = normalizedOpacity(opacity)
        if (scope !== 'container' && scope !== 'label') throw new Error('Canvas scope must be container or label')
        let shape!: Shape
        const paint = () => painter.opacity(alpha, () => {
            shape = painter.rect(x, y, width, height, fill, stroke, radius)
            if (draw) {
                const bounds = { x, y, width, height, radius }
                const scopeOptions = { padding, id }
                if (scope === 'label') painter.labelScope(bounds, draw, scopeOptions)
                else painter.container(bounds, draw, scopeOptions)
            }
        })
        if (options.focusTarget && painter.target) painter.target(options.focusTarget, paint)
        else paint()
        return shape
    }

    function card(options: CanvasCardOptions): Shape {
        const { label, x, y, width, height, fontSize = 32, font = 'sans', textColor, baselineOffset = fontSize * 0.34, labelOpacity = 1 } = options
        positive(fontSize, 'Canvas font size')
        finite(baselineOffset, 'Canvas text baseline offset')
        const labelAlpha = normalizedOpacity(labelOpacity, 'Canvas label opacity')
        return panel(options, () => {
            fade(labelAlpha, () => {
                painter.text(String(label), x + width / 2, y + height / 2 + baselineOffset, fontSize, textColor, 'center', font)
            })
        })
    }

    function matrix<Value>(options: CanvasMatrixOptions<Value>): Shape[] {
        const { values, x, y, cellSize = 112, gap = 8, inset = 0, format = String, style = {}, cellStyle } = options
        finite(x, 'Matrix x')
        finite(y, 'Matrix y')
        positive(cellSize, 'Matrix cell size')
        nonnegative(gap, 'Matrix gap')
        finite(inset, 'Matrix inset')
        if (gap >= cellSize) throw new Error('Matrix gap must be smaller than cell size')
        const columns = values[0]?.length ?? 0
        for (const row of values) {
            if (!Array.isArray(row) || row.length !== columns) throw new Error('Canvas matrix rows must be rectangular')
        }
        const shapes: Shape[] = []
        for (let row = 0; row < values.length; row += 1) {
            for (let column = 0; column < columns; column += 1) {
                const value = values[row][column]
                const cell = { ...style, ...cellStyle?.(value, row, column) }
                finite(cell.opacity ?? 1, 'Canvas opacity')
                if ((cell.opacity ?? 1) <= 0) continue
                const shape = card({
                    ...cell,
                    x: x + column * cellSize + inset,
                    y: y + row * cellSize + inset,
                    width: cellSize - gap,
                    height: cellSize - gap,
                    label: format(value, row, column),
                })
                shapes.push(shape)
            }
        }
        return shapes
    }

    function tokenRow(options: CanvasTokenRowOptions): Shape[] {
        const { values, y, height = 68, reveal = 1, opacity = 1, ...style } = options
        finite(y, 'Token row y')
        positive(height, 'Token height')
        finite(reveal, 'Token reveal')
        const alpha = normalizedOpacity(opacity)
        const items = layoutTokenRow(values, options)
        const shapes: Shape[] = []
        for (let index = 0; index < items.length; index += 1) {
            const amount = Math.max(0, Math.min(1, reveal * items.length - index)) * alpha
            if (amount <= 0) continue
            const { text: label, x, width } = items[index]
            const shape = card({ ...style, label, x, y, width, height, opacity: amount })
            shapes.push(shape)
        }
        return shapes
    }

    function particle(options: CanvasParticleOptions): CanvasPoint | null {
        const { points, progress, radius = 9, fill, stroke, strokeWidth = 3 } = options
        finite(progress, 'Particle progress')
        positive(radius, 'Particle radius')
        nonnegative(strokeWidth, 'Particle stroke width')
        if (progress <= 0 || progress >= 1) return null
        const point = pointAlongPath(points, progress)
        painter.circle(point.x, point.y, radius, fill, stroke, strokeWidth)
        return point
    }

    return { panel, card, matrix, tokenRow, particle, fade }
}
