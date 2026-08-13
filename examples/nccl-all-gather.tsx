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

function Token({ x, y, label, color, textColor, opacity = 1 }: { x: number; y: number; label: string; color: string; textColor: string; opacity?: number }) {
    return (
        <div style={{
            display: 'flex',
            position: 'absolute',
            left: x - 15,
            top: y - 15,
            width: 30,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: color,
            color: textColor,
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            fontWeight: 900,
            opacity,
        }}>
            {label}
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
                        <span style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: c.neutralLight }} />
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
    const color = getToneColor('blue', c)
    const semanticColor = getReadableToneColor('blue', c, c.bgCard)
    const textColor = getReadableTextColor(color, c)
    const p = clamp(progress)
    const gather = clamp(p / 0.5)
    const replicate = clamp((p - 0.44) / 0.56)
    const inputOpacity = 1 - clamp((p - 0.46) / 0.12)
    const centerX = 548
    const centerY = 181
    const sourceX = 226
    const outputX = 730
    const labels = ['A', 'B', 'C', 'D']
    const phase = p < 0.46 ? 'gather rank-owned shards' : p < 0.92 ? 'replicate ordered tensor' : 'A · B · C · D on every rank'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', width, height, opacity: 0 }} />
            <div style={{ display: 'flex', position: 'absolute', top: 18, width: '100%', justifyContent: 'center', color: c.textPrimary, fontSize: 36, fontWeight: 800 }}>NCCL · AllGather</div>
            <div style={{ display: 'flex', position: 'absolute', top: 62, width: '100%', justifyContent: 'center', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>Every GPU contributes one shard and receives complete ordered tensor</div>

            <div style={{ display: 'flex', position: 'absolute', left: 26, top: 100, width: 988, height: 374, overflow: 'hidden', borderRadius: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 18, alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 6, height: 28, borderRadius: 6, backgroundColor: color }} />
                    <span style={{ color: c.textPrimary, fontSize: 20, fontWeight: 800 }}>AllGather</span>
                    <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>collect shards in rank order</span>
                </div>
                <div style={{ display: 'flex', position: 'absolute', right: 22, top: 24, color: semanticColor, fontFamily: c.fontMono, fontSize: 12, fontWeight: 900 }}>ALL → ALL · CONCAT</div>

                <RankLanes c={c} />
                <div style={{ display: 'flex', position: 'absolute', left: centerX - 58, top: centerY - 48, width: 116, height: 96, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, opacity: 0.82 }} />
                <div style={{ display: 'flex', position: 'absolute', left: centerX - 25, top: centerY - 65, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11, fontWeight: 900 }}>CONCAT</div>
                <div style={{ display: 'flex', position: 'absolute', inset: 0, opacity }}>
                    {inputOpacity > 0.01 && labels.map((label, rank) => {
                        const slotX = centerX - 36 + rank * 24
                        return (
                            <Token
                                key={`input-${rank}`}
                                x={sourceX + (slotX - sourceX) * gather}
                                y={rankY(rank) + (centerY - rankY(rank)) * gather}
                                label={label}
                                color={color}
                                textColor={textColor}
                                opacity={inputOpacity}
                            />
                        )
                    })}
                    {[0, 1, 2, 3].flatMap((target) => labels.map((label, source) => {
                        const slotX = centerX - 36 + source * 24
                        return (
                            <Token
                                key={`output-${target}-${source}`}
                                x={slotX + (outputX + source * 40 - slotX) * replicate}
                                y={centerY + (rankY(target) - centerY) * replicate}
                                label={label}
                                color={color}
                                textColor={textColor}
                                opacity={replicate}
                            />
                        )
                    }))}

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
            tween<Partial<State>>({ opacity: 1 }, { duration: 300, easing: 'ease-in-out', label: 'show input' }),
            hold(800, 'one shard per rank'),
            tween<Partial<State>>({ progress: 1 }, { duration: 3000, easing: 'ease-in-out', label: 'gather and replicate' }),
            hold(1000, 'complete tensors'),
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
