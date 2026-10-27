import {
    defineAnimation,
    getThemeColors,
    hold,
    keyframe,
    Matrix,
    multiplyMatrices,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

const matrixA = [
    [1, 2, 0],
    [-1, 3, 2],
]
const matrixB = [
    [2, 1],
    [0, 4],
    [3, -2],
]
const product = multiplyMatrices(matrixA, matrixB)
const integerLabels = (values: number[][]) => values.map(row => row.map(String))
type MultiplicationState = { cell: number; term: number }

function buildFrame(theme: ThemeMode, state: Readonly<MultiplicationState>) {
    const c = getThemeColors(theme)
    const outputRow = Math.floor(state.cell / product[0].length)
    const outputCol = state.cell % product[0].length
    const termIndex = Math.max(0, Math.min(matrixA[0].length - 1, Math.round(state.term)))
    const currentLeft = matrixA[outputRow][termIndex]
    const currentRight = matrixB[termIndex][outputCol]
    const activeColor = theme === 'dark' ? c.warningLight : c.warningDark
    const formulaTerms = matrixA[outputRow].map((left, index) => ({
        left,
        right: matrixB[index][outputCol],
        product: left * matrixB[index][outputCol],
    }))
    const colorDomain: readonly [number, number] = [-2, 9]

    return (
        <div style={{ position: 'relative', display: 'flex', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ position: 'absolute', left: 54, top: 36, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>LINEAR ALGEBRA / A PRODUCT YOU CAN FOLLOW</span>
                <span style={{ fontSize: 40, fontWeight: 760, letterSpacing: -1.2 }}>One row. One column. One output.</span>
                <span style={{ color: c.textSecondary, fontSize: 18 }}>The highlighted pair of entries contributes to the selected cell in C.</span>
            </div>

            <div style={{ position: 'absolute', left: 42, top: 150, display: 'flex', width: 330, height: 294, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 282, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 24, fontWeight: 750 }}>A <span style={{ color: c.textMuted, fontSize: 15, fontWeight: 500 }}>2 × 3</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 14 }}>Row {outputRow + 1} is selected</span>
                </div>
                <Matrix data={matrixA} c={c} rowLabels={['A₁', 'A₂']} colLabels={['k₁', 'k₂', 'k₃']} labels={integerLabels(matrixA)} format="integer" cellWidth={62} cellHeight={50} rowLabelWidth={42} fontSize={19} highlightRow={outputRow} highlightCell={{ row: outputRow, col: termIndex }} highlightColor={activeColor} colorDomain={colorDomain} />
            </div>

            <span style={{ position: 'absolute', left: 386, top: 259, color: c.textMuted, fontSize: 43, fontWeight: 500 }}>×</span>

            <div style={{ position: 'absolute', left: 426, top: 150, display: 'flex', width: 330, height: 294, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 282, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 24, fontWeight: 750 }}>B <span style={{ color: c.textMuted, fontSize: 15, fontWeight: 500 }}>3 × 2</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 14 }}>Column {outputCol + 1} is selected</span>
                </div>
                <Matrix data={matrixB} c={c} rowLabels={['k₁', 'k₂', 'k₃']} colLabels={['B₁', 'B₂']} labels={integerLabels(matrixB)} format="integer" cellWidth={70} cellHeight={43} rowLabelWidth={42} fontSize={19} highlightCol={outputCol} highlightCell={{ row: termIndex, col: outputCol }} highlightColor={activeColor} colorDomain={colorDomain} />
            </div>

            <span style={{ position: 'absolute', left: 773, top: 259, color: c.textMuted, fontSize: 41, fontWeight: 500 }}>=</span>

            <div style={{ position: 'absolute', left: 814, top: 150, display: 'flex', width: 424, height: 294, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 340, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 24, fontWeight: 750 }}>C = AB <span style={{ color: c.textMuted, fontSize: 15, fontWeight: 500 }}>2 × 2</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 14 }}>Output C{outputRow + 1}{outputCol + 1} = {product[outputRow][outputCol]}</span>
                </div>
                <Matrix data={product} c={c} rowLabels={['A₁', 'A₂']} colLabels={['B₁', 'B₂']} labels={integerLabels(product)} format="integer" cellWidth={78} cellHeight={60} rowLabelWidth={44} fontSize={22} highlightCell={{ row: outputRow, col: outputCol }} highlightColor={activeColor} colorDomain={colorDomain} />
            </div>

            <div style={{ position: 'absolute', left: 42, top: 466, display: 'flex', width: 1196, height: 206, flexDirection: 'column', justifyContent: 'center', gap: 16, padding: '22px 28px', boxSizing: 'border-box', backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: activeColor, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700, letterSpacing: 1.5 }}>DOT PRODUCT · ROW {outputRow + 1} × COLUMN {outputCol + 1}</span>
                    <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 15 }}>TERM {termIndex + 1} OF 3 · {currentLeft} × {currentRight} = {currentLeft * currentRight}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontFamily: c.fontMono, fontSize: 23, fontWeight: 650 }}>
                    {formulaTerms.map((term, index) => (
                        <div key={`term-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                            {index > 0 && <span style={{ color: c.textMuted }}>+</span>}
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', borderRadius: 10, backgroundColor: index === termIndex ? `${activeColor}26` : c.bgCardAlt, color: c.textPrimary, ...(index === termIndex ? { boxShadow: `inset 0 0 0 2px ${activeColor}` } : {}) }}>
                                <span>{term.left} × {term.right}</span>
                                <span style={{ color: c.textPrimary, fontSize: 17 }}>= {term.product}</span>
                            </span>
                        </div>
                    ))}
                    <span style={{ color: c.textMuted }}>=</span>
                    <span style={{ color: c.textPrimary, fontSize: 29 }}>{product[outputRow][outputCol]}</span>
                </div>

                <span style={{ color: c.textSecondary, fontSize: 16 }}>The three products add to the selected result. The matrix values and this arithmetic come from the same A and B.</span>
            </div>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, { cell: 0, term: 0 })
}

export function createAnimation(theme: ThemeMode = 'dark') {
    const timeline = []
    for (let cell = 0; cell < product.length * product[0].length; cell += 1) {
        if (cell > 0) {
            timeline.push(keyframe<Partial<MultiplicationState>>({ cell, term: 0 }, `Select output C${Math.floor(cell / product[0].length) + 1}${cell % product[0].length + 1}`))
        }
        timeline.push(tween<Partial<MultiplicationState>>({ term: 1 }, { duration: 650, easing: 'ease-in-out', label: 'Follow the next pair of values' }))
        timeline.push(tween<Partial<MultiplicationState>>({ term: 2 }, { duration: 650, easing: 'ease-in-out', label: 'Complete the dot product' }))
        timeline.push(hold(800, 'Read the output value'))
    }

    return defineAnimation<MultiplicationState>({
        initial: { cell: 0, term: 0 },
        timeline,
        fps: 30,
        render: state => buildFrame(theme, state),
    })
}

export default create('dark')
