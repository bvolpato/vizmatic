import type { CanvasBounds, CanvasPainter } from './canvas-components'

export interface TeachingRasterWipeOptions<Value> extends CanvasBounds {
    rows: number
    columns: number
    /** Row-major samples on the leading and trailing sides of the divider. */
    left: ArrayLike<Value>
    right: ArrayLike<Value>
    /** Fraction of the image occupied by the left raster. */
    split: number
    /** Assign each output pixel to the sample under its center. Use final pixel coordinates. */
    snapToPixels?: boolean
    color(value: Value, row: number, column: number): string
}

/** Compare two pixel fields in the same coordinate system as the divider moves. */
export function createTeachingRasterWipe(painter: Pick<CanvasPainter, 'rect'>) {
    return function rasterWipe<Value>(options: TeachingRasterWipeOptions<Value>) {
        const { x, y, width, height, rows, columns, left, right, split, color } = options
        if (![x, y, width, height, x + width, y + height].every(Number.isFinite) || width <= 0 || height <= 0) {
            throw new Error('Raster bounds must be finite and have positive dimensions')
        }
        if (![rows, columns, rows * columns].every(Number.isSafeInteger) || rows < 1 || columns < 1) {
            throw new Error('Raster rows and columns must be positive safe integers')
        }
        if (left.length !== rows * columns || right.length !== rows * columns) {
            throw new Error('Both rasters must match the declared rows and columns')
        }
        if (!Number.isFinite(split) || split < 0 || split > 1) {
            throw new Error('Raster split must be a fraction between zero and one')
        }

        const edge = options.snapToPixels ? (v: number) => Math.ceil(v - 0.5) : (v: number) => v
        const dividerX = edge(x + width * split)
        for (let row = 0; row < rows; row++) {
            const top = edge(y + height * (row / rows))
            const bottom = edge(y + height * ((row + 1) / rows))
            if (top === bottom) continue
            for (let column = 0; column < columns; column++) {
                const start = edge(x + width * (column / columns))
                const end = edge(x + width * ((column + 1) / columns))
                if (start === end) continue
                const cut = Math.max(start, Math.min(end, dividerX))
                const index = row * columns + column
                if (start < cut && cut < end) {
                    const leftColor = color(left[index], row, column)
                    const rightColor = color(right[index], row, column)
                    if (leftColor !== rightColor) {
                        painter.rect(start, top, cut - start, bottom - top, leftColor, undefined, 0)
                        painter.rect(cut, top, end - cut, bottom - top, rightColor, undefined, 0)
                        continue
                    }
                    painter.rect(start, top, end - start, bottom - top, leftColor, undefined, 0)
                } else {
                    const field = cut === end ? left : right
                    painter.rect(start, top, end - start, bottom - top, color(field[index], row, column), undefined, 0)
                }
            }
        }
        return { dividerX }
    }
}
