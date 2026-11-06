import type { CanvasBounds, CanvasPainter } from './canvas-components'

export type ByteDifferenceKind = 'equal' | 'replace' | 'insert' | 'delete'

export interface ByteDifferenceColumn {
    id: string
    kind: ByteDifferenceKind
    before: { offset: number, value: number } | null
    after: { offset: number, value: number } | null
}

export interface ByteDifference {
    algorithm: 'common-prefix/suffix with positional middle'
    beforeLength: number
    afterLength: number
    commonPrefix: number
    commonSuffix: number
    equal: boolean
    columns: ByteDifferenceColumn[]
}

/** A linear alignment of one changed region, not a minimum-edit diff. */
export function compareByteSequences(before: Uint8Array, after: Uint8Array): ByteDifference {
    if (!(before instanceof Uint8Array) || !(after instanceof Uint8Array)) {
        throw new Error('Byte comparison requires two Uint8Arrays')
    }
    const left = Array.from(before), right = Array.from(after)
    let commonPrefix = 0, commonSuffix = 0
    while (commonPrefix < Math.min(left.length, right.length) && left[commonPrefix] === right[commonPrefix]) commonPrefix++
    while (commonSuffix < Math.min(left.length, right.length) - commonPrefix
        && left[left.length - commonSuffix - 1] === right[right.length - commonSuffix - 1]) commonSuffix++
    const columns: ByteDifferenceColumn[] = []
    const add = (oldOffset: number | null, newOffset: number | null) => {
        const oldByte = oldOffset === null ? null : { offset: oldOffset, value: left[oldOffset] }
        const newByte = newOffset === null ? null : { offset: newOffset, value: right[newOffset] }
        const kind = !oldByte ? 'insert' : !newByte ? 'delete' : oldByte.value === newByte.value ? 'equal' : 'replace'
        columns.push({ id: `before:${oldOffset ?? 'none'}|after:${newOffset ?? 'none'}`, kind, before: oldByte, after: newByte })
    }
    for (let offset = 0; offset < commonPrefix; offset++) add(offset, offset)
    const leftMiddle = left.length - commonPrefix - commonSuffix
    const rightMiddle = right.length - commonPrefix - commonSuffix
    for (let offset = 0; offset < Math.max(leftMiddle, rightMiddle); offset++) {
        add(offset < leftMiddle ? commonPrefix + offset : null, offset < rightMiddle ? commonPrefix + offset : null)
    }
    for (let offset = 0; offset < commonSuffix; offset++) {
        add(left.length - commonSuffix + offset, right.length - commonSuffix + offset)
    }
    return { algorithm: 'common-prefix/suffix with positional middle', beforeLength: left.length, afterLength: right.length,
        commonPrefix, commonSuffix, equal: left.length === right.length && commonPrefix === left.length, columns }
}

/** Labels describe individual bytes, never a lossy Unicode decoding. */
export function escapedByte(value: number): string {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error('A byte must be an integer from 0 through 255')
    if (value === 0) return '\\0'
    if (value === 9) return '\\t'
    if (value === 10) return '\\n'
    if (value === 13) return '\\r'
    if (value === 32) return 'space'
    if (value === 92) return '\\\\'
    if (value >= 33 && value <= 126) return String.fromCharCode(value)
    return `\\x${value.toString(16).padStart(2, '0').toUpperCase()}`
}

export interface ByteDifferenceStateOptions {
    before: Uint8Array
    after: Uint8Array
    scanProgress: number
    revealVerdict?: boolean
}

export function byteDifferenceState(options: ByteDifferenceStateOptions) {
    if (!Number.isFinite(options.scanProgress)) throw new Error('Byte scan progress must be finite')
    const comparison = compareByteSequences(options.before, options.after)
    const progress = Math.max(0, Math.min(1, options.scanProgress))
    const scannedColumns = Math.floor(progress * comparison.columns.length)
    return { comparison, progress, scannedColumns, scanComplete: progress === 1,
        verdict: options.revealVerdict ? comparison.equal ? 'equal' as const : 'different' as const : null }
}

export interface TeachingByteDifferenceOptions extends CanvasBounds, ByteDifferenceStateOptions {
    /** Window into the complete alignment; omitted byte columns are counted. */
    startColumn?: number
    maxColumns?: number
    /** At least 24 px, leaving readable labels inside the checked 4 px padding. */
    fontSize?: number
    beforeLabel?: string
    afterLabel?: string
    fill?: string
    stroke?: string
    textColor?: string
    mutedColor?: string
    scanColor?: string
    changeColor?: string
}

