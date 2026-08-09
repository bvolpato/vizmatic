import {
    defineAnimation,
    getThemeColors,
    getReadableToneColor,
    getReadableTextColor,
    getToneColor,
    hold,
    tween,
    type ThemeMode,
    type ToneName,
} from 'vizmatic'

export const width = 1040
export const height = 600

type State = {
    progress: number
}

export type NcclCollective = 'broadcast' | 'all-reduce' | 'all-gather' | 'reduce-scatter' | 'all-to-all'

type Operation = {
    name: string
    description: string
    semantic: string
    tone: ToneName
}

// Collective directions follow NVIDIA NCCL's operation definitions:
// https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html
const operations: Record<NcclCollective, Operation> = {
    broadcast: {
        name: 'Broadcast',
        description: 'Copy root rank buffer to every rank.',
        semantic: 'one → all',
        tone: 'cyan',
    },
    'all-reduce': {
        name: 'AllReduce',
        description: 'Reduce values, then return result to every rank.',
        semantic: 'all → all',
        tone: 'purple',
    },
    'all-gather': {
        name: 'AllGather',
        description: 'Gather every rank tensor on every rank.',
        semantic: 'all → all · concat',
        tone: 'blue',
    },
    'reduce-scatter': {
        name: 'ReduceScatter',
        description: 'Reduce by chunk, then scatter one result per rank.',
        semantic: 'all → one chunk',
        tone: 'green',
    },
    'all-to-all': {
        name: 'AlltoAll',
        description: 'Exchange rank-addressed chunks among every rank.',
        semantic: 'all ↔ all',
        tone: 'warm',
    },
}

const rankY = (rank: number) => 68 + rank * 43
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const absoluteFill = {
    display: 'flex',
    position: 'absolute' as const,
    left: 0,
    top: 0,
    width: '100%',
    height: '100%',
}

function phaseLabel(operation: NcclCollective, progress: number): string {
    const p = clamp(progress)
    if (operation === 'broadcast') return p < 0.12 ? 'root buffer' : p < 0.86 ? 'fan-out' : 'replicated'
    if (operation === 'all-reduce') return p < 0.48 ? 'reduce' : p < 0.88 ? 'broadcast sum' : 'complete'
    if (operation === 'all-gather') return p < 0.48 ? 'gather' : p < 0.88 ? 'replicate list' : 'complete'
    if (operation === 'reduce-scatter') return p < 0.48 ? 'reduce by index' : p < 0.88 ? 'scatter outputs' : 'complete'
    return p < 0.12 ? 'rank-addressed chunks' : p < 0.88 ? 'exchange' : 'rank-ordered output'
}

interface DataTokenProps {
    x: number
    y: number
    label: string
    color: string
    textColor: string
    opacity?: number
    width?: number
}

function DataToken({
    x,
    y,
    label,
    color,
    textColor,
    opacity = 1,
    width: tokenWidth = 34,
}: DataTokenProps) {
    const tokenHeight = 24
    return (
        <div style={{
            display: 'flex',
            position: 'absolute',
            left: x - tokenWidth / 2,
            top: y - tokenHeight / 2,
            width: tokenWidth,
            height: tokenHeight,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 7,
            backgroundColor: color,
            color: textColor,
            fontSize: 11,
            fontWeight: 800,
            fontFamily: 'JetBrains Mono',
            opacity,
        }}>
            {label}
        </div>
    )
}

function RankLanes({ c }: { c: ReturnType<typeof getThemeColors> }) {
    return (
        <div style={absoluteFill}>
            <div style={{ display: 'flex', position: 'absolute', left: 24, top: 14, color: c.textMuted, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono, letterSpacing: 1.2 }}>RANKS</div>
            <div style={{ display: 'flex', position: 'absolute', left: 222, top: 14, color: c.textMuted, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono, letterSpacing: 1.2 }}>COLLECTIVE PATH</div>
            {[0, 1, 2, 3].map((rank) => {
                const y = rankY(rank)
                return (
                    <div key={`rank-${rank}`} style={absoluteFill}>
                        <div style={{ display: 'flex', position: 'absolute', left: 22, top: y - 15, width: 128, height: 30, alignItems: 'center', gap: 9, paddingLeft: 12, borderRadius: 9, backgroundColor: c.bgCardAlt, border: `1px solid ${c.borderSubtle}` }}>
                            <span style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: rank === 0 ? c.info : c.neutralLight }} />
                            <span style={{ color: c.textPrimary, fontSize: 12, fontWeight: 700, fontFamily: c.fontMono }}>rank {rank}</span>
                        </div>
                        <div style={{ display: 'flex', position: 'absolute', left: 178, top: y - 1, width: 757, height: 2, backgroundColor: c.borderSubtle }} />
                        <span style={{ position: 'absolute', left: 175, top: y - 3, width: 6, height: 6, borderRadius: 6, backgroundColor: c.borderLight }} />
                        <span style={{ position: 'absolute', left: 932, top: y - 3, width: 6, height: 6, borderRadius: 6, backgroundColor: c.borderLight }} />
                    </div>
                )
            })}
        </div>
    )
}

