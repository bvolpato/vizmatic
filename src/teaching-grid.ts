import { createCanvasComponents, type CanvasBounds } from './canvas-components'
import type { TeachingPainter } from './teaching-canvas'

export interface CellGridOptions extends CanvasBounds {
    rows: number
    columns: number
}

export interface CellGridLayout {
    bounds: CanvasBounds
    cells: CanvasBounds[][]
    cell(row: number, column: number): CanvasBounds
}

export interface TeachingGridHighlight {
    row: number
    column: number
    fill: string
    stroke?: string
    opacity?: number
}

export interface TeachingGridOptions extends CellGridOptions {
    cellFocusTarget?: (row: number, column: number) => string | readonly string[] | undefined
    fill?: string
    stroke?: string
    lineWidth?: number
    labels?: readonly (readonly (string | number)[])[]
    highlights?: readonly TeachingGridHighlight[]
    fontSize?: number
    textColor?: string
    padding?: number
}

function positive(value: number, name: string): void {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and positive`)
}

/** Shared cell geometry for dense diagrams, without creating one panel per cell. */
export function layoutCellGrid(options: CellGridOptions): CellGridLayout {
    const { x, y, width, height, rows, columns } = options
    if (![x, y, x + width, y + height].every(Number.isFinite)) throw new Error('Grid bounds must be finite')
    positive(width, 'Grid width')
    positive(height, 'Grid height')
    if (![rows, columns, rows * columns].every(Number.isSafeInteger) || rows <= 0 || columns <= 0) {
        throw new Error('Grid rows and columns must be positive safe integers')
    }
    const bounds = { x, y, width, height }
    const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => ({
        x: x + column * width / columns, y: y + row * height / rows,
        width: width / columns, height: height / rows,
    })))
    return {
        bounds, cells,
        cell(row, column) {
            if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 0 || row >= rows || column < 0 || column >= columns) {
                throw new Error('Grid cell index is outside the grid')
            }
            return cells[row][column]
        },
    }
}

export function createTeachingGrid<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>) {
    const components = createCanvasComponents(painter)
    return (options: TeachingGridOptions): CellGridLayout & { shape: Shape } => {
        const layout = layoutCellGrid(options)
        const { x, y, width, height, rows, columns, fill = '#18283B', stroke = '#63DEEC', lineWidth = 1,
            labels, highlights = [], fontSize = 28, textColor = '#FFFFFF', padding = 4 } = options
        positive(lineWidth, 'Grid line width')
        if (lineWidth >= Math.min(width / columns, height / rows)) throw new Error('Grid line width must be smaller than a cell')
        positive(fontSize, 'Grid font size')
        if (!Number.isFinite(padding) || padding < 0) throw new Error('Grid padding must be finite and nonnegative')
        if (labels && (labels.length !== rows || labels.some(row => row.length !== columns))) {
            throw new Error('Grid labels must match rows and columns')
        }
        for (const highlight of highlights) {
            layout.cell(highlight.row, highlight.column)
            if (!Number.isFinite(highlight.opacity ?? 1)) throw new Error('Grid highlight opacity must be finite')
        }
        const cellFocusTarget = painter.target ? options.cellFocusTarget : undefined
        const shape = components.panel({ ...layout.bounds, fill: cellFocusTarget ? 'transparent' : fill, stroke, radius: 0, padding: 0 }, () => {
            const drawLabel = (r: number, column: number) => {
                if (!labels) return
                const cell = layout.cell(r, column), value = String(labels[r][column])
                const baseline = cell.y + cell.height / 2 + fontSize * 0.34 - (value.split('\n').length - 1) * fontSize * 0.7
                painter.labelScope(cell, () => painter.text(value, cell.x + cell.width / 2, baseline, fontSize, textColor, 'center'), { padding })
            }
            if (cellFocusTarget) for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
                const named = cellFocusTarget(row, column), ids = typeof named === 'string' ? [named] : named ?? []
                const draw = () => {
                    const cell = layout.cell(row, column), inset = lineWidth / 2
                    painter.rect(cell.x + inset, cell.y + inset, cell.width - lineWidth, cell.height - lineWidth, fill, undefined, 0)
                    for (const highlight of highlights.filter(item => item.row === row && item.column === column)) {
                        const pad = Math.min(2, cell.width / 4, cell.height / 4)
                        components.fade(highlight.opacity ?? 1, () => painter.rect(cell.x + pad, cell.y + pad, cell.width - pad * 2, cell.height - pad * 2, highlight.fill, highlight.stroke, 0))
                    }
                    drawLabel(row, column)
                }
                const scoped = (index: number): void => {
                    if (index < ids.length && painter.target) painter.target(ids[index], () => scoped(index + 1))
                    else draw()
                }
                scoped(0)
            }
            for (const highlight of cellFocusTarget ? [] : highlights) {
                const cell = layout.cell(highlight.row, highlight.column)
                const inset = Math.min(2, cell.width / 4, cell.height / 4)
                components.fade(highlight.opacity ?? 1, () => {
                    painter.rect(cell.x + inset, cell.y + inset, cell.width - 2 * inset, cell.height - 2 * inset, highlight.fill, highlight.stroke, 0)
                })
            }
            const inset = lineWidth / 2
            for (let column = 1; column < columns; column += 1) {
                const left = x + column * width / columns
                painter.path([{ x: left, y: y + inset }, { x: left, y: y + height - inset }], { color: stroke, width: lineWidth })
            }
            for (let row = 1; row < rows; row += 1) {
                const top = y + row * height / rows
                painter.path([{ x: x + inset, y: top }, { x: x + width - inset, y: top }], { color: stroke, width: lineWidth })
            }
            if (!cellFocusTarget) labels?.forEach((row, r) => row.forEach((_, column) => drawLabel(r, column)))
        })
        return { ...layout, shape }
    }
}
