/**
 * A Galton board with 12 rows and 900 balls. Each bounce is a deterministic
 * pseudorandom coin flip, so the same counts appear on every render. The readouts
 * are measured from the landed balls, and the curve is the Gaussian with
 * mean 12 * 1/2 = 6 and standard deviation sqrt(12 * 1/4) = sqrt(3). The seed is a
 * chosen one: this sample happens to land close to theory (6.00 and 1.73).
 */
import {
    Node, circlePath, curveThrough, draw, dot, dynamic, fadeIn, fadeOut, film, line, linear, morphMatching, parseColor, ramp, smooth, text, tex, write,
    type Path, type Rgba, type Ring, type Vec,
} from 'vizmatic/stage'

const ROWS = 12
const BALLS = 900
const COLUMN = 480
const CX = -240
const DX = 66, DY = 38
const TOP = -478
const FLOOR = 482
const BALL = 5.8
const PER_ROW = 5
const ROW_HEIGHT = 11

const pegX = (row: number, index: number) => CX + (index - row / 2) * DX
const pegY = (row: number) => TOP + row * DY
const binX = (bin: number) => CX + (bin - ROWS / 2) * DX

function binomial(n: number, k: number): number {
    let out = 1
    for (let i = 1; i <= k; i++) out = (out * (n - k + i)) / i
    return out
}

/** xorshift32: small, deterministic, and good enough for coin flips. */
function coin(seed: number): () => boolean {
    let state = seed >>> 0 || 1
    return () => {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        state >>>= 0
        return (state & 0x8000) !== 0
    }
}

interface Ball { flips: boolean[]; bin: number; start: number; tau: number; drop: number; land: number; slot: number }

