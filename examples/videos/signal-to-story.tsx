import {
    defineAnimation,
    hold,
    parallel,
    pointAlongPath,
    smoothstep,
    tracePolyline,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

type State = { intro: number; observations: number; trace: number; cursor: number; focus: number; camera: number; outro: number }

// Synthetic observations and their least-squares fit, not measured performance.
const values = [34, 51, 39, 67, 53, 79, 61, 88, 77, 105, 94, 115]
const meanX = (values.length - 1) / 2
const meanY = values.reduce((sum, value) => sum + value, 0) / values.length
export const slope = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0)
    / values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0)
const intercept = meanY - slope * meanX
const plot = { left: 136, top: 284, width: 1008, height: 286 }
const xAt = (index: number) => plot.left + index * plot.width / (values.length - 1)
const yAt = (value: number) => plot.top + plot.height - (value - 20) / 110 * plot.height
const trend = values.map((_, index) => ({ x: xAt(index), y: yAt(intercept + slope * index) }))

function buildFrame(theme: ThemeMode, state: State) {
    const dark = theme === 'dark'
    const c = dark
        ? { bg: '#0a191e', surface: '#10272e', text: '#edf6ee', muted: '#a4bbbd', line: '#25434a', mint: '#a5f2c6', gold: '#f3ca79', orange: '#ffad8a' }
        : { bg: '#f3f5ec', surface: '#e5ecdf', text: '#17353a', muted: '#506b6c', line: '#cad8ce', mint: '#19744d', gold: '#926317', orange: '#a84d32' }
    const visible = tracePolyline(trend, state.trace)
    const marker = pointAlongPath(trend, state.cursor)
    const chartOpacity = (1 - state.outro) * Math.min(1, state.observations * 4)
    const chapter = state.focus > 0.2 ? '03 / MAKE IT MEAN SOMETHING' : state.trace > 0 ? '02 / REVEAL THE RELATIONSHIP' : '01 / START WITH THE OBSERVATIONS'
    const headline = state.focus > 0.2 ? 'A relationship you can see.' : state.trace > 0 ? 'Let the pattern emerge.' : 'Every point has a story.'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.text, fontFamily: 'Inter' }}>
            <div style={{ display: 'flex', position: 'absolute', left: 760, top: 80, width: 520, height: 520, borderRadius: 520, backgroundImage: `radial-gradient(circle, ${c.surface}, ${c.bg})` }} />
            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 38, right: 64, alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}><span style={{ display: 'flex', width: 12, height: 12, borderRadius: 4, backgroundColor: c.mint, transform: 'rotate(-12deg)' }} />vizmatic</div>
                <span style={{ color: c.muted, fontSize: 12, letterSpacing: 2, fontFamily: 'JetBrains Mono' }}>A STUDY IN MOTION / 001</span>
            </div>

            {state.intro > 0 && <div style={{ display: 'flex', position: 'absolute', left: 90, top: 176 - 24 * state.intro, flexDirection: 'column', opacity: state.intro }}>
                <span style={{ color: c.mint, fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 3, marginBottom: 24 }}>FROM NOISE TO SIGNAL</span>
                <div style={{ display: 'flex', flexDirection: 'column', fontSize: 104, fontWeight: 700, lineHeight: 1.06, letterSpacing: -6 }}><span>Make the</span><span style={{ color: c.mint }}>invisible click.</span></div>
                <span style={{ color: c.muted, marginTop: 28, fontSize: 22 }}>One scene. A little math. A story that moves.</span>
            </div>}

            {chartOpacity > 0 && <div style={{ display: 'flex', position: 'absolute', inset: 0, opacity: chartOpacity, transform: `scale(${1 + state.camera * 0.035})` }}>
                <div style={{ display: 'flex', position: 'absolute', left: 90, top: 124, flexDirection: 'column', gap: 16 }}>
                    <span style={{ color: c.mint, fontFamily: 'JetBrains Mono', fontSize: 13, letterSpacing: 2 }}>{chapter}</span>
                    <span style={{ fontSize: 47, fontWeight: 700, letterSpacing: -2 }}>{headline}</span>
                </div>
                {[20, 50, 80, 110].map((value) => <div key={value} style={{ display: 'flex', position: 'absolute', left: plot.left, top: yAt(value), width: plot.width, height: 1, backgroundColor: c.line }} />)}
                {[20, 50, 80, 110].map((value) => <span key={`label-${value}`} style={{ position: 'absolute', left: 87, top: yAt(value) - 8, color: c.muted, fontSize: 12, fontFamily: 'JetBrains Mono' }}>{value}</span>)}
                <span style={{ position: 'absolute', left: plot.left, top: 600, color: c.muted, fontSize: 12, fontFamily: 'JetBrains Mono' }}>01</span>
                <span style={{ position: 'absolute', right: 136, top: 600, color: c.muted, fontSize: 12, fontFamily: 'JetBrains Mono' }}>12 OBSERVATIONS</span>
                {values.map((value, index) => {
                    const arrival = smoothstep(Math.min(1, Math.max(0, state.observations * 1.9 - index * 0.075)))
                    return <div key={index} style={{ display: 'flex', position: 'absolute', left: xAt(index) - 7, top: yAt(value) - 7 + 52 * (1 - arrival), width: 14, height: 14, borderRadius: 14, backgroundColor: c.gold, opacity: arrival * (1 - state.focus * 0.35) }} />
                })}
                {visible.length > 1 && <svg style={{ position: 'absolute', left: 0, top: 0 }} width={width} height={height} viewBox={`0 0 ${width} ${height}`}><polyline points={visible.map(({ x, y }) => `${x},${y}`).join(' ')} fill="none" stroke={c.mint} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                {state.trace > 0 && <div style={{ display: 'flex', position: 'absolute', left: marker.x - 9, top: marker.y - 9, width: 18, height: 18, borderRadius: 18, backgroundColor: c.mint, border: `4px solid ${c.bg}` }} />}
                <div style={{ display: 'flex', position: 'absolute', left: 688, top: 488 - 12 * state.focus, flexDirection: 'column', gap: 9, padding: '18px 24px', borderRadius: 12, backgroundColor: c.surface, opacity: state.focus }}>
                    <span style={{ color: c.mint, fontSize: 28, fontWeight: 700 }}>+{slope.toFixed(1)} per observation</span>
                    <span style={{ color: c.muted, fontSize: 14 }}>Least-squares trend. Every point still visible.</span>
                </div>
            </div>}

            {state.outro > 0 && <div style={{ display: 'flex', position: 'absolute', inset: 0, backgroundColor: c.bg, opacity: state.outro, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <span style={{ color: c.mint, fontFamily: 'JetBrains Mono', fontSize: 14, letterSpacing: 3, marginBottom: 26 }}>FROM CODE TO CLARITY</span>
                <span style={{ fontSize: 85, fontWeight: 700, letterSpacing: -5 }}>Give your ideas</span>
                <span style={{ color: c.mint, fontSize: 85, fontWeight: 700, letterSpacing: -5 }}>a little motion.</span>
                <div style={{ display: 'flex', gap: 28, marginTop: 32, color: c.muted, fontSize: 17 }}><span>Editable TSX</span><span style={{ color: c.orange }}>→</span><span>Typed timelines</span><span style={{ color: c.orange }}>→</span><span>Your next film</span></div>
                <span style={{ marginTop: 42, color: c.muted, fontFamily: 'JetBrains Mono', fontSize: 14 }}>vizmatic / bvolpato.github.io/vizmatic</span>
            </div>}

            <div style={{ display: 'flex', position: 'absolute', left: 64, right: 64, bottom: 32, justifyContent: 'space-between', alignItems: 'center', color: c.muted, fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                <span>DESIGNED IN CODE. RENDERED FRAME BY FRAME.</span><span>SYNTHETIC DATA / REAL MOTION</span>
            </div>
        </div>
    )
}

export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation<State>({
        initial: { intro: 0, observations: 0, trace: 0, cursor: 0, focus: 0, camera: 0, outro: 0 },
        timeline: [
            tween({ intro: 1 }, { duration: 700, easing: 'ease-out' }),
            hold(1300, 'Make the invisible click'),
            parallel<State>({
                intro: [tween(0, { duration: 650, easing: 'ease-in-out' })],
                observations: [hold(350), tween(1, { duration: 2050, easing: 'ease-out' })],
            }, 'Collect observations'),
            hold(600),
            parallel<State>({
                trace: [tween(1, { duration: 3600, easing: 'ease-in-out' })],
                cursor: [tween(1, { duration: 3600, easing: 'ease-in-out' })],
            }, 'Reveal the trend'),
            hold(800),
            parallel<State>({
                focus: [tween(1, { duration: 1000, easing: 'ease-out' })],
                camera: [tween(1, { duration: 1600, easing: 'ease-in-out' })],
            }, 'Explain the relationship'),
            hold(2200),
            parallel<State>({
                camera: [tween(0, { duration: 1000, easing: 'ease-in-out' })],
                outro: [hold(400), tween(1, { duration: 1200, easing: 'ease-in-out' })],
            }, 'From code to clarity'),
            hold(3200),
        ],
        fps: 20,
        render: (state) => buildFrame(theme, state),
    })
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, { intro: 1, observations: 0, trace: 0, cursor: 0, focus: 0, camera: 0, outro: 0 })
}

export default create('dark')
