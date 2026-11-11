import type { CanvasBounds, CanvasPainter } from './canvas-components'
import type { CellGridLayout } from './teaching-grid'

/** The top-left address of a tile in a grid. */
export interface GridTileEndpoint {
    grid: CellGridLayout
    row?: number
    column?: number
}

export interface TeachingTileCell {
    label?: string | number
    fill?: string
    stroke?: string
    textColor?: string
}

export interface TeachingTileTransferOptions {
    source: GridTileEndpoint
    target: GridTileEndpoint
    cells: readonly (readonly TeachingTileCell[])[]
    progress: number
    /** Fraction of the transfer between the launches of the first and last rows. */
    rowStagger?: number
    gap?: number
    fontSize?: number
    fill?: string
    stroke?: string
    textColor?: string
}

/** Paint each cell at its position between corresponding addresses in two grids. */
export function createTeachingTileTransfer<Shape extends CanvasBounds>(painter: CanvasPainter<Shape>) {
    return (options: TeachingTileTransferOptions) => {
        const { source, target, cells, rowStagger = 0, gap = 3, fontSize = 24 } = options
        const rows = cells.length, columns = cells[0]?.length ?? 0
        if (!columns || cells.some(row => row.length !== columns)) throw new Error('A tile requires a nonempty rectangle of cells')
        if (!Number.isFinite(options.progress)) throw new Error('Tile transfer progress must be finite')
        if (!Number.isFinite(rowStagger) || rowStagger < 0 || rowStagger >= 1) throw new Error('Tile row stagger must be in [0, 1)')
        if (!Number.isFinite(gap) || gap < 0 || !Number.isFinite(fontSize) || fontSize <= 0) throw new Error('Invalid tile gap or font size')
        for (const endpoint of [source, target]) {
            const first = endpoint.grid.cell(endpoint.row ?? 0, endpoint.column ?? 0)
            endpoint.grid.cell((endpoint.row ?? 0) + rows - 1, (endpoint.column ?? 0) + columns - 1)
            if (gap >= Math.min(first.width, first.height)) throw new Error('Tile gap must be smaller than a cell at both endpoints')
        }
        const clock = Math.max(0, Math.min(1, options.progress))
        const stagger = rows > 1 ? rowStagger : 0
        let arrived = 0
        const shapes = cells.map((line, row) => {
            const delay = rows > 1 ? row / (rows - 1) * stagger : 0
            const progress = clock === 1 ? 1 : Math.max(0, Math.min(1, (clock - delay) / (1 - stagger)))
            if (progress === 1) arrived += columns
            return line.map((cell, column) => {
                const from = source.grid.cell((source.row ?? 0) + row, (source.column ?? 0) + column)
                const to = target.grid.cell((target.row ?? 0) + row, (target.column ?? 0) + column)
                const x = from.x + (to.x - from.x) * progress + gap / 2
                const y = from.y + (to.y - from.y) * progress + gap / 2
                const width = from.width + (to.width - from.width) * progress - gap
                const height = from.height + (to.height - from.height) * progress - gap
                const shape = painter.rect(x, y, width, height, cell.fill ?? options.fill ?? '#18283B',
                    cell.stroke ?? options.stroke ?? '#63DEEC', 0)
                if (cell.label !== undefined) {
                    painter.labelScope({ x, y, width, height }, () =>
                        painter.text(String(cell.label), x + width / 2, y + height / 2 + fontSize * 0.34,
                            fontSize, cell.textColor ?? options.textColor ?? '#FFFFFF', 'center'),
                    )
                }
                return shape
            })
        })
        return { cells: shapes, arrived, complete: arrived === rows * columns }
    }
}