function BroadcastView({ c, progress, color }: { c: ReturnType<typeof getThemeColors>; progress: number; color: string }) {
    const p = clamp(progress)
    const sourceX = 248
    const targetX = 858
    const tokenText = getReadableTextColor(color, c)
    return (
        <div style={absoluteFill}>
            {[1, 2, 3].map((rank) => {
                const y = rankY(rank)
                return (
                    <div key={`broadcast-path-${rank}`} style={absoluteFill}>
                        {DataToken({ x: targetX, y, label: 'X', color, textColor: tokenText, opacity: 0.15 + p * 0.2 })}
                        {DataToken({
                            x: sourceX + (targetX - sourceX) * p,
                            y: rankY(0) + (y - rankY(0)) * p,
                            label: 'X',
                            color,
                            textColor: tokenText,
                            opacity: 0.98,
                        })}
                    </div>
                )
            })}
            {DataToken({ x: sourceX, y: rankY(0), label: 'X', color, textColor: tokenText })}
            <div style={{ display: 'flex', position: 'absolute', left: sourceX - 18, top: rankY(0) - 34, color: c.textPrimary, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono }}>ROOT</div>
            <div style={{ display: 'flex', position: 'absolute', left: targetX + 26, top: rankY(3) - 8, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono }}>same buffer</div>
        </div>
    )
}

function AllReduceView({ c, progress, color }: { c: ReturnType<typeof getThemeColors>; progress: number; color: string }) {
    const p = clamp(progress)
    const centerX = 550
    const centerY = 143
    const outputX = 858
    const reduceP = Math.min(1, p * 2)
    const scatterP = clamp((p - 0.42) / 0.58)
    const tokenText = getReadableTextColor(color, c)
    return (
        <div style={absoluteFill}>
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 26, top: centerY - 26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 52, backgroundColor: c.bgCardAlt, border: `2px solid ${color}`, color, fontSize: 20, fontWeight: 800, fontFamily: c.fontMono }}>Σ</div>
            {[0, 1, 2, 3].map((rank) => {
                const y = rankY(rank)
                const sourceX = 248 + (centerX - 248) * reduceP
                return (
                    <div key={`allreduce-${rank}`} style={absoluteFill}>
                        {p < 0.75 && DataToken({ x: sourceX, y: y + (centerY - y) * reduceP, label: String(rank + 1), color, textColor: tokenText, opacity: 1 - Math.min(1, p * 1.35) })}
                        {DataToken({ x: centerX + (outputX - centerX) * scatterP, y: centerY + (y - centerY) * scatterP, label: '10', color, textColor: tokenText, opacity: scatterP })}
                    </div>
                )
            })}
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 42, top: centerY + 31, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono }}>1 + 2 + 3 + 4</div>
        </div>
    )
}

function AllGatherView({ c, progress, color }: { c: ReturnType<typeof getThemeColors>; progress: number; color: string }) {
    const p = clamp(progress)
    const gatherP = Math.min(1, p * 2)
    const replicateP = clamp((p - 0.43) / 0.57)
    const centerX = 548
    const centerY = 143
    const sourceX = 248
    const outputX = 736
    const labels = ['A', 'B', 'C', 'D']
    const tokenText = getReadableTextColor(color, c)

    return (
        <div style={absoluteFill}>
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 52, top: centerY - 45, width: 104, height: 90, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, opacity: 0.8 }} />
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 26, top: centerY - 64, color: c.textMuted, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono }}>CONCAT</div>
            {[0, 1, 2, 3].map((rank) => {
                const y = rankY(rank)
                const centerSlotX = centerX - 30 + rank * 20
                return (
                    <div key={`allgather-${rank}`} style={absoluteFill}>
                        {DataToken({
                            x: sourceX + (centerSlotX - sourceX) * gatherP,
                            y: y + (centerY + (rank - 1.5) * 2 - y) * gatherP,
                            label: labels[rank],
                            color,
                            textColor: tokenText,
                            opacity: 1 - Math.min(1, p * 1.4),
                            width: 28,
                        })}
                    </div>
                )
            })}
            {[0, 1, 2, 3].flatMap((target) => labels.map((label, source) => {
                const centerSlotX = centerX - 30 + source * 20
                return DataToken({
                    x: centerSlotX + (outputX + source * 34 - centerSlotX) * replicateP,
                    y: centerY + (rankY(target) - centerY) * replicateP,
                    label,
                    color,
                    textColor: tokenText,
                    opacity: replicateP,
                    width: 28,
                })
            }))}
            <div style={{ display: 'flex', position: 'absolute', left: 884, top: rankY(3) - 14, width: 102, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: c.bgCard, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono, opacity: 0.94 }}>A · B · C · D</div>
        </div>
    )
}

