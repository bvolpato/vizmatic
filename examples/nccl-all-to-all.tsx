import {
    defineAnimation,
    getReadableToneColor,
    getReadableTextColor,
    getThemeColors,
    getToneColor,
    hold,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 500

type State = { progress: number }
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

function Frame({ theme, progress }: { theme: ThemeMode; progress: number }) {
    const c = getThemeColors(theme)
    const color = getToneColor('warm', c)
    const semanticColor = getReadableToneColor('warm', c, c.bgCard)
    const p = clamp(progress)
    const sourceX = 210
    const outputX = 722
    const gap = 44
    const destinationColors = [c.info, c.primaryLight, c.secondaryLight, c.warningLight]
    const phase = p < 0.08 ? 'grouped by source rank' : p < 0.92 ? 'exchange rank-addressed chunks' : 'grouped by destination rank'

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
                <div style={{ display: 'flex', position: 'absolute', left: 488, top: 128, width: 116, height: 106, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11, fontWeight: 900 }}>EXCHANGE</div>
                {[0, 1, 2, 3].flatMap((source) => [0, 1, 2, 3].map((destination) => {
                    const tokenColor = destinationColors[destination]
                    const startX = sourceX + destination * gap
                    const endX = outputX + source * gap
                    return (
                        <Token
                            key={`${source}-${destination}`}
                            x={startX + (endX - startX) * p}
                            y={rankY(source) + (rankY(destination) - rankY(source)) * p}
                            label={`${source}→${destination}`}
                            color={tokenColor}
                            textColor={getReadableTextColor(tokenColor, c)}
                        />
                    )
                }))}

                <div style={{ display: 'flex', position: 'absolute', left: 22, top: 326, color: c.textMuted, fontFamily: c.fontMono, fontSize: 11 }}>{phase}</div>
                <div style={{ display: 'flex', position: 'absolute', left: 170, top: 332, width: 780, height: 6, borderRadius: 6, backgroundColor: c.borderSubtle }}>
                    <div style={{ display: 'flex', width: `${Math.round(p * 100)}%`, height: 6, borderRadius: 6, backgroundColor: color }} />
                </div>
            </div>
        </div>
    )
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation<State>({
        initial: { progress: 0 },
        timeline: [
            hold(800, 'source-grouped chunks'),
            tween<Partial<State>>({ progress: 1 }, { duration: 3000, easing: 'ease-in-out', label: 'all-to-all exchange' }),
            hold(1000, 'destination-grouped chunks'),
        ],
        fps: 20,
        render: (state) => <Frame theme={theme} progress={state.progress} />,
    })
}

export function create(theme: ThemeMode = 'dark') {
    return <Frame theme={theme} progress={1} />
}

export default create('dark')
