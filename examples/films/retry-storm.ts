import {
    Box,
    assertEqual,
    delay,
    eventLog,
    fadeIn,
    fadeOut,
    film,
    infoBox,
    lanes,
    lineChart,
    place,
    sceneKit,
    seededRandom,
    terminal,
    text,
    type LogRow,
} from 'vizmatic/stage'

// Deterministic discrete-event retry simulation (80 req/s steady load, 140 req/s backend cap).
// Outage runs from t = 2s to t = 4s. Compare synchronized fixed 1s retries vs full-jitter
// exponential backoff with a 10% retry budget.
const BASE_RPS = 90
const CAPACITY_RPS = 135
const OUTAGE_START = 2
const OUTAGE_END = 4
const SIM_SECONDS = 12
const STEPS_PER_SEC = 2 // 0.5s ticks

interface SimPoint { t: number; load: number }

function simulateRetryPolicy(policy: 'fixed' | 'jitter-budget'): SimPoint[] {
    const ticks = SIM_SECONDS * STEPS_PER_SEC
    const basePerTick = BASE_RPS / STEPS_PER_SEC
    const capPerTick = CAPACITY_RPS / STEPS_PER_SEC
    const scheduled = new Array<number>(ticks + 20).fill(0)
    const rng = seededRandom(17)
    const out: SimPoint[] = []

    for (let k = 0; k <= ticks; k++) {
        const t = k / STEPS_PER_SEC
        const retriesDue = scheduled[k]!
        const budgetCap = policy === 'jitter-budget' ? basePerTick * 0.10 : Infinity
        const admittedRetries = Math.min(retriesDue, budgetCap)
        const total = basePerTick + admittedRetries
        out.push({ t, load: Math.round(total * STEPS_PER_SEC) })

        const isDown = t >= OUTAGE_START && t < OUTAGE_END
        const served = isDown ? 0 : Math.min(total, capPerTick)
        const failed = Math.max(0, total - served)
        if (failed > 0) {
            if (policy === 'fixed') {
                // Synchronized 1.0s fixed retry: 95% of failed callers retry in lockstep (1s and 2s waves).
                scheduled[k + 2] = (scheduled[k + 2] ?? 0) + failed * 0.95
            } else {
                // Full-jitter exponential backoff spreads retries across 1..6 ticks (0.5s..3.0s).
                const retriable = failed * 0.90
                for (let slice = 0; slice < 6; slice++) {
                    const weight = (0.6 + rng() * 0.8) / 6
                    const offset = 1 + slice
                    scheduled[k + offset] = (scheduled[k + offset] ?? 0) + retriable * weight
                }
            }
        }
    }
    return out
}

const FIXED_CURVE = simulateRetryPolicy('fixed')
const JITTER_CURVE = simulateRetryPolicy('jitter-budget')
const FIXED_PEAK = Math.max(...FIXED_CURVE.map((p) => p.load))
const JITTER_PEAK = Math.max(...JITTER_CURVE.map((p) => p.load))
const FIXED_AFTER_OUTAGE = FIXED_CURVE.find((p) => p.t === 6.0)!.load
const JITTER_AFTER_OUTAGE = JITTER_CURVE.find((p) => p.t === 6.0)!.load

assertEqual(FIXED_PEAK > CAPACITY_RPS * 1.4, true, 'fixed retries spike far above backend saturation capacity')
assertEqual(FIXED_AFTER_OUTAGE > CAPACITY_RPS, true, 'fixed retries remain saturated 2 seconds after outage ends')
assertEqual(JITTER_PEAK < CAPACITY_RPS, true, 'jitter + 10% retry budget stays safely below saturation capacity')
assertEqual(JITTER_AFTER_OUTAGE <= BASE_RPS + 10, true, 'jitter + budget recovers cleanly after outage')

const LOG_STATES = {
    ok: { color: 'green', mark: 'check' as const },
    retry: { color: 'orange', mark: 'dot' as const },
    fail: { color: 'red', mark: 'cross' as const },
    shed: { color: 'teal', mark: 'ring' as const },
}