export function layoutByteDifference(options: TeachingByteDifferenceOptions) {
    const { x, y, width, height, fontSize = 28, maxColumns = 10 } = options
    if (![x, y, width, height, fontSize, x + width, y + height].every(Number.isFinite) || width <= 0 || height <= 0 || fontSize <= 0) {
        throw new Error('Byte strip bounds and font size must be finite with positive dimensions')
    }
    if (fontSize < 24) throw new Error('Byte strip font size must be at least 24 px for checked label padding')
    if (!Number.isSafeInteger(maxColumns) || maxColumns < 1) throw new Error('Byte window size must be a positive safe integer')
    const state = byteDifferenceState(options), all = state.comparison.columns
    const start = options.startColumn ?? Math.max(0, state.comparison.commonPrefix - 2)
    if (!Number.isSafeInteger(start) || start < 0 || start > all.length || all.length > 0 && start === all.length) {
        throw new Error('Byte window start is outside the alignment')
    }
    const columns = all.slice(start, start + maxColumns), count = Math.max(1, columns.length)
    const gutter = fontSize * 5.2, cellWidth = (width - gutter) / count
    const longest = Math.max(5, ...columns.flatMap(column => [column.before, column.after].map(byte => byte ? String(byte.offset).length + 1 : 5)))
    if (cellWidth < fontSize * .65 * longest + 12 || height < fontSize * 10) {
        throw new Error('Byte strip cannot fit its byte labels and offsets')
    }
    const headerHeight = fontSize * 1.7, footerHeight = fontSize * 1.7, rowHeight = (height - headerHeight - footerHeight) / 2
    // Validate every inset used below before the host receives any drawing.
    if (cellWidth <= 4 || rowHeight <= 4 || gutter - 8 <= 8
        || headerHeight <= 8 || footerHeight <= 8 || rowHeight * .3 <= 8) {
        throw new Error('Byte strip cannot fit positive cell insets and checked label padding')
    }
    const cells = columns.map((column, index) => ({ column, alignmentIndex: start + index,
        beforeBounds: { x: x + gutter + index * cellWidth, y: y + headerHeight, width: cellWidth, height: rowHeight },
        afterBounds: { x: x + gutter + index * cellWidth, y: y + headerHeight + rowHeight, width: cellWidth, height: rowHeight } }))
    return { ...state, bounds: { x, y, width, height }, cells, gutter, headerHeight, footerHeight, rowHeight,
        omittedLeading: start, omittedTrailing: all.length - start - columns.length }
}

/** Paint through the host's checked primitives; verdict visibility never follows scan progress implicitly. */
export function createTeachingByteDifference<Shape>(painter: CanvasPainter<Shape>) {
    return (options: TeachingByteDifferenceOptions) => {
        const layout = layoutByteDifference(options)
        const { x, y, width, height, fontSize = 28, fill = '#101820', stroke = '#516376', textColor = '#E9EFFF',
            mutedColor = '#91A3B8', scanColor = '#63DEEC', changeColor = '#F4D477', beforeLabel = 'Before', afterLabel = 'After' } = options
        const label = (value: string, bounds: CanvasBounds, size: number, color = textColor) => painter.labelScope(bounds, () => {
            painter.text(value, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + size * .34, size, color, 'center', 'mono')
        }, { padding: 4 })
        painter.container(layout.bounds, () => {
            label('Prefix/suffix alignment; positional middle; not minimum edits',
                { x, y, width, height: layout.headerHeight }, fontSize * .63, mutedColor)
            for (const [row, name] of [beforeLabel, afterLabel].entries()) {
                label(name, { x, y: y + layout.headerHeight + row * layout.rowHeight, width: layout.gutter - 8, height: layout.rowHeight }, fontSize * .72)
            }
            for (const cell of layout.cells) {
                const visited = cell.alignmentIndex < layout.scannedColumns
                const color = visited ? cell.column.kind === 'equal' ? mutedColor : changeColor : stroke
                for (const [byte, bounds] of [[cell.column.before, cell.beforeBounds], [cell.column.after, cell.afterBounds]] as const) {
                    painter.rect(bounds.x + 2, bounds.y + 2, bounds.width - 4, bounds.height - 4, fill, color, 0)
                    label(byte ? `@${byte.offset}` : 'none', { ...bounds, height: bounds.height * .3 }, fontSize * .65, mutedColor)
                    label(byte ? byte.value.toString(16).padStart(2, '0').toUpperCase() : '--',
                        { ...bounds, y: bounds.y + bounds.height * .3, height: bounds.height * .35 }, fontSize, visited ? textColor : mutedColor)
                    label(byte ? escapedByte(byte.value) : 'no byte',
                        { ...bounds, y: bounds.y + bounds.height * .65, height: bounds.height * .35 }, fontSize * .7, mutedColor)
                }
            }
            if (!layout.cells.length) {
                for (const row of [0, 1]) label('empty', { x: x + layout.gutter, y: y + layout.headerHeight + row * layout.rowHeight,
                    width: width - layout.gutter, height: layout.rowHeight }, fontSize, mutedColor)
            }
            const scanPosition = layout.progress * layout.comparison.columns.length - layout.omittedLeading
            if (layout.cells.length && scanPosition >= 0 && scanPosition <= layout.cells.length) {
                const cellWidth = layout.cells[0].beforeBounds.width
                const cursor = Math.max(1, Math.min(width - layout.gutter - 1, scanPosition * cellWidth))
                painter.rect(x + layout.gutter + cursor - 1, y + layout.headerHeight - 7, 2, 5,
                    scanColor, undefined, 0)
            }
            const verdict = layout.verdict === null ? 'Verdict held' : layout.verdict === 'equal' ? 'Bytes equal' : 'Bytes differ'
            label(`${layout.omittedLeading} columns before window; ${layout.omittedTrailing} after · ${verdict}`,
                { x, y: y + height - layout.footerHeight, width, height: layout.footerHeight }, fontSize * .66,
                layout.verdict === null ? mutedColor : textColor)
        }, { padding: 0 })
        return layout
    }
}
