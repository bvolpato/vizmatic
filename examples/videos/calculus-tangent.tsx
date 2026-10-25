/**
 * The secant of f(x)=x² at x=1 has slope 2+h; its limit as h→0 is 2.
 * The moving point, secant, number line and readout share the same positive h.
 * Source: https://openstax.org/books/calculus-volume-1/pages/3-1-defining-the-derivative
 */
import {
    AxisPlot,
    NumberLine,
    defineAnimation,
    getThemeColors,
    hold,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

export function secantState(h: number) {
    if (!Number.isFinite(h) || h <= 0) throw new Error('The secant increment must be positive and finite')
    return { h, x: 1 + h, y: (1 + h) ** 2, slope: 2 + h, tangentSlope: 2 }
}

const parabola = Array.from({ length: 121 }, (_, index) => {
    const x = index / 40
    return { x, y: x * x }
})

function buildFrame(theme: ThemeMode, h: number) {
    const c = getThemeColors(theme)
    const state = secantState(h)
    const secantColor = theme === 'dark' ? c.warningLight : c.warningDark
    const tangentColor = theme === 'dark' ? c.positiveLight : c.positiveDark
    const curveColor = theme === 'dark' ? c.secondaryLight : c.secondaryDark

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 42, flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14, letterSpacing: 2 }}>CALCULUS / A LIMIT YOU CAN SEE</span>
                <span style={{ fontSize: 48, fontWeight: 750, letterSpacing: -1.5 }}>Two points become one tangent.</span>
                <span style={{ color: c.textSecondary, fontSize: 22 }}>The increment shrinks. The secant slope approaches 2.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 184 }}>
                <AxisPlot c={c} width={770} height={350} xMin={0} xMax={3} yMin={-3} yMax={9} padding={30}
                    showFrame={false} showGrid gridCount={5} xAxisLabel="x" yAxisLabel="f(x)"
                    paths={[
                        { points: parabola, color: curveColor, strokeWidth: 4 },
                        { points: [{ x: 0, y: -1 }, { x: 3, y: 5 }], color: tangentColor, strokeWidth: 3, dashed: true },
                        { points: [{ x: 0, y: -1 - h }, { x: 3, y: 5 + 2 * h }], color: secantColor, strokeWidth: 4 },
                    ]}
                    vectors={[
                        { x1: 1, y1: 1, x2: state.x, y2: 1, color: secantColor, strokeWidth: 2 },
                        { x1: state.x, y1: 1, x2: state.x, y2: state.y, color: secantColor, strokeWidth: 2 },
                    ]}
                    points={[
                        { x: 1, y: 1, fill: tangentColor, r: 8, stroke: c.bg, strokeWidth: 3 },
                        { x: state.x, y: state.y, fill: secantColor, r: 8, stroke: c.bg, strokeWidth: 3 },
                    ]}
                />
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 888, top: 204, width: 324, flexDirection: 'column', gap: 14 }}>
                <span style={{ fontSize: 22, color: curveColor, fontWeight: 700 }}>f(x) = x²</span>
                <span style={{ fontSize: 17, color: c.textSecondary, fontFamily: c.fontMono }}>FIXED POINT (1, 1)</span>
                <span style={{ marginTop: 12, fontSize: 18, color: secantColor, fontFamily: c.fontMono }}>h = {h.toFixed(2)}</span>
                <span style={{ fontSize: 18, color: c.textSecondary }}>Secant slope</span>
                <span style={{ fontSize: 54, fontWeight: 750, color: secantColor, fontFamily: c.fontMono }}>{state.slope.toFixed(2)}</span>
                <span style={{ fontSize: 20, fontFamily: c.fontMono }}>m = 2 + h</span>
                <span style={{ marginTop: 18, fontSize: 21, color: tangentColor, fontWeight: 700 }}>Tangent slope = 2</span>
                <span style={{ color: c.textSecondary, fontSize: 17, lineHeight: 1.5 }}>The tangent is the limit, not a second approximation.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 78, top: 544 }}>
                <NumberLine c={c} width={740} height={132} min={0} max={1.8} title="The increment h"
                    ticks={[{ value: 0 }, { value: 0.6 }, { value: 1.2 }, { value: 1.8 }]}
                    markers={[{ id: 'increment', label: `h = ${h.toFixed(2)}`, value: h, color: secantColor }]}
                    ariaLabel={`Positive increment h is ${h.toFixed(2)} and approaches zero`} />
            </div>
            <span style={{ position: 'absolute', left: 888, top: 632, width: 324, fontSize: 15, color: c.textMuted }}>Each secant uses h ≠ 0. Take the limit as h → 0.</span>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, 0.04)
}

export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation({
        initial: { h: 1.6 },
        timeline: [
            tween({ h: 0.04 }, { duration: 6000, easing: 'ease-out', label: 'Shrink the secant increment' }),
            hold(1800, 'Read the limiting slope'),
        ],
        fps: 30,
        render: ({ h }) => buildFrame(theme, h),
    })
}

export default create('dark')
