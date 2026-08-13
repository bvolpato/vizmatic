import {
    defineAnimation,
    getReadableToneColor,
    getReadableTextColor,
    getThemeColors,
    getToneColor,
    hold,
    keyframe,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 500

type State = { progress: number; opacity: number }
type Colors = ReturnType<typeof getThemeColors>

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const rankY = (rank: number) => 100 + rank * 54

function Token({ x, y, color, textColor }: { x: number; y: number; color: string; textColor: string }) {
    return (
        <div style={{
            display: 'flex',
            position: 'absolute',
            left: x - 17,
            top: y - 17,
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 34,
            backgroundColor: color,
            color: textColor,
            fontFamily: 'JetBrains Mono',
            fontSize: 12,
            fontWeight: 900,
        }}>
            X
        </div>
    )
}

function RankLanes({ c }: { c: Colors }) {
    return (
        <div style={{ display: 'flex', position: 'absolute', inset: 0 }}>
            {[0, 1, 2, 3].map((rank) => (
                <div key={rank} style={{ display: 'flex', position: 'absolute', inset: 0 }}>
                    <div style={{
                        display: 'flex',
                        position: 'absolute',
                        left: 22,
                        top: rankY(rank) - 16,
                        width: 122,
                        height: 32,
                        alignItems: 'center',
                        gap: 10,
                        paddingLeft: 12,
                        borderRadius: 9,
                        backgroundColor: c.bgCardAlt,
                        border: `1px solid ${c.borderSubtle}`,
                        color: c.textPrimary,
                        fontFamily: c.fontMono,
                        fontSize: 12,
                        fontWeight: 800,
                    }}>
                        <span style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: rank === 0 ? c.info : c.neutralLight }} />
                        rank {rank}
                    </div>
                    <div style={{ display: 'flex', position: 'absolute', left: 170, top: rankY(rank) - 1, width: 780, height: 2, backgroundColor: c.borderSubtle }} />
                </div>
            ))}
        </div>
    )
}

function Frame({ theme, progress, opacity = 1 }: { theme: ThemeMode; progress: number; opacity?: number }) {
    const c = getThemeColors(theme)
    const color = getToneColor('cyan', c)
    const semanticColor = getReadableToneColor('cyan', c, c.bgCard)
    const textColor = getReadableTextColor(color, c)
    const p = clamp(progress)
    const sourceX = 226
    const targetX = 850
    const phase = p < 0.08 ? 'root buffer' : p < 0.92 ? 'fan-out copies' : 'replicated on every rank'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', width, height, opacity: 0 }} />
            <div style={{ display: 'flex', position: 'absolute', top: 18, width: '100%', justifyContent: 'center', color: c.textPrimary, fontSize: 36, fontWeight: 800 }}>NCCL · Broadcast</div>
            <div style={{ display: 'flex', position: 'absolute', top: 62, width: '100%', justifyContent: 'center', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>One root-owned buffer becomes available on every GPU</div>

            <div style={{ display: 'flex', position: 'absolute', left: 26, top: 100, width: 988, height: 374, overflow: 'hidden', borderRadius: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 18, alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 6, height: 28, borderRadius: 6, backgroundColor: color }} />
                    <span style={{ color: c.textPrimary, fontSize: 20, fontWeight: 800 }}>Broadcast</span>
                    <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>root sends; peers do not contribute</span>
                </div>
                <div style={{ display: 'flex', position: 'absolute', right: 22, top: 24, color: semanticColor, fontFamily: c.fontMono, fontSize: 12, fontWeight: 900 }}>ONE → ALL</div>

                <RankLanes c={c} />
                <div style={{ display: 'flex', position: 'absolute', inset: 0, opacity }}>
                    {[1, 2, 3].map((rank) => (
                        <Token
                            key={rank}
                            x={sourceX + (targetX - sourceX) * p}
                            y={rankY(0) + (rankY(rank) - rankY(0)) * p}
                            color={color}
                            textColor={textColor}
                        />
                    ))}
                    <Token x={sourceX} y={rankY(0)} color={color} textColor={textColor} />
                    <div style={{ display: 'flex', position: 'absolute', left: sourceX - 20, top: rankY(0) - 40, color: c.textPrimary, fontFamily: c.fontMono, fontSize: 11, fontWeight: 900 }}>ROOT</div>

                    <div style={{ display: 'flex', position: 'absolute', left: 22, top: 312, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>{phase}</div>
                    <div style={{ display: 'flex', position: 'absolute', left: 170, top: 338, width: 780, height: 6, borderRadius: 6, backgroundColor: c.borderSubtle }}>
                        <div style={{ display: 'flex', width: `${Math.round(p * 100)}%`, height: 6, borderRadius: 6, backgroundColor: color }} />
                    </div>
                </div>
            </div>
        </div>
    )
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation<State>({
        initial: { progress: 0, opacity: 0 },
        timeline: [
            tween<Partial<State>>({ opacity: 1 }, { duration: 300, easing: 'ease-in-out', label: 'show root buffer' }),
            hold(800, 'root buffer'),
            tween<Partial<State>>({ progress: 1 }, { duration: 2600, easing: 'ease-in-out', label: 'fan out copies' }),
            hold(1000, 'replicated result'),
            tween<Partial<State>>({ opacity: 0 }, { duration: 300, easing: 'ease-in-out', label: 'hide output' }),
            keyframe<Partial<State>>({ progress: 0 }, 'reset hidden'),
        ],
        fps: 20,
        render: (state) => <Frame theme={theme} progress={state.progress} opacity={state.opacity} />,
    })
}

export function create(theme: ThemeMode = 'dark') {
    return <Frame theme={theme} progress={1} />
}

export default create('dark')
