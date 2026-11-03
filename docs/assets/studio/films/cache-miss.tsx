/**
 * A cache stampede, simulated. One hot key expires at 12,000 requests per second.
 * Every request runs through a small queueing model in this file, so the pool
 * depth, queue, and p99 lines on screen are computed, not drawn by hand. The hop
 * times are illustrative figures for a service in one availability zone.
 */
import {
    Node, draw, dynamic, fade, fadeIn, film, line, linear, parseSvgPath, pointAt, polyPath, rect, smoother, text, write, dot,
    type ColorInput, type Path, type Vec,
} from 'vizmatic/stage'

// ── The model ───────────────────────────────────────────────────────────────

const RATE = 12 // requests per millisecond
const POOL = 40
const QUERY_MS = 40
const SPANS = [
    { name: 'accept', ms: 0.2, miss: true, hit: true },
    { name: 'route to service', ms: 0.15, miss: true, hit: true },
    { name: 'handler', ms: 0.4, miss: true, hit: true },
    { name: 'redis GET', ms: 0.35, miss: true, hit: true },
    { name: 'postgres query', ms: QUERY_MS, miss: true, hit: false },
    { name: 'redis SET', ms: 0.3, miss: true, hit: false },
    { name: 'serialize', ms: 0.9, miss: true, hit: true },
    { name: 'respond', ms: 0.1, miss: true, hit: true },
] as const
const HIT_MS = SPANS.filter((span) => span.hit).reduce((sum, span) => sum + span.ms, 0)
const MISS_MS = SPANS.reduce((sum, span) => sum + span.ms, 0)
const SIM_START = -40, SIM_END = 640, SIM_LEN = SIM_END - SIM_START

interface Run {
    inUse: Float32Array
    queue: Float32Array
    p99: Float32Array
    hitRate: Float32Array
    queries: number
    peak: number
}

function simulate(coalesce: boolean): Run {
    const inUseDelta = new Float32Array(SIM_LEN + 1)
    const queueDelta = new Float32Array(SIM_LEN + 1)
    const finished: { at: number; latency: number; miss: boolean }[] = []
    const free = new Array<number>(POOL).fill(SIM_START)
    let filled = Infinity
    let queries = 0
    const index = (t: number) => Math.max(0, Math.min(SIM_LEN, Math.floor(t - SIM_START)))
    for (let n = 0; n < SIM_LEN * RATE; n++) {
        const arrive = SIM_START + n / RATE
        if (arrive < 0 || arrive >= filled) {
            finished.push({ at: arrive + HIT_MS, latency: HIT_MS, miss: false })
            continue
        }
        if (coalesce && queries > 0) {
            // A follower waits for the one query already running, then reads the fresh value.
            finished.push({ at: filled + HIT_MS, latency: filled + HIT_MS - arrive, miss: true })
            continue
        }
        let slot = 0
        for (let i = 1; i < POOL; i++) if (free[i]! < free[slot]!) slot = i
        const start = Math.max(arrive, free[slot]!)
        const end = start + QUERY_MS
        free[slot] = end
        queries++
        if (start > arrive) {
            queueDelta[index(arrive)]! += 1
            queueDelta[index(start)]! -= 1
        }
        inUseDelta[index(start)]! += 1
        inUseDelta[index(end)]! -= 1
        if (end + 0.3 < filled) filled = end + 0.3
        finished.push({ at: end + MISS_MS - QUERY_MS, latency: end + MISS_MS - QUERY_MS - arrive, miss: true })
    }
    const inUse = new Float32Array(SIM_LEN), queue = new Float32Array(SIM_LEN)
    let use = 0, waiting = 0
    for (let i = 0; i < SIM_LEN; i++) {
        use += inUseDelta[i]!
        waiting += queueDelta[i]!
        inUse[i] = use
        queue[i] = waiting
    }
    finished.sort((a, b) => a.at - b.at)
    const p99 = new Float32Array(SIM_LEN), hitRate = new Float32Array(SIM_LEN)
    const windowMs = 50
    let peak = 0
    for (let i = 0; i < SIM_LEN; i++) {
        const t = SIM_START + i
        const recent: number[] = []
        for (let lo = lowerBound(finished, t - windowMs); lo < finished.length && finished[lo]!.at <= t; lo++) recent.push(finished[lo]!.latency)
        recent.sort((a, b) => a - b)
        const value = recent.length ? recent[Math.min(recent.length - 1, Math.floor(recent.length * 0.99))]! : HIT_MS
        p99[i] = value
        // Hit rate is per arrival: only requests that arrive before the refill can miss.
        hitRate[i] = t >= 0 && t < filled ? 0 : 1
        peak = Math.max(peak, value)
    }
    return { inUse, queue, p99, hitRate, queries, peak }
}

