import {
    defineAnimation,
    getThemeColors,
    hold,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

type State = { progress: number }

const stages = [
    { label: '01', title: 'Receive', detail: 'Accept the request', x: 110 },
    { label: '02', title: 'Process', detail: 'Do the work', x: 490 },
    { label: '03', title: 'Return', detail: 'Send the result', x: 870 },
] as const

function buildFrame(theme: ThemeMode, progress: number) {
    const c = getThemeColors(theme)
    const markerX = 260 + progress * 760
    const complete = progress > 0.94

    return (
        <div style={{
            display: 'flex', position: 'relative', width, height, overflow: 'hidden',
            backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans,
        }}>
            <div style={{ display: 'flex', position: 'absolute', left: 96, top: 84, flexDirection: 'column', gap: 14 }}>
                <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 16, letterSpacing: 2 }}>A REQUEST IN MOTION</span>
                <span style={{ fontSize: 52, fontWeight: 750, letterSpacing: -1.5 }}>One request. Three steps.</span>
                <span style={{ color: c.textSecondary, fontSize: 22 }}>Follow it from arrival to the result.</span>
            </div>

            {stages.map((stage, index) => {
                const active = Math.min(2, Math.round(progress * 2)) === index
                return (
                    <div key={stage.label} style={{
                        display: 'flex', position: 'absolute', left: stage.x, top: 276,
                        width: 300, height: 158, flexDirection: 'column', justifyContent: 'center',
                        gap: 14, padding: '0 26px', borderRadius: 18,
                        backgroundColor: active ? c.bgCard : c.bgCardAlt,
                        border: `2px solid ${active ? c.primary : c.borderSubtle}`,
                    }}>
                        <span style={{ color: active ? c.textPrimary : c.textMuted, fontFamily: c.fontMono, fontSize: 14, letterSpacing: 1.5 }}>{stage.label}</span>
                        <span style={{ fontSize: 28, fontWeight: 700 }}>{stage.title}</span>
                        <span style={{ color: c.textSecondary, fontSize: 17 }}>{stage.detail}</span>
                    </div>
                )
            })}

            <div style={{ display: 'flex', position: 'absolute', left: 260, top: 510, width: 760, height: 4, backgroundColor: c.borderSubtle }} />
            {[260, 640, 1020].map((x, index) => (
                <div key={x} style={{
                    display: 'flex', position: 'absolute', left: x - 7, top: 502,
                    width: 18, height: 18, borderRadius: 18,
                    backgroundColor: progress >= index / 2 ? c.positive : c.bg,
                    border: `2px solid ${progress >= index / 2 ? c.positive : c.borderLight}`,
                }} />
            ))}

            <div style={{
                display: 'flex', position: 'absolute', left: markerX - 66, top: 468,
                minWidth: 132, height: 42, alignItems: 'center', justifyContent: 'center',
                borderRadius: 21, padding: '0 14px', color: c.textOnColor,
                backgroundColor: complete ? c.positiveDark : c.secondaryDark,
                fontFamily: c.fontMono, fontSize: 15, fontWeight: 700,
            }}>{complete ? 'RESULT READY' : 'REQUEST'}</div>

            <div style={{
                display: 'flex', position: 'absolute', left: 0, right: 0, top: 594,
                justifyContent: 'center', color: c.textPrimary,
                fontSize: 22, fontWeight: complete ? 700 : 500,
            }}>{complete ? 'The result returns to the caller.' : 'The request advances through the workflow.'}</div>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, 1)
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation<State>({
        initial: { progress: 0 },
        timeline: [
            hold(900, 'Follow the request'),
            tween({ progress: 0.5 }, { duration: 1800, easing: 'ease-in-out', label: 'Process the request' }),
            hold(500, 'Work completes'),
            tween({ progress: 1 }, { duration: 1800, easing: 'ease-in-out', label: 'Return the result' }),
            hold(1600, 'Read the completed workflow'),
        ],
        fps: 30,
        render: (state) => buildFrame(theme, state.progress),
    })
}

export default create('dark')