export default film(
    {
        title: 'Retry storms: why naive retries keep outages alive',
        description:
            'A two-second brownout triggers synchronized fixed retries that pin a recovered service above saturation, while exponential backoff with full jitter and a retry budget restores steady traffic.',
        look: 'neon',
        font: 'text-serif',
        fps: 60,
        poster: 26.2,
    },
    (s) => {
        const kit = sceneKit({ size: 38, source: { y: -420 } })
        const title = kit.heading('Retry storms: why naive retries keep outages alive')
        const source = kit.source('Discrete-event simulation · 90 req/s baseline · 135 req/s backend cap · 2 s brownout')
        s.add(title, source)

        const stageArea = new Box(
            kit.area.left + 12,
            kit.area.top + 32,
            kit.area.right - 12,
            kit.area.bottom - 16,
        )

        // ── Chapter 1: Brief brownout triggers synchronized retries ────────────
        s.chapter('A two-second brownout')
        s.caption('A two-second downstream brownout returns 503 errors. Fixed one-second retries wake up in lockstep.', 12.2)

        const [ch1Top, ch1Bot] = stageArea.rows([0.46, 0.54], 20)
        const probeTerm = terminal(
            [
                { text: 'curl -sS https://api.prod/checkout', kind: 'command' },
                { text: 'status=503  upstream=payments-db  retry=fixed(1s)', color: 'red' },
                { text: 'warn: 90 failed callers queued retry wave at +1.0s', color: 'orange' },
                { text: 'alert: gateway queue saturated (cap 135 req/s)', color: 'red' },
            ],
            {
                title: 'prod-gateway-01',
                note: 't = 2.0s..4.0s',
                shown: false,
                size: 33,
                columns: 54,
            },
        )
        place(probeTerm, ch1Top!, 'center')

        const stormLanes = lanes(
            [
                { name: 'Clients', color: 'blue' },
                { name: 'Gateway', color: 'teal' },
                { name: 'Backend', color: 'green' },
            ],
            [
                { id: 'c1', lane: 'Clients', start: 0.2, end: 1.4, label: 'req 1' },
                { from: 'Clients', to: 'Gateway', at: 0.4 },
                { from: 'Gateway', to: 'Backend', at: 0.6 },
                { id: 'b1', lane: 'Backend', start: 0.6, end: 1.2, label: '200 OK' },
                { id: 'down', lane: 'Backend', start: 2.0, end: 4.0, down: true, label: '2s brownout' },
                { id: 'c2', lane: 'Clients', start: 2.2, end: 3.1, outcome: 'failed', label: '503' },
                { from: 'Clients', to: 'Gateway', at: 2.3, outcome: 'failed' },
                { id: 'r1', lane: 'Clients', start: 3.3, end: 4.2, color: 'orange', outcome: 'failed', label: 'retry wave 1' },
                { from: 'Clients', to: 'Clients', at: [3.1, 3.3], color: 'orange', dashed: true },
                { id: 'r2', lane: 'Clients', start: 4.4, end: 5.8, color: 'red', outcome: 'failed', label: 'wave 2 (2.9×)' },
                { id: 'sat', lane: 'Backend', start: 4.1, end: 5.9, color: 'red', outcome: 'failed', label: 'saturated >135/s' },
            ],
            {
                domain: [0, 6],
                width: 1380,
                barHeight: 42,
                ticks: [0, 1, 2, 3, 4, 5, 6],
                format: (v) => `${v}s`,
                size: 26,
            },
        )
        place(stormLanes, ch1Bot!, 'center')

        s.add(probeTerm.hide(), stormLanes.hide())
        s.play(
            probeTerm.enter({ duration: 0.55 }),
            delay(probeTerm.type(0, { duration: 1.2 }), 0.35),
            delay(stormLanes.enter({ duration: 0.9 }), 0.6),
        )
        s.play(
            probeTerm.print({ from: 1, to: 3, duration: 1.2 }),
            stormLanes.advance(4.0, { duration: 2.6 }),
        )
        s.play(stormLanes.advance(6.0, { duration: 2.1 }))
        s.wait(1.8)

        // ── Chapter 2: Amplification loop vs saturation ceiling ────────────────
        s.chapter('The metastable amplification loop')
        s.caption('Even after the database recovers at 4 seconds, synchronized retries keep total load above the 140 req/s ceiling.', 12.6)

        const [logCol, chartCol] = stageArea.columns([0.92, 1.08], 32)

        const stormLog = eventLog(
            [
                { id: 1, name: 'OutageStart', detail: '0 req/s', time: '2.0s', state: 'fail' },
                { id: 2, name: 'RetryWave', detail: '176 req/s', time: '3.0s', state: 'retry' },
            ],
            {
                title: 'Gateway retry telemetry',
                width: Math.round(logCol!.width - 12),
                visible: 6,
                size: 26,
                titleSize: 26,
                leading: 1.65,
                states: LOG_STATES,
                footer: (count) => `${count} events recorded`,
            },
        )
        place(stormLog, logCol!, 'center')

        const burstEvents: readonly LogRow[] = [
            { id: 3, name: 'BackendUp', detail: 'cap 135/s', time: '4.0s', state: 'ok' },
            { id: 4, name: 'RetryStorm', detail: `${FIXED_PEAK}/s peak`, time: '4.5s', state: 'fail' },
            { id: 5, name: 'QueueReject', detail: `${FIXED_AFTER_OUTAGE}/s failing`, time: '6.0s', state: 'fail' },
            { id: 6, name: 'StuckOpen', detail: 'overload', time: '8.5s', state: 'retry' },
        ]

        const chartTitle = kit.label('Total gateway traffic (req/s) vs 135 req/s capacity', { color: 'ink' })
        const stormChart = lineChart(
            [
                {
                    name: 'Fixed 1s',
                    points: FIXED_CURVE.map((p) => [p.t, p.load] as const),
                    color: 'red',
                    width: 4.5,
                    area: 0.14,
                },
                {
                    name: 'Cap 135',
                    points: [[0, CAPACITY_RPS], [SIM_SECONDS, CAPACITY_RPS]],
                    color: 'gold',
                    width: 2.5,
                    dash: [10, 8],
                    smooth: false,
                },
            ],
            {
                width: Math.round(chartCol!.width - 240),
                height: 410,
                x: [0, SIM_SECONDS],
                y: [0, Math.ceil((FIXED_PEAK + 30) / 50) * 50],
                xLabel: 'time (s)',
                yLabel: 'req/s',
                xTicks: 6,
                yTicks: 5,
                labelSize: 26,
            },
        )
        place(chartTitle, new Box(chartCol!.left, chartCol!.top, chartCol!.right, chartCol!.top + 52), 'left')
        place(stormChart, new Box(chartCol!.left, chartCol!.top + 58, chartCol!.right, chartCol!.bottom - 12), 'center')

        s.add(stormLog.hide(), chartTitle.hide(), stormChart.hide())

        s.play(
            fadeOut([probeTerm, stormLanes], { duration: 0.4 }),
            delay(stormLog.enter({ duration: 0.85 }), 0.45),
            delay(fadeIn(chartTitle, { duration: 0.45 }), 0.45),
            delay(stormChart.enter({ duration: 2.4 }), 0.55),
        )
        s.play(
            stormLog.append(burstEvents, { duration: 3.4, lag: 0.65 }),
        )
        s.wait(2.8)

        // ── Chapter 3: Full jitter + 10% retry budget breaks the storm ─────────
        s.chapter('Full jitter and a retry budget')
        s.caption('Exponential backoff with full jitter spreads retries across time, and a 10 percent retry budget keeps load below capacity.', 12.8)

        const [compareLeft, compareRight] = stageArea.columns([1.22, 0.78], 36)
        const fixedTitle = kit.label('Fixed retry vs Full jitter + 10% retry budget', { color: 'ink' })
        const compareChart = lineChart(
            [
                {
                    name: 'Fixed 1s',
                    points: FIXED_CURVE.map((p) => [p.t, p.load] as const),
                    color: 'red',
                    width: 3.2,
                    dash: [6, 6],
                },
                {
                    name: 'Jitter + 10%',
                    points: JITTER_CURVE.map((p) => [p.t, p.load] as const),
                    color: 'teal',
                    width: 4.8,
                    area: 0.18,
                },
                {
                    name: 'Cap 135',
                    points: [[0, CAPACITY_RPS], [SIM_SECONDS, CAPACITY_RPS]],
                    color: 'gold',
                    width: 2.4,
                    dash: [10, 8],
                    smooth: false,
                },
            ],
            {
                width: Math.round(compareLeft!.width - 260),
                height: 410,
                x: [0, SIM_SECONDS],
                y: [0, Math.ceil((FIXED_PEAK + 30) / 50) * 50],
                xLabel: 'time (s)',
                yLabel: 'req/s',
                xTicks: 6,
                yTicks: 5,
                labelSize: 26,
            },
        )
        place(fixedTitle, new Box(compareLeft!.left, compareLeft!.top, compareLeft!.right, compareLeft!.top + 52), 'left')
        place(compareChart, new Box(compareLeft!.left, compareLeft!.top + 58, compareLeft!.right, compareLeft!.bottom - 12), 'center')

        const [ruleTop, ruleBot] = compareRight!.rows([1, 1], 24)
        const naiveCard = infoBox({
            title: 'Fixed 1s retries',
            rows: [
                { label: 'peak load', value: `${FIXED_PEAK} req/s (${(FIXED_PEAK / BASE_RPS).toFixed(1)}×)`, tone: 'red' },
                { label: 'at t = 6.0s', value: `${FIXED_AFTER_OUTAGE} req/s · still failing`, tone: 'orange' },
            ],
            accent: 'red',
            size: 27,
        })
        const budgetCard = infoBox({
            title: 'Full jitter + 10% budget',
            rows: [
                { label: 'peak load', value: `${JITTER_PEAK} req/s (< 135 cap)`, tone: 'teal' },
                { label: 'at t = 6.0s', value: `${JITTER_AFTER_OUTAGE} req/s · recovered`, tone: 'green' },
            ],
            accent: 'teal',
            size: 27,
        })
        place(naiveCard, ruleTop!, 'center')
        place(budgetCard, ruleBot!, 'center')

        const footerNote = text('Cap retries at ≤10% of steady traffic and randomize backoff: never retry in lockstep.', {
            size: 27,
            color: 'dim',
        })
        place(footerNote, new Box(kit.area.left, kit.area.bottom - 12, kit.area.right, kit.area.bottom + 24), 'center')

        s.add(fixedTitle.hide(), compareChart.hide(), naiveCard.hide(), budgetCard.hide(), footerNote.hide())

        s.play(
            fadeOut([stormLog, chartTitle, stormChart], { duration: 0.4 }),
            delay(fadeIn(fixedTitle, { duration: 0.45 }), 0.45),
            delay(compareChart.enter({ duration: 2.3 }), 0.5),
            delay(fadeIn(naiveCard, { duration: 0.55 }), 1.2),
            delay(fadeIn(budgetCard, { duration: 0.55 }), 1.8),
        )
        s.play(fadeIn(footerNote, { duration: 0.55 }))
        s.wait(3.8)
    },
)