function lowerBound(items: { at: number }[], t: number): number {
    let lo = 0, hi = items.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (items[mid]!.at < t) lo = mid + 1
        else hi = mid
    }
    return lo
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

type Align = 'left' | 'right' | 'center'
interface LabelStyle { size?: number; font?: 'sans' | 'mono' | 'text-serif'; color?: ColorInput; weight?: 400 | 600 | 700; align?: Align; caps?: boolean }

function label(content: string, x: number, y: number, style: LabelStyle = {}): Node {
    const node = text(content, {
        size: style.size ?? 18, font: style.font ?? 'sans', color: style.color ?? 'ink', weight: style.weight ?? 400,
        uppercase: style.caps, tracking: style.caps ? 0.08 : 0,
    })
    const width = node.bounds().width
    const align = style.align ?? 'left'
    return node.at(align === 'left' ? x + width / 2 : align === 'right' ? x - width / 2 : x, y)
}

interface BoxSpec { x: number; y: number; w: number; h: number; title: string; kind: string }

const LB: BoxSpec = { x: -880, y: -398, w: 300, h: 214, title: 'Load balancer', kind: 'L7, 4 nodes' }
const SERVICE: BoxSpec = { x: -440, y: -398, w: 320, h: 214, title: 'Catalog service', kind: '24 pods, one pool per fleet' }
const REDIS: BoxSpec = { x: 60, y: -484, w: 300, h: 158, title: 'Redis', kind: 'primary, in-memory' }
const POSTGRES: BoxSpec = { x: 60, y: -296, w: 300, h: 214, title: 'Postgres', kind: 'primary, 40 connections' }
const KEY: BoxSpec = { x: 500, y: -398, w: 380, h: 214, title: 'Hot key', kind: 'product:4821, read by every page' }

function box(spec: BoxSpec, accent: ColorInput = 'faint'): Node {
    const group = new Node()
    group.add(rect(spec.w, spec.h, { fill: 'surface', stroke: accent, width: 1.4, radius: 8 }).at(spec.x + spec.w / 2, spec.y + spec.h / 2))
    group.add(label(spec.title, spec.x + 18, spec.y + 28, { size: 25, weight: 600 }))
    group.add(label(spec.kind, spec.x + 18, spec.y + 56, { size: 16, color: 'dim', font: 'mono' }))
    return group
}

function rowsFor(spec: BoxSpec, rows: readonly (readonly [string, string, ColorInput?])[]): Node[] {
    return rows.flatMap(([name, value, color], i) => {
        const y = spec.y + 92 + i * 30
        return [
            label(name, spec.x + 18, y, { size: 18, color: 'dim' }),
            label(value, spec.x + spec.w - 18, y, { size: 20, font: 'mono', color: color ?? 'ink', align: 'right' }),
        ]
    })
}

const elbow = (a: Vec, b: Vec, r = 14): Path => {
    const mid = (a[0] + b[0]) / 2
    const dy = Math.sign(b[1] - a[1])
    if (dy === 0) return parseSvgPath(`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`)
    return parseSvgPath(`M${a[0]} ${a[1]}L${mid - r} ${a[1]}Q${mid} ${a[1]} ${mid} ${a[1] + dy * r}L${mid} ${b[1] - dy * r}Q${mid} ${b[1]} ${mid + r} ${b[1]}L${b[0]} ${b[1]}`)
}

