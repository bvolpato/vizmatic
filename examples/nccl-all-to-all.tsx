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

function Token({ x, y, label, color, textColor }: { x: number; y: number; label: string; color: string; textColor: string }) {
    return (
        <div style={{
            display: 'flex',
            position: 'absolute',
            left: x - 20,
            top: y - 15,
            width: 40,
            height: 30,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8,
            backgroundColor: color,
            color: textColor,
            fontFamily: 'JetBrains Mono',
            fontSize: 11,
            fontWeight: 900,
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
    const color = getToneColor('warm', c)
    const semanticColor = getReadableToneColor('warm', c, c.bgCard)
    const p = clamp(progress)
    const stageProgress = clamp(p / 0.5)
    const laneProgress = clamp((p - 0.5) / 0.18)
    const destinationProgress = clamp((p - 0.68) / 0.22)
    const packProgress = clamp((p - 0.9) / 0.1)
    const sourceX = 210
    const outputX = 722
    const sourceGap = 44
    const exchangeLeft = 444
    const exchangeTop = 112
    const exchangeColumnGap = 42
    const exchangeRowGap = 36
    const destinationColors = [c.info, c.primaryLight, c.secondaryLight, c.warningLight]
    const phase = p < 0.12
            ? 'grouped by source rank'
            : p < 0.48
                ? 'route chunks into exchange grid'
                : p < 0.66
                    ? 'exchange grid preserves source → destination'
                    : p < 0.88
                        ? 'route chunks to destination ranks'
                        : p < 0.96
                            ? 'pack by source within each destination'
                            : 'grouped by destination rank'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, backgroundColor: c.bg, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', width, height, opacity: 0 }} />
            <div style={{ display: 'flex', position: 'absolute', top: 18, width: '100%', justifyContent: 'center', color: c.textPrimary, fontSize: 36, fontWeight: 800 }}>NCCL · AllToAll</div>
            <div style={{ display: 'flex', position: 'absolute', top: 62, width: '100%', justifyContent: 'center', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 14 }}>Every GPU sends one addressed chunk to every destination GPU</div>

            <div style={{ display: 'flex', position: 'absolute', left: 26, top: 100, width: 988, height: 374, overflow: 'hidden', borderRadius: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 18, alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 6, height: 28, borderRadius: 6, backgroundColor: color }} />
                    <span style={{ color: c.textPrimary, fontSize: 20, fontWeight: 800 }}>AllToAll</span>
                    <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>label = source→destination; color = destination</span>
                </div>
                <div style={{ display: 'flex', position: 'absolute', right: 22, top: 24, color: semanticColor, fontFamily: c.fontMono, fontSize: 12, fontWeight: 900 }}>ALL ↔ ALL</div>

                <RankLanes c={c} />
                <div style={{ display: 'flex', position: 'absolute', left: exchangeLeft, top: exchangeTop, width: 190, height: 164, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}` }}>
                    <span style={{ position: 'absolute', top: 8, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11, fontWeight: 900 }}>EXCHANGE GRID</span>
                </div>
                <div style={{ display: 'flex', position: 'absolute', inset: 0, opacity }}>
                    {[0, 1, 2, 3].flatMap((source) => [0, 1, 2, 3].map((destination) => {
                        const tokenColor = destinationColors[destination]
                        const sourcePosition = {
                            x: sourceX + destination * sourceGap,
                            y: rankY(source),
                        }
                        const exchangePosition = {
                            x: exchangeLeft + 28 + destination * exchangeColumnGap,
                            y: exchangeTop + 34 + source * exchangeRowGap,
                        }
                        const routePosition = {
                            x: outputX + source * sourceGap + (destination - 1.5) * 50,
                            y: exchangePosition.y,
                        }
                        const destinationPosition = {
                            x: routePosition.x,
                            y: rankY(destination),
                        }
                        const finalPosition = {
                            x: outputX + source * sourceGap,
                            y: destinationPosition.y,
                        }
                        const x = stageProgress < 1
                            ? sourcePosition.x + (exchangePosition.x - sourcePosition.x) * stageProgress
                            : laneProgress < 1
                                ? exchangePosition.x + (routePosition.x - exchangePosition.x) * laneProgress
                                : destinationProgress < 1
                                    ? routePosition.x
                                    : routePosition.x + (finalPosition.x - routePosition.x) * packProgress
                        const y = stageProgress < 1
                            ? sourcePosition.y + (exchangePosition.y - sourcePosition.y) * stageProgress
                            : laneProgress < 1
                                ? exchangePosition.y
                                : destinationProgress < 1
                                    ? routePosition.y + (destinationPosition.y - routePosition.y) * destinationProgress
                                    : destinationPosition.y
                        return (
                            <Token
                                key={`${source}-${destination}`}
                                x={x}
                                y={y}
                                label={`${source}→${destination}`}
                                color={tokenColor}
                                textColor={getReadableTextColor(tokenColor, c)}
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
            hold(800, 'source-grouped chunks'),
            tween<Partial<State>>({ progress: 1 }, { duration: 3000, easing: 'ease-in-out', label: 'all-to-all exchange' }),
            hold(1000, 'destination-grouped chunks'),
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
