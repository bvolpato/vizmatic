import {
    crossCorrelate2d,
    getThemeColors,
    Matrix,
    PixelGrid,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

const input = Array.from({ length: 7 }, (_, row) =>
    Array.from({ length: 7 }, (_, column) => row === 3 && column === 3 ? 240 : 0))
const binomialAxis = [1, 2, 1]
const kernelNumerators = binomialAxis.map(row => binomialAxis.map(column => row * column))
const kernel = kernelNumerators.map(row => row.map(value => value / 16))
const output = crossCorrelate2d(input, kernel, { padding: 'same' })
const outputCrop = output.slice(2, 5).map(row => row.slice(2, 5))
export const gaussianOutputTargets = [
    { row: 3, column: 3 },
    { row: 2, column: 2 },
    { row: 2, column: 3 },
    { row: 2, column: 4 },
    { row: 3, column: 2 },
    { row: 3, column: 4 },
    { row: 4, column: 2 },
    { row: 4, column: 3 },
    { row: 4, column: 4 },
] as const
const integerLabels = (values: number[][]) => values.map(row => row.map(value => String(value)))
const pixelColors = (values: number[][], visible?: ReadonlySet<number>): readonly (readonly (readonly [number, number, number])[])[] =>
    values.map((row, rowIndex) => row.map((value, columnIndex) => {
        const visibleCell = visible === undefined || visible.has(rowIndex * row.length + columnIndex)
        const byte = visibleCell ? Math.round(value) : 0
        return [byte, byte, byte] as const
    }))

export interface GaussianBlurState {
    stage: number
    target: number
    tap: number
}

/** Shared by the catalog still and the MP4 lesson so every number agrees. */
export function blurFrame(theme: ThemeMode, state: Readonly<GaussianBlurState> = { stage: 1, target: gaussianOutputTargets.length, tap: 4 }) {
    const c = getThemeColors(theme)
    const stage = Math.max(0, Math.min(1, state.stage))
    const targetIndex = state.target >= gaussianOutputTargets.length ? 0 : Math.max(0, Math.min(gaussianOutputTargets.length - 1, Math.floor(state.target)))
    const tapIndex = Math.max(0, Math.min(8, Math.round(state.tap)))
    const target = gaussianOutputTargets[targetIndex]
    const selectedRow = target.row - 1
    const selectedColumn = target.column - 1
    const isCurrentReady = state.target >= gaussianOutputTargets.length || state.target > targetIndex || state.tap >= 7.99
    const completed = Math.min(gaussianOutputTargets.length, Math.max(0, Math.floor(state.target) + (state.target >= gaussianOutputTargets.length ? 0 : isCurrentReady ? 1 : 0)))
    const visibleOutputCells = new Set(state.target >= gaussianOutputTargets.length
        ? Array.from({ length: 49 }, (_, index) => index)
        : gaussianOutputTargets.slice(0, completed).map(cell => cell.row * 7 + cell.column))
    const selectedPixel = input[selectedRow + Math.floor(tapIndex / 3)][selectedColumn + tapIndex % 3]
    const selectedWeight = kernelNumerators[Math.floor(tapIndex / 3)][tapIndex % 3]
    const partial = Array.from({ length: tapIndex + 1 }, (_, index) => {
        const row = selectedRow + Math.floor(index / 3)
        const column = selectedColumn + index % 3
        return input[row]?.[column] ?? 0
    }).reduce<number>((sum, value, index) => sum + value * kernelNumerators[Math.floor(index / 3)][index % 3], 0)
    const operation = output[target.row][target.column]
    const accent = theme === 'dark' ? c.warningLight : c.warningDark
    const imageSize = 224 + (400 - 224) * (1 - stage)
    const imageLeft = 76 + (440 - 76) * (1 - stage)
    const imageTop = 220 + (180 - 220) * (1 - stage)
    const gridOpacity = stage
    const previewOnlyOpacity = 1 - stage
    const selectedOutput = output[target.row][target.column]
    const outputValues = outputCrop.map((row, rowIndex) => row.map((value, columnIndex) => {
        const visible = state.target >= gaussianOutputTargets.length || visibleOutputCells.has((rowIndex + 2) * 7 + columnIndex + 2)
        return visible ? value.toFixed(0) : '·'
    }))
    const formula = Array.from({ length: 9 }, (_, index) => {
        const value = input[selectedRow + Math.floor(index / 3)][selectedColumn + index % 3]
        const weight = kernelNumerators[Math.floor(index / 3)][index % 3]
        return `${value}×${weight}`
    }).join(' + ')

    return (
        <div style={{ position: 'relative', display: 'flex', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ position: 'absolute', left: 58, top: 37, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>COMPUTER VISION / GAUSSIAN-LIKE BLUR</span>
                <span style={{ fontSize: 43, fontWeight: 760, letterSpacing: -1.2 }}>A bright point spreads into its neighbors.</span>
                <span style={{ color: c.textSecondary, fontSize: 18 }}>A normalized kernel blends nearby pixels; padding sets the edge behavior.</span>
            </div>

            <div style={{ position: 'absolute', left: imageLeft, top: imageTop, display: 'flex', alignItems: 'center', justifyContent: 'center', width: imageSize, height: imageSize, opacity: previewOnlyOpacity, borderRadius: 18, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                <PixelGrid c={c} pixels={pixelColors(input)} width={imageSize - 24} height={imageSize - 24} />
            </div>

            <div style={{ position: 'absolute', left: 44, top: 167, display: 'flex', width: 352, height: 398, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: gridOpacity, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <span style={{ color: c.textPrimary, fontSize: 21, fontWeight: 730 }}>1 · Start with the image</span>
                <span style={{ color: c.textSecondary, fontSize: 14 }}>One 240-value pixel on a dark field</span>
                <div style={{ position: 'relative', display: 'flex' }}>
                    <PixelGrid c={c} pixels={pixelColors(input)} width={236} height={236}
                        region={{ row: selectedRow, column: selectedColumn, rows: 3, columns: 3 }}
                        activeCell={{ row: selectedRow + Math.floor(tapIndex / 3), column: selectedColumn + tapIndex % 3 }} highlightColor={accent} />
                </div>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>7 × 7 grayscale · values 0–255</span>
            </div>

            <div style={{ position: 'absolute', left: 424, top: 167, display: 'flex', width: 342, height: 398, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, opacity: gridOpacity, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <span style={{ color: c.textPrimary, fontSize: 21, fontWeight: 730 }}>2 · Weight the neighborhood</span>
                <span style={{ color: c.textSecondary, fontSize: 14 }}>A 3 × 3 binomial approximation · divide by 16</span>
                <Matrix c={c} data={kernelNumerators} labels={integerLabels(kernelNumerators)} colorize={false} format="integer" fontSize={22} cellWidth={52} cellHeight={48}
                    highlightCell={{ row: Math.floor(tapIndex / 3), col: tapIndex % 3 }} highlightColor={accent} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginTop: 7 }}>
                    <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14, fontWeight: 650 }}>K = vᵀv / 16 · v = [1, 2, 1]</span>
                    <span style={{ color: theme === 'dark' ? c.infoLight : c.infoDark, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700 }}>sum of all 9 weights = 1</span>
                </div>
            </div>

            <div style={{ position: 'absolute', left: 794, top: 167, display: 'flex', width: 442, height: 398, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, opacity: gridOpacity, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <span style={{ color: c.textPrimary, fontSize: 21, fontWeight: 730 }}>3 · Read the blurred image</span>
                <span style={{ color: c.textSecondary, fontSize: 14 }}>The image reveals as the kernel scans</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
                    <PixelGrid c={c} pixels={pixelColors(output, visibleOutputCells)} width={210} height={210}
                        activeCell={state.target < gaussianOutputTargets.length ? { row: target.row, column: target.column } : undefined} highlightColor={accent} />
                    <Matrix c={c} data={outputCrop} labels={outputValues} colorize={false} format="integer" fontSize={18} cellWidth={42} cellHeight={42}
                        highlightCell={state.target < gaussianOutputTargets.length ? { row: target.row - 2, col: target.column - 2 } : undefined} highlightColor={accent} />
                </div>
                <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 12 }}>Expanded output · rows 2–4 · columns 2–4</span>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>Center = {output[3][3].toFixed(0)} · adjacent = {output[3][2].toFixed(0)} · diagonal = {output[2][2].toFixed(0)}</span>
            </div>

            <div style={{ position: 'absolute', left: 44, top: 582, display: 'flex', width: 1192, height: 102, flexDirection: 'column', justifyContent: 'center', gap: 9, padding: '14px 22px', boxSizing: 'border-box', backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 14, opacity: gridOpacity }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ color: accent, fontFamily: c.fontMono, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>OUTPUT [{target.row}, {target.column}]</span>
                    <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>tap {Math.floor(tapIndex / 3) + 1},{tapIndex % 3 + 1} · {selectedPixel}×{selectedWeight} · first {tapIndex + 1}/9 terms: {partial}/16</span>
                    <span style={{ marginLeft: 'auto', color: c.textPrimary, fontFamily: c.fontMono, fontSize: 18, fontWeight: 750 }}>{isCurrentReady ? selectedOutput.toFixed(1) : '…'}</span>
                </div>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 13 }}>({formula}) / 16 = {operation.toFixed(1)} · zero padding preserves the 7 × 7 image size</span>
            </div>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return blurFrame(theme)
}

export default create('dark')
