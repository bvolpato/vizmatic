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

function Token({ x, y, label, color, textColor, opacity = 1, size = 34 }: { x: number; y: number; label: string; color: string; textColor: string; opacity?: number; size?: number }) {
    return (
        <div style={{
            display: 'flex',
            position: 'absolute',
            left: x - size / 2,
            top: y - size / 2,
            width: size,
            height: size,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: size > 32 ? 10 : 7,
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
    const ownerColors = [c.info, c.primaryLight, c.secondaryLight, c.positiveLight]
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
                        <span style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: ownerColors[rank] }} />
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
    const color = getToneColor('green', c)
    const semanticColor = getReadableToneColor('green', c, c.bgCard)
    const p = clamp(progress)
    const gather = clamp(p / 0.46)
    const collapse = clamp((p - 0.46) / 0.18)
    const scatter = clamp((p - 0.64) / 0.36)
    const inputOpacity = 1 - clamp((p - 0.52) / 0.14)
    const resultOpacity = clamp((p - 0.52) / 0.14)
    const centerX = 548
    const centerY = 181
    const outputX = 850
    const chunkColors = [c.info, c.primaryLight, c.secondaryLight, c.positiveLight]
    const gridLeft = centerX - 66
    const gridTop = centerY - 50
    const gridColumnGap = 44
    const gridRowGap = 32
    const phase = p < 0.12
        ? 'rank-local chunks'
        : p < 0.44
            ? 'align matching chunk indices'
            : p < 0.58
                ? 'reduce each chunk index'
                : p < 0.92
                    ? 'scatter one completed chunk per rank'
                    : 'partitioned reduced result'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', width, height, opacity: 0 }} />
            <div style={{ display: 'flex', position: 'absolute', top: 18, width: '100%', justifyContent: 'center', color: c.textPrimary, fontSize: 36, fontWeight: 800 }}>NCCL · ReduceScatter</div>
            <div style={{ display: 'flex', position: 'absolute', top: 62, width: '100%', justifyContent: 'center', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>Reduce corresponding chunks, then assign one completed shard to each GPU</div>

            <div style={{ display: 'flex', position: 'absolute', left: 26, top: 100, width: 988, height: 374, overflow: 'hidden', borderRadius: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 18, alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 6, height: 28, borderRadius: 6, backgroundColor: color }} />
                    <span style={{ color: c.textPrimary, fontSize: 20, fontWeight: 800 }}>ReduceScatter</span>
                    <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>color identifies final owner</span>
                </div>
                <div style={{ display: 'flex', position: 'absolute', right: 22, top: 24, color: semanticColor, fontFamily: c.fontMono, fontSize: 12, fontWeight: 900 }}>ALL → ONE SHARD / RANK</div>

                <RankLanes c={c} />
                <div style={{ display: 'flex', position: 'absolute', left: centerX - 100, top: centerY - 73, width: 200, height: 150, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, opacity: 0.82 }} />
                <div style={{ display: 'flex', position: 'absolute', left: centerX - 58, top: centerY - 92, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11, fontWeight: 900 }}>REDUCE BY INDEX</div>
                {[0, 1, 2, 3].map((destination) => (
                    <div
                        key={`owner-${destination}`}
                        style={{
                            display: 'flex',
                            position: 'absolute',
                            left: gridLeft + destination * gridColumnGap - 12,
                            top: gridTop - 26,
                            width: 24,
                            height: 16,
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 4,
                            backgroundColor: chunkColors[destination],
                            color: getReadableTextColor(chunkColors[destination], c),
                            fontFamily: c.fontMono,
                            fontSize: 10,
                            fontWeight: 900,
                        }}
                    >
                        R{destination}
                    </div>
                ))}

                <div style={{ display: 'flex', position: 'absolute', inset: 0, opacity }}>
                    {inputOpacity > 0.01 && [0, 1, 2, 3].flatMap((source) => [0, 1, 2, 3].map((destination) => {
                        const startX = 208 + destination * 36
                        const startY = rankY(source)
                        const chunkColor = chunkColors[destination]
                        const gridX = gridLeft + destination * gridColumnGap
                        const gridY = gridTop + source * gridRowGap
                        const reducedX = gridX
                        const reducedY = centerY
                        const x = collapse > 0
                            ? gridX + (reducedX - gridX) * collapse
                            : startX + (gridX - startX) * gather
                        const y = collapse > 0
                            ? gridY + (reducedY - gridY) * collapse
                            : startY + (gridY - startY) * gather
                        return (
                            <Token
                                key={`input-${source}-${destination}`}
                                x={x}
                                y={y}
                                label={`${source}:${destination}`}
                                color={chunkColor}
                                textColor={getReadableTextColor(chunkColor, c)}
                                opacity={inputOpacity}
                                size={28}
                            />
                        )
                    }))}
                    {[0, 1, 2, 3].map((destination) => {
                        const slotX = gridLeft + destination * gridColumnGap
                        const chunkColor = chunkColors[destination]
                        return (
                            <Token
                                key={`output-${destination}`}
                                x={slotX + (outputX - slotX) * scatter}
                                y={centerY + (rankY(destination) - centerY) * scatter}
                                label={`R${destination}`}
                                color={chunkColor}
                                textColor={getReadableTextColor(chunkColor, c)}
                                opacity={resultOpacity}
                                size={38}
                            />
                        )
                    })}

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
            hold(800, 'rank-local chunks'),
            tween<Partial<State>>({ progress: 1 }, { duration: 3000, easing: 'ease-in-out', label: 'reduce and scatter' }),
            hold(1000, 'one shard per rank'),
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