export default film({
    title: 'The central limit theorem',
    description: 'A Galton board drops 900 balls into a histogram that settles onto the Gaussian curve.',
    fps: 60,
}, (s) => {
    const flip = coin(837343728)
    const balls: Ball[] = []
    const DEMO_END = 8.6
    let start = 0
    for (let i = 0; i < BALLS; i++) {
        const flips = Array.from({ length: ROWS }, () => flip())
        const bin = flips.filter(Boolean).length
        const demo = i === 0
        const tau = demo ? 0.4 : i === 1 ? 0.2 : 0.082
        const drop = demo ? 0.7 : 0.5
        // Spacing shrinks as the film goes on: first single balls, then a downpour.
        const progress = i / BALLS
        const spacing = i === 0 ? 6.6 : i === 1 ? 1.5 : 0.13 * (1 - smooth(Math.min(1, progress * 6))) + 0.0118
        balls.push({ flips, bin, start, tau, drop, land: start + ROWS * tau + drop, slot: 0 })
        start += spacing
    }
    const order = balls.map((_, i) => i).sort((a, b) => balls[a]!.land - balls[b]!.land)
    const counts = new Array<number>(ROWS + 1).fill(0)
    for (const index of order) {
        const ball = balls[index]!
        ball.slot = counts[ball.bin]!
        counts[ball.bin]! += 1
    }

    // Running statistics over landed balls, in landing order.
    const landings = order.map((index) => balls[index]!)
    const sum1: number[] = [0], sum2: number[] = [0]
    for (const ball of landings) {
        sum1.push(sum1[sum1.length - 1]! + ball.bin)
        sum2.push(sum2[sum2.length - 1]! + ball.bin * ball.bin)
    }
    const landedAt = (t: number): number => {
        let lo = 0, hi = landings.length
        while (lo < hi) {
            const mid = (lo + hi) >> 1
            if (landings[mid]!.land <= t) lo = mid + 1
            else hi = mid
        }
        return lo
    }

    const binColors: readonly Rgba[] = ramp(ROWS + 1, 'blue', 'teal', 'yellow', 'teal', 'blue')
    const slotPoint = (bin: number, slot: number): Vec => {
        const row = Math.floor(slot / PER_ROW), col = slot % PER_ROW
        return [binX(bin) + (col - (PER_ROW - 1) / 2) * 12.2 + (row % 2 === 0 ? -1.5 : 1.5), FLOOR - BALL - 1 - row * ROW_HEIGHT]
    }
    const piles: Ring[][] = counts.map((count, bin) => Array.from({ length: count }, (_, slot) => {
        const [x, y] = slotPoint(bin, slot)
        return circlePath(x, y, BALL)[0]!
    }))
    const pileCache = new Map<number, Path>()
    const pile = (bin: number, count: number): Path => {
        const key = bin * 10000 + count
        let path = pileCache.get(key)
        if (!path) {
            path = piles[bin]!.slice(0, count)
            pileCache.set(key, path)
        }
        return path
    }

    const position = (ball: Ball, t: number): Vec | null => {
        const local = t - ball.start
        if (local < 0) return null
        const end = ROWS * ball.tau
        if (local < end) {
            const row = Math.floor(local / ball.tau)
            const u = local / ball.tau - row
            let rights = 0
            for (let i = 0; i < row; i++) if (ball.flips[i]) rights++
            const sign = ball.flips[row] ? 1 : -1
            // Sit on top of the peg, hop off, and fall to the next row.
            const x = pegX(row, rights) + (sign * DX * 0.5) * smooth(u)
            const y = pegY(row) - 13 + DY * u * u - 15 * Math.sin(Math.PI * u) * (1 - u * 0.5)
            return [x, y]
        }
        const u = Math.min(1, (local - end) / ball.drop)
        const [tx, ty] = slotPoint(ball.bin, ball.slot)
        const rights = ball.bin
        const fromX = pegX(ROWS, rights), fromY = pegY(ROWS) - 13
        return [fromX + (tx - fromX) * u, fromY + (ty - fromY) * u * u]
    }

    const time = s.value(0)

    const board = new Node()
    for (let row = 0; row < ROWS; row++) {
        for (let i = 0; i <= row; i++) board.add(dot(4, 'dim').at(pegX(row, i), pegY(row)))
    }
    const bins = new Node()
    for (let bin = 0; bin <= ROWS + 1; bin++) {
        const x = binX(bin) - DX / 2
        bins.add(line([x, pegY(ROWS) + 6], [x, FLOOR], { stroke: 'faint', width: 1.4 }))
    }
    bins.add(line([binX(0) - DX / 2 - 12, FLOOR], [binX(ROWS) + DX / 2 + 12, FLOOR], { stroke: 'dim', width: 2 }))
    const ticks = new Node()
    for (let bin = 0; bin <= ROWS; bin++) ticks.add(tex(String(bin), { size: 21, color: 'dim', display: false }).moveTo([binX(bin), FLOOR + 26]))

    const action = dynamic(() => {
        const t = time.value
        const out: Node[] = []
        const landed = landedAt(t)
        const heights = new Array<number>(ROWS + 1).fill(0)
        for (let i = 0; i < landed; i++) heights[landings[i]!.bin]! += 1
        heights.forEach((count, bin) => {
            if (count > 0) out.push(new Node(pile(bin, count)).fill(binColors[bin]!))
        })
        for (const ball of balls) {
            if (ball.start > t) break
            if (ball.land <= t) continue
            const point = position(ball, t)
            if (!point) continue
            const color = ball === balls[0] ? parseColor('yellow') : binColors[ball.bin]!
            // A short streak behind each ball carries the speed through still frames.
            const before = position(ball, t - 0.028)
            if (before) out.push(line(before, point, { stroke: color, width: BALL * 1.5, opacity: 0.4 }))
            const mark = new Node(circlePath(point[0], point[1], BALL)).fill(color)
            if (ball === balls[0]) mark.glow(12, 'yellow')
            out.push(mark)
        }
        return out
    })

    // The theoretical curve, drawn in stack heights: one ball adds this much height.
    const heightPerBall = ROW_HEIGHT / PER_ROW
    const sigma = Math.sqrt(ROWS / 4)
    const gaussianPoints: Vec[] = []
    for (let i = 0; i <= 200; i++) {
        const k = -0.5 + (i * (ROWS + 1)) / 200
        const density = Math.exp(-((k - ROWS / 2) ** 2) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI))
        gaussianPoints.push([binX(k), FLOOR - BALLS * density * heightPerBall - 2])
    }
    const gaussian = new Node(curveThrough(gaussianPoints)).stroke('ink', 3.6).glow(8, 'ink')
    // Exact binomial probabilities, as a thin mark over each bin.
    const exactMarks = new Node()
    for (let bin = 0; bin <= ROWS; bin++) {
        const y = FLOOR - BALLS * (binomial(ROWS, bin) / 2 ** ROWS) * heightPerBall - 2
        exactMarks.add(line([binX(bin) - DX * 0.4, y], [binX(bin) + DX * 0.4, y], { stroke: 'pink', width: 3 }))
    }

    // ── Column ──────────────────────────────────────────────────────────────

    const rule = line([COLUMN - 70, -540], [COLUMN - 70, 540], { stroke: 'grid', width: 1.2 })
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        return node
    }
    const label = (content: string, top: number) => place(text(content, { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), top)
    const title = place(text('Twelve coin flips. Nine hundred times.', { font: 'serif', size: 58, maxWidth: 410, leading: 1.08 }), -490)

    const flipLabel = label('First ball, bounce by bounce', -340)
    const flipRead = dynamic(() => {
        const t = time.value
        const ball = balls[0]!
        const done = Math.max(0, Math.min(ROWS, Math.floor((t - ball.start) / ball.tau)))
        const letters = ball.flips.slice(0, done).map((right) => right ? 'R' : 'L').join(' ')
        return place(text(letters.length ? letters : '...', { font: 'mono', size: 25, color: 'yellow' }), -306)
    })
    const rightRead = dynamic(() => {
        const t = time.value
        const ball = balls[0]!
        const done = Math.max(0, Math.min(ROWS, Math.floor((t - ball.start) / ball.tau)))
        const rights = ball.flips.slice(0, done).filter(Boolean).length
        return place(text(`${rights} right, so far`, { size: 24, color: 'dim' }), -264)
    })

    const countLabel = label('Balls landed', -196)
    const countRead = dynamic(() => place(text(String(landedAt(time.value)).padStart(3, ' '), { font: 'mono', size: 64, color: 'ink' }), -170))
    const statLabelA = label('Mean', -66)
    const statReadA = dynamic(() => {
        const n = landedAt(time.value)
        return place(text(n ? (sum1[n]! / n).toFixed(2) : '-', { font: 'mono', size: 38, color: 'ink' }), -40)
    })
    const statLabelB = label('Std deviation', -66)
    statLabelB.alignTo([COLUMN + 200, 0], 'left')
    const statReadB = dynamic(() => {
        const n = landedAt(time.value)
        const variance = n ? sum2[n]! / n - (sum1[n]! / n) ** 2 : 0
        const node = place(text(n > 1 ? Math.sqrt(variance).toFixed(2) : '-', { font: 'mono', size: 38, color: 'ink' }), -40)
        node.alignTo([COLUMN + 200, 0], 'left')
        return node
    })
    const expected = place(tex('\\mu = 6, \\quad \\sigma = \\sqrt{3} \\approx 1.73', { size: 30, color: 'dim' }), 28)

    const eqExact = place(tex('P(k) = \\binom{12}{k} \\frac{1}{2^{12}}', { size: 40, color: 'ink' }), 108)
    for (const glyph of eqExact.part('P(k)')) glyph.fill('pink')
    const eqGauss = place(tex('P(k) \\approx \\frac{1}{\\sigma \\sqrt{2\\pi}} e^{-\\frac{(k-\\mu)^2}{2\\sigma^2}}', { size: 40, color: 'ink' }), 108)
    for (const glyph of eqGauss.part('P(k)')) glyph.fill('ink')
    const caption = place(text('Add up enough small independent effects, and this shape appears. No shape was put in.', { size: 24, color: 'dim', maxWidth: 400, leading: 1.42 }), 232)

    // ── Timeline ────────────────────────────────────────────────────────────

    const total = balls[BALLS - 1]!.land
    s.add(rule)
    s.chapter('The board')
    s.play(write(title), fadeIn(board, { lag: 0.008 }), { duration: 2.2 })
    s.play(draw(bins, { lag: 0.02 }), fadeIn(ticks, { lag: 0.04 }), { duration: 1.2 })
    s.add(action)
    s.play(fadeIn([flipLabel, flipRead, rightRead]), { duration: 0.6 })

    s.chapter('One ball')
    s.play(time.to(DEMO_END - 1.2, { ease: linear }), { duration: DEMO_END - 1.2 })
    s.play(fadeIn([countLabel, countRead, statLabelA, statReadA, statLabelB, statReadB]), time.to(DEMO_END, { ease: linear }), { duration: 1.2 })

    s.chapter('A downpour')
    s.play(time.to(total + 0.2, { ease: linear }), { duration: total + 0.2 - DEMO_END })
    s.wait(0.5)

    s.chapter('The exact answer')
    s.play(fadeOut([flipLabel, flipRead, rightRead], { duration: 0.6 }), fadeIn(expected), write(eqExact), fadeIn(exactMarks, { lag: 0.06 }), { duration: 1.6 })
    s.wait(1)

    s.chapter('The bell')
    s.play(draw(gaussian), morphMatching(eqExact, eqGauss), { duration: 2.4 })
    s.play(fadeIn(caption, { shift: [0, 8] }), { duration: 1 })
    s.wait(3.4)
})