function ReduceScatterView({ c, progress, color }: { c: ReturnType<typeof getThemeColors>; progress: number; color: string }) {
    const p = clamp(progress)
    const reduceP = Math.min(1, p * 2)
    const scatterP = clamp((p - 0.42) / 0.58)
    const centerX = 548
    const centerY = 143
    const outputX = 858
    const chunkColors = [c.info, c.primaryLight, c.secondaryLight, c.positiveLight]
    return (
        <div style={absoluteFill}>
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 56, top: centerY - 47, width: 112, height: 94, borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, opacity: 0.7 }} />
            <div style={{ display: 'flex', position: 'absolute', left: centerX - 48, top: centerY - 65, color: c.textMuted, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono }}>REDUCE CHUNKS</div>
            {[0, 1, 2, 3].map((destination) => {
                const y = rankY(destination)
                const centerSlotX = centerX - 30 + destination * 20
                return (
                    <div key={`reducescatter-destination-${destination}`} style={absoluteFill}>
                        <div style={{ display: 'flex', position: 'absolute', left: centerSlotX - 13, top: centerY - 13, width: 26, height: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: c.bgCardAlt, border: `2px solid ${chunkColors[destination]}`, color: c.textPrimary, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono }}>R{destination}</div>
                        {DataToken({
                            x: centerSlotX + (outputX - centerSlotX) * scatterP,
                            y: centerY + (y - centerY) * scatterP,
                            label: `R${destination}`,
                            color: chunkColors[destination],
                            textColor: getReadableTextColor(chunkColors[destination], c),
                            opacity: scatterP,
                            width: 38,
                        })}
                    </div>
                )
            })}
            {p < 0.75 && [0, 1, 2, 3].flatMap((source) => [0, 1, 2, 3].map((destination) => {
                const sourceX = 236 + destination * 26
                const sourceY = rankY(source)
                const centerSlotX = centerX - 30 + destination * 20
                return (
                    <div key={`reducescatter-${source}-${destination}`} style={absoluteFill}>
                        {DataToken({
                            x: sourceX + (centerSlotX - sourceX) * reduceP,
                            y: sourceY + (centerY - sourceY) * reduceP,
                            label: `${source},${destination}`,
                            color: chunkColors[destination],
                            textColor: getReadableTextColor(chunkColors[destination], c),
                            opacity: 1 - Math.min(1, p * 1.4),
                            width: 24,
                        })}
                    </div>
                )
            }))}
            <div style={{ display: 'flex', position: 'absolute', left: 884, top: rankY(3) - 14, width: 102, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: c.bgCard, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono, opacity: 0.94 }}>one chunk / rank</div>
        </div>
    )
}

function AllToAllView({ c, progress, color }: { c: ReturnType<typeof getThemeColors>; progress: number; color: string }) {
    const p = clamp(progress)
    const destinationColors = [c.info, c.primaryLight, c.secondaryLight, c.warningLight]
    const sourceStartX = 240
    const outputStartX = 730
    const tokenGap = 44

    return (
        <div style={absoluteFill}>
            <div style={{ display: 'flex', position: 'absolute', left: 492, top: 96, width: 112, height: 94, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: c.bgCardAlt, border: `2px dashed ${color}`, color: c.textMuted, fontSize: 11, fontWeight: 800, fontFamily: c.fontMono }}>EXCHANGE</div>
            {[0, 1, 2, 3].flatMap((source) => [0, 1, 2, 3].map((destination) => {
                const tokenColor = destinationColors[destination]
                const startX = sourceStartX + destination * tokenGap
                const endX = outputStartX + source * tokenGap
                const startY = rankY(source)
                const endY = rankY(destination)
                return (
                    <div key={`alltoall-${source}-${destination}`} style={absoluteFill}>
                        {DataToken({
                            x: startX + (endX - startX) * p,
                            y: startY + (endY - startY) * p,
                            label: `${source}→${destination}`,
                            color: tokenColor,
                            textColor: getReadableTextColor(tokenColor, c),
                            width: 40,
                        })}
                    </div>
                )
            }))}
            <div style={{ display: 'flex', position: 'absolute', left: 224, top: 240, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono }}>color = destination</div>
            <div style={{ display: 'flex', position: 'absolute', left: 882, top: 240, color: c.textMuted, fontSize: 11, fontFamily: c.fontMono }}>source order</div>
        </div>
    )
}

