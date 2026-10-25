/**
 * Four explicit illustrative Q/K/V vectors; no learned model or generated output.
 * Each query uses only keys at its own index or earlier, before row-wise softmax.
 * Source: https://arxiv.org/abs/1706.03762 (scaled dot-product attention, section3.2.1).
 */
import {
    AttentionMatrix,
    defineAnimation,
    getThemeColors,
    hold,
    scaledDotProductAttention,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

export const queries = [[1, 0], [0, 1], [1, 1], [1, -1]]
export const keys = [[1, 0], [0, 1], [1, 1], [-1, 1]]
export const values = [[1, 0], [0, 2], [2, 1], [-1, 3]]
export const attention = scaledDotProductAttention(queries, keys, values, { causal: true })
export const causalMask = queries.map((_, row) => keys.map((__, column) => column <= row))
const labels = ['Token 1', 'Token 2', 'Token 3', 'Token 4']

export function attentionFocus(cursor: number) {
    if (!Number.isFinite(cursor)) throw new Error('The attention cursor must be finite')
    const bounded = Math.max(0, Math.min(3.999, cursor))
    const query = Math.floor(bounded)
    const key = Math.min(query, Math.floor((bounded - query) * (query + 1)))
    return { query, key, weights: attention.weights[query], output: attention.output[query], scores: attention.scores[query] }
}

const vectorText = (row: readonly number[]) => `[${row.map(value => value.toFixed(2)).join(', ')}]`

function buildFrame(theme: ThemeMode, cursor: number) {
    const c = getThemeColors(theme)
    const focus = attentionFocus(cursor)
    const accent = theme === 'dark' ? c.infoLight : c.infoDark
    const resultColor = theme === 'dark' ? c.positiveLight : c.positiveDark

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 42, flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14, letterSpacing: 2 }}>ARTIFICIAL INTELLIGENCE / CAUSAL ATTENTION</span>
                <span style={{ fontSize: 48, fontWeight: 750, letterSpacing: -1.5 }}>The future gets zero weight.</span>
                <span style={{ color: c.textSecondary, fontSize: 22 }}>Mask scores before softmax, then use the normalized weights to mix values.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 48, top: 178 }}>
                <AttentionMatrix c={c} width={788} height={420} weights={attention.weights} mask={causalMask}
                    queryLabels={labels} keyLabels={labels} activeQuery={focus.query} activeKey={focus.key}
                    title="Causal attention probabilities" />
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 884, top: 216, width: 330, flexDirection: 'column', gap: 16 }}>
                <span style={{ color: accent, fontSize: 27, fontWeight: 750 }}>Query: Token {focus.query + 1}</span>
                <span style={{ color: c.textSecondary, fontSize: 13, fontFamily: c.fontMono }}>MASKED QKᵀ / √2</span>
                <span style={{ fontFamily: c.fontMono, fontSize: 18 }}>[{focus.scores.map(score => score === null ? '−∞' : score.toFixed(2)).join(', ')}]</span>
                <span style={{ marginTop: 10, color: c.textSecondary, fontSize: 13, fontFamily: c.fontMono }}>ROW-WISE SOFTMAX</span>
                <span style={{ fontFamily: c.fontMono, fontSize: 18 }}>{vectorText(focus.weights)}</span>
                <span style={{ marginTop: 18, color: c.textSecondary, fontSize: 13, fontFamily: c.fontMono }}>WEIGHTED VALUE OUTPUT</span>
                <span style={{ color: resultColor, fontFamily: c.fontMono, fontSize: 36, fontWeight: 700 }}>{vectorText(focus.output)}</span>
                <span style={{ color: c.textSecondary, fontSize: 18, lineHeight: 1.5 }}>Every displayed value is computed from the same Q, K and V.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 90, top: 618, flexDirection: 'column', gap: 16 }}>
                <span style={{ color: c.textPrimary, fontFamily: c.fontMono, fontSize: 22 }}>V = [[1, 0], [0, 2], [2, 1], [−1, 3]]</span>
                <span style={{ color: c.textMuted, fontSize: 16 }}>Four explicit illustrative vectors. Each highlighted row is a separate query, not a blended query.</span>
            </div>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, 3.999)
}

export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation({
        initial: { cursor: 0 },
        timeline: [
            tween({ cursor: 3.999 }, { duration: 6500, easing: 'linear', label: 'Inspect four causal attention rows' }),
            hold(1500, 'Read the last weighted output'),
        ],
        fps: 30,
        render: ({ cursor }) => buildFrame(theme, cursor),
    })
}

export default create('dark')
