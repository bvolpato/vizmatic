import {
    crossCorrelate2d, getThemeColors, Matrix, PixelGrid,
    type RgbPixel, type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

// A synthetic 6×6 grayscale image and a hand-set, illustrative edge detector.
// A trained CNN learns its weights. Here one channel, one filter and bias 0
// isolate the spatial operation: unflipped cross-correlation, as in Conv2d.
export const kernelInput = [
    [0, 0, 0, 0, 0, 0],
    [0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0],
    [0, 0, 0, 0, 0, 0],
]
export const edgeKernel = [[-1, 0, 1], [-1, 0, 1], [-1, 0, 1]]
export const kernelResponse = crossCorrelate2d(kernelInput, edgeKernel)
export const kernelActivation = kernelResponse.map(row => row.map(value => Math.max(0, value)))
const inputPixels: RgbPixel[][] = kernelInput.map(row => row.map(value => [value * 255, value * 255, value * 255]))
const labels = (values: number[][]) => values.map(row => row.map(String))

export interface KernelLessonState {
    cell: number
    term: number
    filled: number
    windowRow: number
    windowCol: number
    moving: number
    reveal: number
}

export function convolutionFrame(theme: ThemeMode, state: Readonly<KernelLessonState>) {
    const c = getThemeColors(theme)
    const accent = theme === 'dark' ? c.warningLight : c.warningDark
    const positive = theme === 'dark' ? c.positiveLight : c.positiveDark
    const negative = theme === 'dark' ? c.criticalLight : c.criticalDark
    const row = Math.floor(state.cell / 4), col = state.cell % 4
    const tap = Math.min(8, Math.max(0, Math.round(state.term)))
    const kr = Math.floor(tap / 3), kc = tap % 3
    const response = kernelResponse[row][col]
    const rowProducts = edgeKernel.map((weights, r) => weights.map((weight, k) => kernelInput[row + r][col + k] * weight))
    const rowSums = rowProducts.map(values => values.reduce((sum, value) => sum + value, 0))
    const knownLabels = (values: number[][]) => values.map((valuesRow, r) => valuesRow.map((value, k) => r * 4 + k < state.filled ? String(value) : '·'))
    const isComputing = state.moving < .01
    const gridX = 46, gridY = 232, pitch = 46
    const reveal = state.reveal
    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', position: 'absolute', left: 46, top: 32, flexDirection: 'column', gap: 7 }}>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 13, letterSpacing: 2 }}>DEEP LEARNING / A CONVOLUTION YOU CAN CALCULATE</span>
                <span style={{ fontSize: 41, fontWeight: 750, letterSpacing: -1 }}>One small filter. An entire feature map.</span>
                <span style={{ fontSize: 18, color: c.textSecondary }}>Slide the same weights across the image. Multiply, add, then apply ReLU.</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: gridX, top: 168, flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 23, fontWeight: 700 }}>Input image <span style={{ color: c.textSecondary, fontSize: 16 }}>6 × 6</span></span>
                <span style={{ fontSize: 15, color: c.textSecondary }}>Synthetic pixels · black 0 / white 1</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: gridX, top: gridY, opacity: 1 - reveal }}><PixelGrid c={c} pixels={inputPixels} width={274} height={274} /></div>
            <div style={{ display: 'flex', position: 'absolute', left: gridX, top: gridY, opacity: reveal }}>
                <Matrix c={c} data={kernelInput} labels={labels(kernelInput)} cellSize={44} fontSize={20} colorize={false} {...(isComputing ? { highlightCell: { row: row + kr, col: col + kc } } : {})} highlightColor={accent} />
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: gridX + state.windowCol * pitch - 3, top: gridY + state.windowRow * pitch - 3, width: 142, height: 142, border: `3px solid ${accent}`, borderRadius: 9, boxSizing: 'border-box', opacity: reveal }} />
            <div style={{ display: 'flex', position: 'absolute', left: 345, top: 316, color: c.textSecondary, fontSize: 34, opacity: reveal }}>×</div>
            <div style={{ display: 'flex', position: 'absolute', left: 390, top: 168, width: 208, flexDirection: 'column', gap: 6, opacity: reveal }}>
                <span style={{ fontSize: 23, fontWeight: 700 }}>Kernel <span style={{ color: c.textSecondary, fontSize: 16 }}>3 × 3</span></span>
                <span style={{ fontSize: 15, color: c.textSecondary }}>Hand-set vertical-edge filter</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: 402, top: 270, opacity: reveal }}>
                <Matrix c={c} data={edgeKernel} labels={labels(edgeKernel)} cellSize={52} fontSize={22} colorize={false} {...(isComputing ? { highlightCell: { row: kr, col: kc } } : {})} highlightColor={accent} />
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: 390, top: 458, width: 220, flexDirection: 'column', gap: 8, opacity: reveal }}>
                <span style={{ color: c.textSecondary, fontSize: 15 }}>Stride 1 · no padding · bias 0</span>
                <span style={{ color: c.textSecondary, fontSize: 15 }}>6 − 3 + 1 = 4 per axis</span>
            </div>
            <span style={{ display: 'flex', position: 'absolute', left: 618, top: 316, color: c.textSecondary, fontSize: 31, opacity: reveal }}>=</span>
            <div style={{ display: 'flex', position: 'absolute', left: 664, top: 168, flexDirection: 'column', gap: 6, opacity: reveal }}>
                <span style={{ fontSize: 23, fontWeight: 700 }}>Response <span style={{ color: c.textSecondary, fontSize: 16 }}>4 × 4</span></span>
                <span style={{ fontSize: 15, color: c.textSecondary }}>Keep the sign of every sum</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: 664, top: 250, opacity: reveal }}>
                <Matrix c={c} data={kernelResponse} labels={knownLabels(kernelResponse)} cellSize={51} fontSize={22} colorize={false} highlightCell={{ row, col }} highlightColor={response < 0 ? negative : positive} />
            </div>
            <span style={{ display: 'flex', position: 'absolute', left: 664, top: 478, color: c.textSecondary, fontSize: 15, opacity: reveal }}>Left edge: + · right edge: −</span>
            <div style={{ display: 'flex', position: 'absolute', left: 896, top: 302, flexDirection: 'column', alignItems: 'center', gap: 3, opacity: reveal }}>
                <span style={{ color: c.textPrimary, fontSize: 16, fontWeight: 700 }}>ReLU</span>
                <span style={{ color: c.textSecondary, fontSize: 30 }}>→</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: 986, top: 168, flexDirection: 'column', gap: 6, opacity: reveal }}>
                <span style={{ fontSize: 23, fontWeight: 700 }}>Activation <span style={{ color: c.textSecondary, fontSize: 16 }}>4 × 4</span></span>
                <span style={{ fontSize: 15, color: c.textSecondary }}>max(0, response)</span>
            </div>
            <div style={{ display: 'flex', position: 'absolute', left: 986, top: 250, opacity: reveal }}>
                <Matrix c={c} data={kernelActivation} labels={knownLabels(kernelActivation)} cellSize={51} fontSize={22} colorize={false} highlightCell={{ row, col }} highlightColor={positive} />
            </div>
            <span style={{ display: 'flex', position: 'absolute', left: 986, top: 478, color: c.textSecondary, fontSize: 15, opacity: reveal }}>Negative responses become zero.</span>
            <div style={{ display: 'flex', position: 'absolute', left: 46, top: 538, width: 1188, height: 132, borderRadius: 14, border: `1px solid ${c.borderSubtle}`, backgroundColor: c.bgCard, opacity: reveal }}>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 16, color: accent, fontFamily: c.fontMono, fontSize: 13, letterSpacing: 1.2 }}>{isComputing ? `OUTPUT [${row}, ${col}] · NINE PIXEL × WEIGHT PRODUCTS` : 'SLIDE THE SAME KERNEL TO THE NEXT PATCH'}</div>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 48, gap: 14, fontFamily: c.fontMono, fontSize: 19, alignItems: 'center' }}>
                    {rowProducts.map((_, r) => <span key={r} style={{ display: 'flex', padding: '7px 9px', borderRadius: 6, border: `1px solid ${r === kr && isComputing ? accent : c.borderSubtle}`, color: c.textPrimary }}>{kernelInput[row + r][col]}×(−1) + {kernelInput[row + r][col + 1]}×0 + {kernelInput[row + r][col + 2]}×1 = {rowSums[r]}</span>)}
                    <span style={{ color: response < 0 ? negative : positive, fontSize: 27, fontWeight: 700 }}>Σ = {response}</span>
                </div>
                <span style={{ display: 'flex', position: 'absolute', left: 22, top: 101, color: c.textSecondary, fontSize: 14 }}>Current tap: {kernelInput[row + kr][col + kc]} × ({edgeKernel[kr][kc]}) = {rowProducts[kr][kc]} · ReLU({response}) = {Math.max(0, response)}</span>
            </div>
            <span style={{ display: 'flex', position: 'absolute', left: 46, top: 690, color: c.textSecondary, fontSize: 12 }}>One input channel / one filter. Real CNNs learn weights, sum over input channels, and may add a bias. Conv2d uses cross-correlation: weights are not flipped.</span>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return convolutionFrame(theme, { cell: 6, term: 0, filled: 16, windowRow: 1, windowCol: 2, moving: 0, reveal: 1 })
}
export default create('dark')
