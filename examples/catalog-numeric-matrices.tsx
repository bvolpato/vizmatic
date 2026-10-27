import {
    getThemeColors,
    Matrix,
    multiplyMatrices,
    transposeMatrix,
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
const transposedA = transposeMatrix(matrixA)
const integerLabels = (values: number[][]) => values.map(row => row.map(String))

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    const accent = theme === 'dark' ? c.warningLight : c.warningDark
    const output = product[1][1]

    return (
        <div style={{ position: 'relative', display: 'flex', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ position: 'absolute', left: 54, top: 38, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700, letterSpacing: 2 }}>LINEAR ALGEBRA / NUMERIC MATRICES</span>
                <span style={{ fontSize: 42, fontWeight: 760, letterSpacing: -1.3 }}>Multiply a row by a column.</span>
                <span style={{ color: c.textSecondary, fontSize: 19 }}>Every output cell is one dot product. Follow the highlighted pair to C₂₂.</span>
            </div>

            <div style={{ position: 'absolute', left: 42, top: 168, display: 'flex', width: 340, height: 286, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 286, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 25, fontWeight: 750 }}>A <span style={{ color: c.textMuted, fontSize: 16, fontWeight: 500 }}>2 × 3</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 15 }}>Select row 2</span>
                </div>
                <Matrix data={matrixA} c={c} rowLabels={['A₁', 'A₂']} colLabels={['k₁', 'k₂', 'k₃']} labels={integerLabels(matrixA)} format="integer" cellWidth={66} cellHeight={56} rowLabelWidth={45} fontSize={21} highlightRow={1} highlightColor={accent} colorDomain={[-2, 9]} />
            </div>

            <span style={{ position: 'absolute', left: 397, top: 274, color: c.textMuted, fontSize: 46, fontWeight: 500 }}>×</span>

            <div style={{ position: 'absolute', left: 466, top: 168, display: 'flex', width: 340, height: 286, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 286, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 25, fontWeight: 750 }}>B <span style={{ color: c.textMuted, fontSize: 16, fontWeight: 500 }}>3 × 2</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 15 }}>Select column 2</span>
                </div>
                <Matrix data={matrixB} c={c} rowLabels={['k₁', 'k₂', 'k₃']} colLabels={['B₁', 'B₂']} labels={integerLabels(matrixB)} format="integer" cellWidth={72} cellHeight={42} rowLabelWidth={45} fontSize={20} highlightCol={1} highlightColor={accent} colorDomain={[-2, 9]} />
            </div>

            <span style={{ position: 'absolute', left: 821, top: 274, color: c.textMuted, fontSize: 43, fontWeight: 500 }}>=</span>

            <div style={{ position: 'absolute', left: 874, top: 168, display: 'flex', width: 364, height: 286, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 300, flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: c.textPrimary, fontSize: 25, fontWeight: 750 }}>C = AB <span style={{ color: c.textMuted, fontSize: 16, fontWeight: 500 }}>2 × 2</span></span>
                    <span style={{ color: c.textSecondary, fontSize: 15 }}>The selected output is {output}</span>
                </div>
                <Matrix data={product} c={c} rowLabels={['A₁', 'A₂']} colLabels={['B₁', 'B₂']} labels={integerLabels(product)} format="integer" cellWidth={76} cellHeight={62} rowLabelWidth={45} fontSize={23} highlightCell={{ row: 1, col: 1 }} highlightColor={accent} colorDomain={[-2, 9]} />
            </div>

            <div style={{ position: 'absolute', left: 42, top: 486, display: 'flex', width: 748, height: 192, flexDirection: 'column', justifyContent: 'center', gap: 14, padding: '20px 26px', boxSizing: 'border-box', backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <span style={{ color: accent, fontFamily: c.fontMono, fontSize: 14, fontWeight: 700, letterSpacing: 1.5 }}>ONE OUTPUT, THREE MULTIPLICATIONS</span>
                <span style={{ fontSize: 24, fontWeight: 700 }}>C₂₂ = A₂ · B₂</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: c.textPrimary, fontFamily: c.fontMono, fontSize: 21, fontWeight: 650 }}>
                    <span style={{ color: accent }}>−1 × 1</span>
                    <span style={{ color: c.textMuted }}>+</span>
                    <span>3 × 4</span>
                    <span style={{ color: c.textMuted }}>+</span>
                    <span>2 × −2</span>
                    <span style={{ color: c.textMuted }}>=</span>
                    <span style={{ color: accent, fontSize: 27 }}>{output}</span>
                </div>
                <span style={{ color: c.textSecondary, fontSize: 15 }}>The inner dimensions match: 3 columns in A and 3 rows in B.</span>
            </div>

            <div style={{ position: 'absolute', left: 812, top: 486, display: 'flex', width: 426, height: 192, alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', boxSizing: 'border-box', backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}`, borderRadius: 16 }}>
                <div style={{ display: 'flex', width: 150, flexDirection: 'column', gap: 8 }}>
                    <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>TRANSPOSE</span>
                    <span style={{ fontSize: 21, fontWeight: 700 }}>Rows become columns.</span>
                    <span style={{ color: c.textSecondary, fontSize: 14 }}>A is 2 × 3; Aᵀ is 3 × 2.</span>
                </div>
                <Matrix data={transposedA} c={c} labels={integerLabels(transposedA)} format="integer" cellWidth={48} cellHeight={38} fontSize={17} colorize={false} />
            </div>
        </div>
    )
}

export default create('dark')