function renderFrame(theme: ThemeMode, collective: NcclCollective, state: Readonly<State>) {
    const c = getThemeColors(theme)
    const operation = operations[collective]
    const color = getToneColor(operation.tone, c)
    const semanticColor = getReadableToneColor(operation.tone, c, c.bgCardAlt)
    const p = clamp(state.progress)

    return (
        <div style={{
            display: 'flex',
            position: 'relative',
            flexGrow: 0,
            flexShrink: 0,
            width,
            minWidth: width,
            maxWidth: width,
            height,
            minHeight: height,
            maxHeight: height,
            backgroundColor: c.bg,
            fontFamily: c.fontSans,
        }}>
                <div style={{ display: 'flex', flexGrow: 0, flexShrink: 0, width, height, opacity: 0 }} />
                <div style={{ display: 'flex', position: 'absolute', left: 0, top: 20, width: '100%', justifyContent: 'center', color: c.textPrimary, fontFamily: c.fontSans, fontSize: 40, fontWeight: 700 }}>NCCL · {operation.name}</div>
                <div style={{ display: 'flex', position: 'absolute', left: 0, top: 72, width: '100%', justifyContent: 'center', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 16 }}>Rank-local chunks, collective paths, and final ownership across four GPUs</div>

                <div style={{ display: 'flex', position: 'absolute', left: 26, top: 110, width: 988, height: 70, alignItems: 'stretch', justifyContent: 'space-between', gap: 14 }}>
                    <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: 12, padding: '12px 16px', border: `1px solid ${c.borderSubtle}`, borderRadius: 12, backgroundColor: c.bgCard }}>
                        <div style={{ display: 'flex', width: 6, height: 42, borderRadius: 6, backgroundColor: color }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div style={{ display: 'flex', color: c.textPrimary, fontFamily: c.fontSans, fontSize: 22, fontWeight: 800 }}>{operation.name}</div>
                            <div style={{ display: 'flex', color: c.textSecondary, fontFamily: c.fontMono, fontSize: 11 }}>{operation.description}</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', width: 236, flexDirection: 'column', justifyContent: 'center', gap: 7, padding: '11px 15px', border: `1px solid ${c.borderSubtle}`, borderRadius: 12, backgroundColor: c.bgCardAlt }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: c.textMuted, fontFamily: c.fontMono, fontSize: 11, fontWeight: 800 }}>COLLECTIVE</span>
                            <span style={{ color: semanticColor, fontFamily: c.fontMono, fontSize: 11, fontWeight: 800 }}>{operation.semantic}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ display: 'flex', flex: 1, height: 5, borderRadius: 8, backgroundColor: c.borderSubtle }}>
                                <div style={{ display: 'flex', width: `${Math.round(p * 100)}%`, height: 5, borderRadius: 8, backgroundColor: color }} />
                            </div>
                            <span style={{ color: c.textSecondary, fontFamily: c.fontMono, fontSize: 11 }}>{phaseLabel(collective, p)}</span>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', position: 'absolute', left: 26, top: 194, width: 988, height: 286, overflow: 'hidden', borderRadius: 14, backgroundColor: c.bgCard, border: `1px solid ${c.borderSubtle}` }}>
                        {RankLanes({ c })}
                        {collective === 'broadcast' && BroadcastView({ c, progress: p, color })}
                        {collective === 'all-reduce' && AllReduceView({ c, progress: p, color })}
                        {collective === 'all-gather' && AllGatherView({ c, progress: p, color })}
                        {collective === 'reduce-scatter' && ReduceScatterView({ c, progress: p, color })}
                        {collective === 'all-to-all' && AllToAllView({ c, progress: p, color })}
                </div>

        </div>
    )
}

export function createNcclAnimation(theme: ThemeMode, collective: NcclCollective) {
    const operation = operations[collective]
    return defineAnimation<State>({
        initial: { progress: 0 },
        timeline: [
            hold(700, `${operation.name} · input`),
            tween<Partial<State>>({ progress: 1 }, { duration: 2200, easing: 'ease-in-out', label: `${operation.name} · transfer` }),
            hold(700, `${operation.name} · output`),
        ],
        fps: 15,
        render: (state) => renderFrame(theme, collective, state),
    })
}

export function createNcclFrame(theme: ThemeMode, collective: NcclCollective, progress = 1) {
    return renderFrame(theme, collective, { progress })
}
