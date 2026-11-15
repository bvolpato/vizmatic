/**
 * Cache stampede and single-flight coalescing, driven by a discrete-event simulation.
 *
 * At 12,000 requests per second, a warm Redis cache answers in 2 ms and Postgres is idle.
 * The instant a hot key's TTL expires, every concurrent miss during the 40 ms database
 * rebuild window bypasses Redis and storms the 40-connection Postgres pool: 480 duplicate
 * SELECT queries queue in waves, pushing tail latency to 4,800 ms and triggering timeouts.
 * With single-flight coalescing, the first miss acquires an in-memory per-key lock and
 * queries Postgres once; the other 479 callers wait on that shared promise and finish in 42 ms.
 */
import {
    Node, assertEqual, column, connector, delay, draw, fadeIn, fadeOut, film,
    indicate, infoBox, lanes, place, requestQueue, row, sceneKit, seq, spotlight,
    tagTrack, zone, type QueueItem,
} from 'vizmatic/stage'

// ── Discrete-event simulation of the hot-key burst ──────────────────────────

const RATE_PER_SEC = 12_000
const REDIS_MS = 1
const EDGE_MS = 1
const DB_BASE_MS = 40
const DB_CONTENDED_MS = 400
const PG_SLOTS = 40
const REBUILD_WINDOW_MS = DB_BASE_MS

interface BurstSummary {
    arrivals: number
    dbQueries: number
    peakSlots: number
    p99Ms: number
    timedOut: number
}

function simulateWindow(mode: 'hit' | 'stampede' | 'singleflight'): BurstSummary {
    const arrivals = Math.round((RATE_PER_SEC * REBUILD_WINDOW_MS) / 1000)
    if (mode === 'hit') {
        return {
            arrivals,
            dbQueries: 0,
            peakSlots: 0,
            p99Ms: EDGE_MS + REDIS_MS,
            timedOut: 0,
        }
    }
    if (mode === 'singleflight') {
        // Leader issues 1 SELECT (40 ms) + SET (1 ms) + edge overhead (1 ms) = 42 ms.
        // Every follower arriving during the 40 ms window shares the leader result.
        return {
            arrivals,
            dbQueries: 1,
            peakSlots: 1,
            p99Ms: EDGE_MS + DB_BASE_MS + REDIS_MS,
            timedOut: 0,
        }
    }
    // Stampede: all 480 concurrent misses bypass Redis and fight over 40 DB slots.
    // Under lock/IO contention each wave of 40 takes 400 ms -> 12 waves = 4,800 ms tail.
    const waves = Math.ceil(arrivals / PG_SLOTS)
    const p99Ms = waves * DB_CONTENDED_MS
    const deadlineMs = 2_000
    const servedBeforeDeadline = Math.floor(deadlineMs / DB_CONTENDED_MS) * PG_SLOTS
    return {
        arrivals,
        dbQueries: arrivals,
        peakSlots: PG_SLOTS,
        p99Ms,
        timedOut: arrivals - servedBeforeDeadline,
    }
}

const hitStats = simulateWindow('hit')
const stampedeStats = simulateWindow('stampede')
const coalescedStats = simulateWindow('singleflight')

assertEqual(hitStats.arrivals, 480, 'requests arriving during a 40 ms window at 12,000 req/s')
assertEqual(
    [hitStats.dbQueries, stampedeStats.dbQueries, coalescedStats.dbQueries],
    [0, 480, 1],
    'Postgres queries issued under cache hit, stampede, and single-flight',
)
assertEqual(
    [hitStats.p99Ms, stampedeStats.p99Ms, coalescedStats.p99Ms],
    [2, 4800, 42],
    'tail latency in milliseconds across the three regimes',
)
assertEqual(stampedeStats.timedOut, 280, 'callers exceeding the 2,000 ms timeout during stampede')

// ── Film ────────────────────────────────────────────────────────────────────