export default film({
    title: 'One key expires',
    description: 'A live service diagram: a hot cache key expires at 12,000 requests per second and a stampede hits the database.',
    fps: 60,
    bleed: true,
    bloom: 0.08,
}, (s) => {
    const stampede = simulate(false)
    const coalesced = simulate(true)
    const missCount = stampede.queries

    const simClock = s.value(SIM_START)
    const useSecond = s.value(0)
    const packet = s.value(0)
    const packetAlpha = s.value(0)
    const isMiss = s.value(0)
    const axisMax = s.value(2.5)

    const at = (values: Float32Array) => values[Math.max(0, Math.min(SIM_LEN - 1, Math.floor(simClock.value - SIM_START)))]!
    const current = () => (useSecond.value >= 0.5 ? coalesced : stampede)

    // ── The wires ───────────────────────────────────────────────────────────

    const midRight = (spec: BoxSpec): Vec => [spec.x + spec.w, spec.y + spec.h / 2]
    const midLeft = (spec: BoxSpec): Vec => [spec.x, spec.y + spec.h / 2]
    const wireIn: Path = parseSvgPath(`M-960 ${LB.y + LB.h / 2}L${LB.x} ${LB.y + LB.h / 2}`)
    const wireLb = elbow(midRight(LB), midLeft(SERVICE))
    const wireRedis = elbow([SERVICE.x + SERVICE.w, SERVICE.y + 76], midLeft(REDIS))
    const wirePg = elbow([SERVICE.x + SERVICE.w, SERVICE.y + 138], midLeft(POSTGRES))

    const flows = dynamic((t) => {
        const run = current()
        const hits = at(run.hitRate)
        const use = at(run.inUse) / POOL
        const waiting = at(run.queue)
        const drawn = (path: Path, rate: number, color: ColorInput, width: number): Node[] => [
            new Node(path).stroke('faint', 1.4),
            new Node(path).stroke(color, 1.6 + width * rate, rate > 0.01 ? 0.92 : 0).dash([9, 15], -t * 96).glow(rate > 0.2 ? 4 : 0, color as string),
        ]
        const heat = waiting > 0 ? 'red' : 'orange'
        return [
            ...drawn(wireIn, 1, 'teal', 2.4),
            ...drawn(wireLb, 1, 'teal', 2.4),
            ...drawn(wireRedis, Math.max(0.08, hits), 'teal', 2.4),
            ...drawn(wirePg, use, heat, 5),
        ]
    })

    const wireKey = line([REDIS.x + REDIS.w, midLeft(REDIS)[1]], [KEY.x + 60, KEY.y], { stroke: 'faint', width: 1.3, dash: [3, 7] })
    const wireLabels = new Node().add(
        label('0.15 ms', (midRight(LB)[0] + midLeft(SERVICE)[0]) / 2, midLeft(SERVICE)[1] - 16, { size: 16, font: 'mono', color: 'dim', align: 'center' }),
        label('12,000 req/s', -874, LB.y - 22, { size: 18, font: 'mono', color: 'dim' }),
    )

    // ── The boxes, with live metrics ────────────────────────────────────────

    const lbBox = box(LB), serviceBox = box(SERVICE), redisBox = box(REDIS), keyBox = box(KEY)
    const pgFrame = dynamic(() => {
        const waiting = at(current().queue)
        return box(POSTGRES, waiting > 0 ? 'red' : 'faint')
    })
    const metrics = dynamic(() => {
        const run = current()
        const p99 = at(run.p99)
        const hits = at(run.hitRate)
        const use = at(run.inUse)
        const waiting = at(run.queue)
        const now = simClock.value
        const missing = hits < 0.999
        const items: Node[] = [
            ...rowsFor(LB, [['requests', '12,000/s'], ['p99, last 50 ms', `${p99.toFixed(1).padStart(6, ' ')} ms`, p99 > 100 ? 'red' : p99 > 20 ? 'orange' : 'ink'], ['in flight', String(Math.round(RATE * HIT_MS + use + waiting)).padStart(4, ' ')], ['errors', '0.00%']]),
            ...rowsFor(SERVICE, [['workers busy', `${Math.min(960, Math.round(26 + (use + waiting) * 2))} of 960`], ['cache hit rate', `${(hits * 100).toFixed(1).padStart(5, ' ')}%`, hits < 0.99 ? 'orange' : 'teal'], ['waiting on cache', String(Math.round(useSecond.value >= 0.5 && missing ? RATE * now : 0))], ['handler, p50', '0.40 ms']]),
            ...rowsFor(REDIS, [['GET, p50', '0.35 ms'], ['hit rate', `${(hits * 100).toFixed(1).padStart(5, ' ')}%`, hits < 0.99 ? 'orange' : 'teal']]),
            ...rowsFor(POSTGRES, [['connections', `${String(Math.round(use)).padStart(2, ' ')} of ${POOL}`, use >= POOL ? 'red' : 'ink'], ['queued', String(Math.round(waiting)).padStart(3, ' '), waiting > 0 ? 'red' : 'ink'], ['query time', `${QUERY_MS}.0 ms`]]),
        ]
        // Pool meter along the bottom edge of the database box.
        const meterY = POSTGRES.y + POSTGRES.h - 18
        const meterW = POSTGRES.w - 36
        items.push(
            rect(meterW, 8, { fill: 'grid', stroke: null, radius: 2 }).at(POSTGRES.x + 18 + meterW / 2, meterY),
        )
        const share = Math.min(1, use / POOL)
        if (share > 0) items.push(rect(meterW * share, 8, { fill: waiting > 0 ? 'red' : 'orange', stroke: null, radius: 2 }).at(POSTGRES.x + 18 + (meterW * share) / 2, meterY))
        // The key's own state.
        const ttl = now < 0 ? -now : 0
        const state = now < 0 ? 'CACHED' : missing ? 'EXPIRED' : 'REFILLED'
        const stateColor = missing ? 'red' : 'teal'
        items.push(
            ...rowsFor(KEY, [
                ['state', state, stateColor],
                ['TTL left', now < 0 ? `${ttl.toFixed(0).padStart(3, ' ')} ms` : '  0 ms'],
                ['single flight', useSecond.value >= 0.5 ? 'ON' : 'OFF', useSecond.value >= 0.5 ? 'teal' : 'dim'],
                ['queries for this key', String(queriesSoFar()).padStart(4, ' '), useSecond.value >= 0.5 ? 'teal' : queriesSoFar() > 1 ? 'red' : 'ink'],
            ]),
        )
        return items
    })
    const queriesSoFar = () => {
        const run = current()
        if (simClock.value < 0) return 0
        if (run === coalesced) return 1
        return Math.min(run.queries, Math.round(simClock.value * RATE) + 1)
    }

    // ── A single request, traced ────────────────────────────────────────────

    const spots: Vec[] = [
        [LB.x + LB.w * 0.5, midLeft(LB)[1]],
        midRight(LB), midLeft(SERVICE),
        [SERVICE.x + SERVICE.w / 2, midLeft(SERVICE)[1]],
    ]
    const pgPoint: Vec = midLeft(POSTGRES)

    /** Where the traced request is at a request-local time, for hit or miss. */
    const tracePosition = (m: number, miss: boolean): Vec => {
        const steps: { end: number; along?: Path; reverse?: boolean; holdAt?: Vec }[] = []
        let clock = 0
        const push = (ms: number, step: { along?: Path; reverse?: boolean; holdAt?: Vec }) => {
            clock += ms
            steps.push({ end: clock, ...step })
        }
        push(0.2, { holdAt: spots[0] })
        push(0.15, { along: wireLb })
        push(0.4, { holdAt: spots[3] })
        push(0.175, { along: wireRedis })
        push(0.175, { along: wireRedis, reverse: true })
        if (miss) {
            push(QUERY_MS * 0.02, { along: wirePg })
            push(QUERY_MS * 0.96, { holdAt: pgPoint })
            push(QUERY_MS * 0.02, { along: wirePg, reverse: true })
            push(0.15, { along: wireRedis })
            push(0.15, { along: wireRedis, reverse: true })
        }
        push(0.9, { holdAt: spots[3] })
        push(0.1, { along: wireLb, reverse: true })
        let start = 0
        for (const step of steps) {
            if (m <= step.end) {
                const f = step.end > start ? (m - start) / (step.end - start) : 1
                if (step.holdAt) return step.holdAt
                const u = step.reverse ? 1 - f : f
                return pointAt(step.along!, u)
            }
            start = step.end
        }
        return midRight(LB)
    }
    const tracer = dynamic(() => {
        const a = packetAlpha.value
        if (a <= 0) return null
        const miss = isMiss.value >= 0.5
        const m = packet.value
        return dot(9, miss ? 'orange' : 'yellow').at(tracePosition(m, miss)).glow(12).opacity(a)
    })

    // ── The waterfall ───────────────────────────────────────────────────────

    const WF = { x: -880, y: 42, w: 780, rowH: 40, labelW: 190 }
    const waterfall = dynamic(() => {
        const items: Node[] = []
        const miss = isMiss.value >= 0.5
        const m = packet.value
        const scale = (WF.w - WF.labelW - 76) / axisMax.value
        const x0 = WF.x + WF.labelW
        let clock = 0
        const list = SPANS.filter((span) => miss || span.hit)
        list.forEach((span, i) => {
            const y = WF.y + 46 + i * WF.rowH
            const shown = Math.max(0, Math.min(span.ms, m - clock))
            items.push(label(span.name, WF.x, y, { size: 19, color: shown > 0 ? 'ink' : 'dim' }))
            items.push(rect(WF.w - WF.labelW, 1, { fill: 'grid', stroke: null }).at(x0 + (WF.w - WF.labelW) / 2, y + WF.rowH / 2))
            if (shown > 0) {
                const width = Math.max(2, shown * scale)
                const color = span.name === 'postgres query' ? 'orange' : span.name.startsWith('redis') ? 'teal' : 'blue'
                items.push(rect(width, 20, { fill: color, stroke: null, radius: 2 }).at(x0 + clock * scale + width / 2, y))
                items.push(label(`${shown.toFixed(2)}`, x0 + clock * scale + width + 8, y, { size: 16, font: 'mono', color: 'dim' }))
            }
            clock += span.ms
        })
        return items
    })
    const waterfallHead = dynamic(() => {
        const miss = isMiss.value >= 0.5
        const total = miss ? MISS_MS : HIT_MS
        const m = Math.min(total, packet.value)
        return [
            label(miss ? 'One request, cache miss' : 'One request, cache hit', WF.x, WF.y, { size: 19, color: 'dim', caps: true, weight: 600 }),
            label(`${m.toFixed(2).padStart(6, ' ')} ms`, WF.x + WF.w, WF.y - 6, { size: 34, font: 'mono', color: miss ? 'orange' : 'yellow', align: 'right' }),
        ]
    })

    // ── The latency chart ───────────────────────────────────────────────────

    const CH = { x: 60, y: 86, w: 820, h: 360, max: 600 }
    const chartX = (t: number) => CH.x + ((t - SIM_START) / SIM_LEN) * CH.w
    const chartY = (v: number) => CH.y + CH.h - (Math.min(CH.max, v) / CH.max) * CH.h
    const chartFrame = new Node()
    for (const v of [0, 100, 200, 300, 400, 500, 600]) {
        chartFrame.add(line([CH.x, chartY(v)], [CH.x + CH.w, chartY(v)], { stroke: v === 0 ? 'faint' : 'grid', width: 1.2 }))
        chartFrame.add(label(String(v), CH.x + CH.w + 8, chartY(v), { size: 16, font: 'mono', color: 'dim' }))
    }
    for (const t of [0, 200, 400, 600]) {
        chartFrame.add(line([chartX(t), CH.y + CH.h], [chartX(t), CH.y + CH.h + 6], { stroke: 'faint', width: 1.2 }))
        chartFrame.add(label(`${t} ms`, chartX(t), CH.y + CH.h + 24, { size: 16, font: 'mono', color: 'dim', align: 'center' }))
    }
    chartFrame.add(label('p99 latency, ms, measured at the load balancer', CH.x, CH.y - 44, { size: 19, color: 'dim', caps: true, weight: 600 }))
    chartFrame.add(line([chartX(0), CH.y], [chartX(0), CH.y + CH.h], { stroke: 'yellow', width: 1.2, dash: [4, 6] }))
    chartFrame.add(label('key expires', chartX(0) + 8, CH.y + 12, { size: 16, color: 'yellow' }))

    const chartLines = dynamic(() => {
        const now = Math.floor(simClock.value - SIM_START)
        const series = (run: Run, end: number, color: ColorInput, width: number): Node | null => {
            const points: Vec[] = []
            for (let i = 0; i <= Math.min(SIM_LEN - 1, end); i += 2) points.push([chartX(SIM_START + i), chartY(run.p99[i]!)])
            return points.length > 1 ? new Node(polyPath(points)).stroke(color, width) : null
        }
        const showSecond = useSecond.value >= 0.5
        const items = [
            series(stampede, showSecond ? SIM_LEN - 1 : now, showSecond ? 'red' : 'red', showSecond ? 2.4 : 3.2),
            showSecond ? series(coalesced, now, 'teal', 3.4) : null,
        ].filter((node): node is Node => node !== null)
        return items
    })

    const peakA = label(`no protection: ${stampede.peak.toFixed(0)} ms peak, ${missCount} queries`, CH.x + CH.w - 6, CH.y + 18, { size: 19, font: 'mono', color: 'red', align: 'right' })
    const peakB = label(`single flight: ${coalesced.peak.toFixed(0)} ms peak, ${coalesced.queries} query`, CH.x + CH.w - 6, CH.y + 46, { size: 19, font: 'mono', color: 'teal', align: 'right' })

    // ── Header and footer ───────────────────────────────────────────────────

    const title = label('One key expires.', -880, -492, { size: 62, font: 'text-serif' })
    const route = label('GET /products/:sku', 880, -492, { size: 22, font: 'mono', color: 'dim', align: 'right' })
    const caveat = label('Illustrative hop times. Queueing is simulated per request, in this film\'s source.', 880, 510, { size: 16, color: 'faint', align: 'right' })
    const ratio = label(`${(MISS_MS / HIT_MS).toFixed(0)} times slower, for one request`, WF.x + WF.labelW, WF.y + 46 + 8 * WF.rowH, { size: 21, font: 'text-serif', color: 'orange' })

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(flows)
    flows.opacity(0)
    s.chapter('The system')
    s.play(write(title), fade(flows, 1), fadeIn([lbBox, serviceBox, redisBox, keyBox, pgFrame], { lag: 0.1 }), { duration: 1.6 })
    s.add(chartFrame, wireKey)
    s.play(fadeIn([metrics, wireLabels, route, caveat]), draw(chartFrame, { lag: 0.01 }), draw(wireKey), { duration: 1.1 })
    s.wait(1)

    s.chapter('One hit')
    s.add(waterfall, waterfallHead, tracer)
    s.play(fadeIn([waterfall, waterfallHead]), packetAlpha.to(1), { duration: 0.5 })
    s.play(packet.to(HIT_MS, { ease: linear }), { duration: 4.2 })
    s.wait(0.8)

    s.chapter('One miss')
    s.play(packetAlpha.to(0), { duration: 0.3 })
    isMiss.set(1)
    packet.set(0)
    s.play(packetAlpha.to(1), axisMax.to(MISS_MS * 1.04, { ease: smoother }), { duration: 0.9 })
    s.play(packet.to(MISS_MS, { ease: linear }), { duration: 5.8 })
    s.play(fadeIn(ratio, { shift: [0, 6] }), { duration: 0.7 })
    s.wait(1)

    s.chapter('Twelve thousand at once')
    s.play(packetAlpha.to(0), { duration: 0.4 })
    s.add(chartLines)
    s.play(fadeIn(chartLines), { duration: 0.2 })
    s.play(simClock.to(SIM_END - 1, { ease: linear }), { duration: 13 })
    s.play(fadeIn(peakA), { duration: 0.6 })
    s.wait(1)

    s.chapter('Single flight')
    s.play(simClock.to(SIM_START, { ease: smoother }), { duration: 1.2 })
    useSecond.set(1)
    s.play(simClock.to(SIM_END - 1, { ease: linear }), { duration: 11 })
    s.play(fadeIn(peakB), { duration: 0.7 })
    s.wait(3)
})