export default film({
    title: 'One expired key can take down the database',
    description: 'How a single TTL expiry turns 12,000 req/s into a Postgres stampede, and how single-flight coalescing stops it.',
    fps: 60,
    look: 'blueprint',
    font: 'text-serif',
}, (s) => {
    const { area, heading, source, label, chip } = sceneKit({
        size: 38,
        source: { size: 28 },
        chip: { size: 28, font: 'mono', height: 1.55, room: 1.15, stroke: 'gridStrong' },
    })

    const title = heading('One expired key can take down the database')
    const foot = source('12,000 req/s on product:4821 · 40 Postgres slots · single-flight request coalescing')
    const regimeHolder = new Node()

    const [topBand, bottomBand, captionBand] = area.rows([3.5, 4.1, 0.85], 'tight')

    // ── Architecture row: Edge API -> [ Redis Cache | Postgres Primary ] ────

    const edgeBox = infoBox({
        title: 'Edge API',
        subtitle: '24 pods · 12k/s',
        size: 31,
        width: 385,
        accent: 'blue',
        rows: [
            { label: 'p99 latency', value: `${hitStats.p99Ms} ms`, tone: 'green' },
            { label: 'key lock', value: 'off', tone: 'dim' },
        ],
    })

    const redisBox = infoBox({
        title: 'Redis Cache',
        subtitle: 'key product:4821',
        size: 31,
        width: 390,
        accent: 'teal',
        rows: [
            { label: 'status', value: 'HIT · 9s', tone: 'teal' },
            { label: 'served', value: '12,000/s' },
        ],
    })

    const pgBox = infoBox({
        title: 'Postgres Primary',
        subtitle: `pool: ${PG_SLOTS} slots`,
        size: 31,
        width: 405,
        accent: 'orange',
        rows: [
            { label: 'queries', value: '0 / burst' },
            { label: 'active', value: `0 of ${PG_SLOTS}` },
        ],
    })

    const dataTier = zone(row([redisBox, pgBox], { gap: 225, align: 'center' }), {
        title: 'Backend data tier',
        titleSize: 28,
        padding: 20,
    })

    place(row([edgeBox, dataTier], { gap: 220, align: 'center' }), topBand, 'center')

    // Single-flight leader lock card in the left side of bottomBand; queue sits cleanly to its right.
    const [gateSlot, queueSlot] = bottomBand.columns([1.25, 4.1], 'normal')

    const lockGate = zone(
        column([
            chip('singleflight', { fill: 'yellow', stroke: 'yellow', color: 'bg', anchor: 'center' }),
            label('key: product:4821', { size: 27, font: 'mono', color: 'ink' }),
            label('1 leader queries DB', { size: 27, color: 'yellow' }),
            label('479 callers coalesce', { size: 27, color: 'teal' }),
        ], { gap: 10, align: 'center' }),
        { title: 'In-memory key lock', titleSize: 28, padding: 18, color: 'yellow' },
    )
    place(lockGate, gateSlot, 'center')
    lockGate.hide()

    const edgeToRedis = connector(edgeBox, redisBox, {
        route: 'straight',
        color: 'teal',
        width: 2.5,
        fromOffset: -0.22,
        toOffset: -0.22,
    })
    const redisToEdge = connector(edgeBox, redisBox, {
        route: 'straight',
        color: 'green',
        width: 2.2,
        tip: false,
        fromOffset: 0.24,
        toOffset: 0.24,
    })
    const redisToPgA = connector(redisBox, pgBox, {
        route: 'straight',
        color: 'orange',
        width: 2.5,
        fromOffset: -0.54,
        toOffset: -0.54,
    })
    const redisToPgB = connector(redisBox, pgBox, {
        route: 'straight',
        color: 'orange',
        width: 2.2,
        fromOffset: 0.0,
        toOffset: 0.0,
    })
    const pgToRedis = connector(redisBox, pgBox, {
        route: 'straight',
        color: 'teal',
        width: 2.2,
        tip: false,
        fromOffset: 0.54,
        toOffset: 0.54,
    })

    const pkt = (word: string, fill: string, color = 'bg'): Node =>
        chip(word, { anchor: 'center', fill, stroke: fill, color })

    // ── Lower theater 1: Postgres connection slot queue (Chapters 1-3) ──────

    const queue = requestQueue([], {
        slots: 4,
        width: Math.min(1260, Math.floor(queueSlot.width)),
        size: 29,
        itemWidth: 106,
        deadline: 2000,
        format: (ms) => `${Math.round(ms)}ms`,
        names: { slots: '40 DB slots (x10)' },
    })
    place(queue, queueSlot, 'center')

    // ── Lower theater 2: Comparative latency lanes (Chapter 4) ──────────────

    const comparison = lanes(
        [
            { name: 'Cache hit · 2 ms', color: 'green' },
            { name: 'Stampede · 4,800 ms', color: 'red' },
            { name: 'Single-flight · 42 ms', color: 'teal' },
        ],
        [
            { lane: 0, start: 0, end: 7, id: 'hit', label: 'Redis HIT (2 ms)', labelSide: 'right', color: 'green' },
            { lane: 1, start: 0, end: 96, id: 'herd', label: '480 duplicate SELECTs saturate 40 slots (4,800 ms)', labelSide: 'over', color: 'red', outcome: 'failed' },
            { lane: 2, start: 0, end: 18, id: 'sf', label: '1 leader SELECT + 479 shared (42 ms)', labelSide: 'right', color: 'teal' },
        ],
        {
            width: 1220,
            size: 28,
            barHeight: 42,
            pitch: 102,
            domain: [0, 100],
            deadline: { at: 62, label: '2,000 ms SLA budget', color: 'red' },
            cursor: true,
        },
    )
    place(comparison, bottomBand, 'center')

    // ── Stage subtitle helper ───────────────────────────────────────────────

    let activeLine: Node | null = null
    const setStageNote = (words: string) => {
        const next = place(label(words, { size: 32 }), captionBand, 'left')
        if (!activeLine) {
            activeLine = next
            s.add(next)
            return
        }
        const prev = activeLine
        activeLine = next
        s.play(seq(fadeOut(prev, { duration: 0.2 }), fadeIn(next, { duration: 0.3 })))
    }

    // ── Chapter 1: Warm cache (2 ms) ────────────────────────────────────────

    s.add(title, foot, regimeHolder)
    const ch1At = 0.2
    setStageNote('Warm cache: Redis serves 12,000 req/s in 2 ms while all 40 Postgres slots stay idle.')
    s.chapter('Warm cache: 2 ms')
    s.caption('At twelve thousand requests per second, Redis answers from memory in two milliseconds and Postgres stays idle.', 4.4)

    s.play(
        edgeBox.enter({ duration: 1.0 }),
        fadeIn(dataTier.frame, { duration: 0.9 }),
        fadeIn(dataTier.title!, { duration: 0.9 }),
        redisBox.enter({ duration: 1.0 }),
        pgBox.enter({ duration: 1.0 }),
    )
    s.play(
        draw([edgeToRedis, redisToEdge, redisToPgA, redisToPgB, pgToRedis], { lag: 0.06, duration: 0.9 }),
        queue.enter({ duration: 1.0 }),
    )

    s.caption('Every GET hits hot key product 4821 in RAM; zero queries touch the primary database.', 6.2)
    for (let wave = 0; wave < 4; wave++) {
        s.play(
            edgeToRedis.send(pkt('GET', 'teal'), { duration: 0.65 }),
            delay(redisToEdge.send(pkt('2ms', 'green'), { duration: 0.65, reverse: true }), 0.65),
        )
    }
    s.wait(1.6)

    // ── Chapter 2: TTL expires -> Thundering herd stampede ──────────────────

    const ch2At = s.time
    s.chapter('TTL expires: stampede')
    setStageNote('TTL hits 0: 480 misses bypass Redis at once, saturating all 40 DB slots and timing out.')
    s.caption('The instant TTL expires, four hundred eighty concurrent misses bypass Redis before a single query finishes.', 5.4)

    s.play(
        redisBox.setValue(0, 'MISS · 0s', { duration: 0.5, tone: 'red' }),
        redisBox.setValue(1, '0/s (miss)', { duration: 0.5, tone: 'red' }),
        indicate(redisBox, { color: 'red', scale: 1.04, duration: 0.9 }),
    )

    const burstBatches: QueueItem[] = [
        { id: 'Q01', color: 'orange' },
        { id: 'Q02', color: 'orange' },
        { id: 'Q03', color: 'orange' },
        { id: 'Q04', color: 'orange' },
        { id: 'Q05', color: 'red' },
        { id: 'Q06', color: 'red' },
        { id: 'Q07', color: 'red' },
        { id: 'Q08', color: 'red' },
    ]

    s.play(
        edgeToRedis.send(pkt('480x', 'orange'), { duration: 0.6 }),
        delay(redisToPgA.send(pkt('SQL', 'orange'), { duration: 0.65 }), 0.45),
        delay(redisToPgB.send(pkt('SQL', 'orange'), { duration: 0.65 }), 0.65),
        queue.arrive(burstBatches.slice(0, 4), { duration: 1.3, lag: 0.25 }),
    )

    s.play(
        queue.admit(['Q01', 'Q02', 'Q03', 'Q04'], { duration: 1.7 }),
        pgBox.setValue(0, `${stampedeStats.dbQueries} / burst`, { duration: 0.5, tone: 'red' }),
        pgBox.setValue(1, `${PG_SLOTS} of ${PG_SLOTS}`, { duration: 0.5, tone: 'red' }),
        edgeBox.setValue(0, `${stampedeStats.p99Ms.toLocaleString('en-US')} ms`, { duration: 0.5, tone: 'red' }),
    )

    s.caption('All forty Postgres connections lock up on duplicate SELECTs; queued callers cross the two-second timeout.', 6.2)

    // Pool is full: parallel burst lanes show both refused and dropped SELECTs while queued callers exceed 2,000 ms.
    s.play(
        redisToPgA.send(pkt('SQL', 'red'), { duration: 0.75, refused: true, hold: 0.95 }),
        delay(redisToPgB.send(pkt('SQL', 'red'), { duration: 0.75, lost: 0.62, hold: 0.95 }), 0.25),
        queue.arrive(burstBatches.slice(4), { duration: 1.4, lag: 0.25 }),
    )
    s.play(queue.wait((item) => item.state === 'waiting', 3600, { duration: 2.3 }))
    s.play(queue.reject((item) => item.late, '504', { duration: 1.8 }))
    s.wait(2.1)

    // Drain saturated slots cleanly before single-flight demonstration.
    s.play(queue.finish(['Q01', 'Q02', 'Q03', 'Q04'], { duration: 0.9 }))

    // ── Chapter 3: Single-flight coalescing (42 ms) ─────────────────────────

    const ch3At = s.time
    s.chapter('Single-flight lock: 42 ms')
    setStageNote('Single-flight: 1 leader queries Postgres (40 ms); 479 followers share the result in 42 ms.')
    s.caption('With single-flight, the first miss takes a per-key lock and queries Postgres once while followers coalesce.', 5.4)

    s.play(
        edgeBox.setValue(1, 'LOCKED', { duration: 0.5, tone: 'yellow' }),
        fadeIn(lockGate, { duration: 0.6 }),
        spotlight([edgeBox, lockGate, redisBox], { keep: [title, foot, regimeHolder, activeLine!], duration: 0.75 }),
    )

    s.play(
        queue.arrive({ id: 'LDR', color: 'teal' }, { duration: 0.65 }),
        edgeToRedis.send(pkt('1x', 'yellow', 'bg'), { duration: 0.65 }),
    )
    s.wait(1.8)
    s.play(spotlight(null, { duration: 0.55 }))

    s.play(
        queue.admit('LDR', { duration: 0.9 }),
        redisToPgA.send(pkt('1 SQL', 'teal'), { duration: 0.7 }),
        pgBox.setValue(0, `${coalescedStats.dbQueries} / burst`, { duration: 0.5, tone: 'green' }),
        pgBox.setValue(1, `1 of ${PG_SLOTS}`, { duration: 0.5, tone: 'green' }),
    )

    s.caption('Postgres answers in forty milliseconds, Redis caches the value, and all four hundred eighty callers finish in forty-two milliseconds.', 4.8)

    s.play(
        pgToRedis.send(pkt('ROW', 'teal'), { duration: 0.65, reverse: true }),
        queue.finish('LDR', { duration: 0.7 }),
        redisBox.setValue(0, 'SET · 60s', { duration: 0.5, tone: 'teal' }),
        redisBox.setValue(1, '12,000/s', { duration: 0.5, tone: 'green' }),
    )
    s.play(
        redisToEdge.send(pkt('42ms', 'green'), { duration: 0.7, reverse: true }),
        edgeBox.setValue(0, `${coalescedStats.p99Ms} ms`, { duration: 0.5, tone: 'green' }),
        edgeBox.setValue(1, 'shared', { duration: 0.5, tone: 'teal' }),
    )
    s.wait(1.5)

    // ── Chapter 4: Tail-latency comparison across all three regimes ─────────

    const ch4At = s.time
    s.chapter('Tail latency compared')
    setStageNote('480 duplicate queries become 1: tail latency drops from 4,800 ms back inside the 42 ms budget.')
    s.caption('Coalescing turns four hundred eighty duplicate queries into one, cutting tail latency over one hundred fold.', 7.2)

    s.play(fadeOut([queue, lockGate], { duration: 0.6 }))
    s.play(comparison.enter({ duration: 1.0 }))
    s.play(comparison.advance('hit', { duration: 1.0 }))
    s.wait(0.9)
    s.play(comparison.advance('sf', { duration: 1.2 }))
    s.wait(1.0)
    // Stampede keeps grinding past the 2,000 ms SLA budget all the way to 4,800 ms.
    s.play(comparison.advance(100, { duration: 2.5 }))
    s.wait(3.2)

    const endAt = s.time
    s.at(0, () => {
        regimeHolder.add(
            tagTrack([
                { at: ch1At, word: 'WARM CACHE', note: '99.98% hit rate' },
                { at: ch2At, word: 'STAMPEDE', note: 'TTL = 0 · 480 misses' },
                { at: ch3At, word: 'SINGLE-FLIGHT', note: 'coalesce per key' },
                { at: ch4At, word: 'COMPARISON', note: 'tail latency' },
            ], {
                until: endAt + 1,
                size: 28,
                anchor: 'right',
                noteFont: 'text-serif',
            }).at(area.right, title.get('y')),
        )
    })
})
