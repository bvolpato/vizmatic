/**
 * A forecast as a range, with real numbers. A seeded generator makes a metric with a trend, a daily shape and
 * noise. A small forecaster reads 28 days of it: a line through the day means, the mean shape of a day, and an
 * AR(1) model of what is left. It then makes 1,000 possible futures by drawing its own past errors again, and
 * the bands are percentiles of those paths. The truth of the next two days comes from the same generator, and
 * the film counts the points that land inside the wide band. One run can be luck, so the file runs the same
 * forecaster on 1,000 seeds, and the last picture shows all of them.
 *
 * The method is in Hyndman and Athanasopoulos, "Forecasting: Principles and Practice", 3rd edition: forecasting
 * with decomposition (section 5.7), autoregressive models (9.3), and prediction intervals from bootstrapped
 * residuals (5.5). Such intervals "tend to be too narrow" (9.8), because the paths leave out the error of the
 * fitted trend and shape. The 1,000 runs show it: the band for 9 of 10 points holds a little less.
 *
 * The percentile rule: a band leaves the same number of paths under it and over it. The band for 9 of 10 goes
 * from the 51st to the 950th of the 1,000 values of an hour in rising order, so it holds 900 of them, and no
 * edge is a value between two paths.
 *
 * The seed is chosen by a rule, in the code: of the seeds 1 to 1,000, the first one whose count is the median
 * count of all of them, and whose points are all clear of the two edges of the wide band. So the film shows a
 * common run, and no point of it is in or out by less than a viewer can see.
 *
 * Palette: ink is what was measured: the metric, and the share that was seen. Blue is the forecast: the median,
 * the paths, the two bands (the wider one lighter), its promise, and its runs. Yellow is the present. Green is
 * a point inside the wide band, and red is a point outside it.
 */
import {
    Box, GAP, assertEqual, axes, band, beside, boxOf, circle, clamp, commas, delay, dot, draw, dynamic, fade, fadeIn, fadeOut, film, fitted,
    histogram, legend, line, linear, mixColor, parseColor, place, sceneKit, seededRandom, text, valueAt, write,
    type Node, type Vec,
} from 'vizmatic/stage'

// ── The metric and the forecaster ───────────────────────────────────────────

const DAY = 24                 // one point for each hour
const HISTORY = 28 * DAY       // what the forecaster reads
const HORIZON = 2 * DAY        // what it forecasts
const PATHS = 1000
const RUNS = 1000
// The paths that a band leaves out on each side: 50 for the band of 9 of 10 paths, and 250 for the band of half of them.
const WIDE_OUT = PATHS / 20, HALF_OUT = PATHS / 4
/** The share of the paths that the wide band holds: the share of the truth that it promises. */
const PROMISE = 1 - 2 * WIDE_OUT / PATHS
/** A share as a part of 10, the unit of the promise: 0.9 is "9 of 10". */
const ofTen = (share: number, digits = 0) => `${(10 * share).toFixed(digits)} of 10`
// A point this near to an edge of the wide band is in or out by less than a viewer can see: the film checks that it is 2 pixels or more.
const CLEAR = 1.25

/** The metric: a trend, a daily shape, and noise that keeps a part of the noise of the hour before. */
function metric(seed: number, length: number): number[] {
    const random = seededRandom(seed)
    const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
    let noise = 0
    return Array.from({ length }, (_, t) => {
        const turn = 2 * Math.PI * (t % DAY) / DAY
        noise = 0.7 * noise + 14 * gauss()
        return 220 + 4 * t / DAY + 60 * Math.sin(turn - 1.9) + 22 * Math.sin(2 * turn - 0.6) + noise
    })
}

/**
 * A trend, the shape of a day, and an AR(1) model of the rest. It gives the values of all the paths at each
 * hour of the horizon. A path draws again, at random, the errors that the model made on the history.
 */
function forecast(history: readonly number[], horizon: number, seed: number): Float64Array[] {
    const n = history.length, days = n / DAY, mid = (days - 1) / 2
    // The trend: a line through the mean of each day, by least squares. The mean of a whole day has no daily shape in it.
    const dayMean = Array.from({ length: days }, (_, d) => history.slice(d * DAY, (d + 1) * DAY).reduce((a, b) => a + b, 0) / DAY)
    const slope = dayMean.reduce((sum, v, d) => sum + (d - mid) * v, 0) / dayMean.reduce((sum, _, d) => sum + (d - mid) ** 2, 0) / DAY
    // The shape of a day, with the level: the mean of each hour, with the trend taken out.
    const shape = Array.from({ length: DAY }, (_, hour) => {
        let sum = 0
        for (let t = hour; t < n; t += DAY) sum += history[t]! - slope * t
        return sum / days
    })
    const fitted = (t: number) => slope * t + shape[t % DAY]!
    // What is left keeps a part of its last value. The error of one step is the part that the model did not know.
    const rest = history.map((y, t) => y - fitted(t))
    let num = 0, den = 0
    for (let t = 1; t < n; t++) {
        num += rest[t]! * rest[t - 1]!
        den += rest[t - 1]! ** 2
    }
    const keep = num / den
    const errors = rest.slice(1).map((r, i) => r - keep * rest[i]!)
    // A possible future: at each hour, the model plus one of its past errors, drawn at random.
    const random = seededRandom(seed)
    const model = Float64Array.from({ length: horizon }, (_, h) => fitted(n + h))
    const hours = Array.from({ length: horizon }, () => new Float64Array(PATHS))
    for (let path = 0; path < PATHS; path++) {
        let r = rest[n - 1]!
        for (let h = 0; h < horizon; h++) {
            r = keep * r + errors[Math.floor(random() * errors.length)]!
            hours[h]![path] = model[h]! + r
        }
    }
    return hours
}

/** The two edges of a band at each hour: the band leaves `out` paths under it and `out` paths over it. */
function edges(hours: readonly Float64Array[], out: number): [low: number[], high: number[]] {
    const sorted = hours.map((values) => Float64Array.from(values).sort())
    return [sorted.map((values) => values[out]!), sorted.map((values) => values[PATHS - 1 - out]!)]
}

/** True when that band holds a value: more than `out` paths are at or under the value, and more than `out` are at or over it. */
function holds(values: Float64Array, y: number, out: number): boolean {
    let under = 0, over = 0
    for (let i = 0; i < values.length; i++) {
        if (values[i]! < y) under++
        else if (values[i]! > y) over++
    }
    return values.length - over > out && values.length - under > out
}

/** One run: the series, the paths of the forecast that is made at the end of its history, and the points of the truth that the wide band holds. */
function run(seed: number) {
    const series = metric(seed, HISTORY + HORIZON)
    const hours = forecast(series.slice(0, HISTORY), HORIZON, seed + 1)
    const held = series.slice(HISTORY).map((y, h) => holds(hours[h]!, y, WIDE_OUT))
    return { series, hours, held, count: held.filter(Boolean).length }
}

/** How far the nearest point of the truth is from an edge of the wide band. */
function room(seed: number): number {
    const made = run(seed), [low, high] = edges(made.hours, WIDE_OUT)
    return Math.min(...made.series.slice(HISTORY).map((y, h) => Math.min(Math.abs(y - low[h]!), Math.abs(y - high[h]!))))
}

// The count of each of the 1,000 runs, and the run of the film: the first one with the median count and with clear points.
const COUNTS = Array.from({ length: RUNS }, (_, i) => run(i + 1).count)
const MEDIAN_COUNT = [...COUNTS].sort((a, b) => a - b)[RUNS / 2]!
const SEED = 1 + COUNTS.findIndex((count, i) => count === MEDIAN_COUNT && room(i + 1) >= CLEAR)
const RUN = run(SEED)
const [WIDE_LOW, WIDE_HIGH] = edges(RUN.hours, WIDE_OUT), [HALF_LOW, HALF_HIGH] = edges(RUN.hours, HALF_OUT)
// The median is between the two middle paths.
const [UNDER_MIDDLE, OVER_MIDDLE] = edges(RUN.hours, PATHS / 2 - 1)
const MEDIAN = UNDER_MIDDLE.map((low, h) => (low + OVER_MIDDLE[h]!) / 2)
/** The share of all the points of the 1,000 runs that their wide bands hold. */
const SHARE = COUNTS.reduce((a, b) => a + b, 0) / (RUNS * HORIZON)

// ── What the film says, checked against the runs ────────────────────────────

function must(ok: boolean, what: string): void {
    if (!ok) throw new Error(`forecast film: ${what}`)
}
assertEqual(SEED, 79, 'the seed that the rule gives')
assertEqual(RUN.count, 43, 'the count of the points inside the wide band')
assertEqual(MEDIAN_COUNT, RUN.count, 'the median count of the 1,000 runs')
for (let h = 0; h < HORIZON; h++) {
    const paths = RUN.hours[h]!, y = RUN.series[HISTORY + h]!
    const share = (low: number, high: number) => paths.filter((value) => value >= low && value <= high).length / PATHS
    // In the first hour, two paths that drew the same error have the same value, so a band can hold a few paths more.
    must(Math.abs(share(HALF_LOW[h]!, HALF_HIGH[h]!) - 0.5) < 0.005, `the dark band holds half of the paths at hour ${h + 1}`)
    must(Math.abs(share(WIDE_LOW[h]!, WIDE_HIGH[h]!) - PROMISE) < 0.005, `the light band holds ${ofTen(PROMISE)} paths at hour ${h + 1}`)
    // The count and the picture agree: a point that the band holds is between the two edges that the film draws, and clear of them.
    must(RUN.held[h] === (y >= WIDE_LOW[h]! && y <= WIDE_HIGH[h]!), `the point of hour ${h + 1} is counted on the side of the band where it is drawn`)
    must(Math.min(Math.abs(y - WIDE_LOW[h]!), Math.abs(y - WIDE_HIGH[h]!)) >= CLEAR, `the point of hour ${h + 1} is clear of the edges of the wide band`)
}
must(WIDE_HIGH[0]! - WIDE_LOW[0]! < WIDE_HIGH[11]! - WIDE_LOW[11]!, 'the band is wider at 12 hours than at 1 hour')
// The wide band says 9 of 10. Over the 1,000 runs it holds a little less than it says.
must(SHARE > 0.85 && SHARE < PROMISE, `over ${RUNS} runs the wide band holds ${(100 * SHARE).toFixed(1)} of 100 points`)

// ── The picture ─────────────────────────────────────────────────────────────

// The x axis is in days. Point i of the series is at day (i + 1) / 24, so the forecast is made at day 28.
const NOW = HISTORY / DAY
const PAST = 3, AHEAD = HORIZON / DAY
const START = NOW - 2
/** The points of a series with one value for each hour, from a day. */
const hourly = (values: ArrayLike<number>, firstDay: number): Vec[] => Array.from(values, (y, i) => [firstDay + i / DAY, y])
const MEASURED = hourly(RUN.series, 1 / DAY)
/** A line of the forecast. It starts at the last measured value, so a band opens from that point. */
const ahead = (values: ArrayLike<number>): Vec[] => [[NOW, RUN.series[HISTORY - 1]!], ...hourly(values, NOW + 1 / DAY)]
// Of the 1,000 paths, the film draws 30: the first 5 one after another, and then the rest together.
const DRAWN = 30, FIRST = 5
const FUTURES = Array.from({ length: DRAWN }, (_, path) => ahead(RUN.hours.map((values) => values[path]!)))
// The y range holds all that the film draws, on round numbers, so it never moves.
const VALUES = [...RUN.series.slice((START - PAST) * DAY), ...WIDE_LOW, ...WIDE_HIGH, ...FUTURES.flat().map(([, y]) => y)]
const LOW = Math.floor(Math.min(...VALUES) / 25) * 25, HIGH = Math.ceil(Math.max(...VALUES) / 25) * 25
// The two bands are one hue. The dark one is drawn over the light one.
const LIGHT = 0.22, DARK = 0.34
// Text sizes at 1080p: the numbers of the axes, the key and the source line, and then the marker and the counts.
const SMALL = 30, STRONG = 34
// Each run as the share of its 48 points that its wide band holds, of 10, for the last picture: one bar for each count.
const SHARES = COUNTS.map((count) => 10 * count / HORIZON)
const LEAST = Math.min(...COUNTS)
const MOST_RUNS = Math.max(...Array.from({ length: HORIZON + 1 }, (_, count) => COUNTS.filter((other) => other === count).length))

export default film({
    title: 'A forecast is a range',
    description: 'A metric scrolls to the present, a forecast opens as two bands, the truth arrives and is counted against them, and 1,000 runs show how often the band is right.',
    fps: 60,
    font: 'text-serif',
    bloom: 0.12,
}, (s) => {
    const { area, heading, source, label, note, display } = sceneKit({ size: 40, source: { size: SMALL } })

    /** The present, in days. The window follows it up to the day of the forecast, and then stays. */
    const now = s.value(START)
    const window = (): readonly [number, number] => {
        const at = Math.min(now.value, NOW)
        return [at - PAST, at + AHEAD]
    }
    /** How far each part of the forecast is drawn, as a share of the horizon. */
    const middle = s.value(0), few = s.value(0), many = s.value(0), dark = s.value(0), light = s.value(0)
    /** 1 when the run is over: the last point is then as small as the others, and the mark of the present is gone. */
    const over = s.value(0)
    const upTo = (share: () => number) => () => NOW + AHEAD * clamp(share())

    // ── Layout: one line of words, the picture, and one line for the key and the count ──

    const [words, picture, key] = area.rows([1, 12, 1], 'normal')
    // The name of the x axis is at the right end of the axis, so the chart leaves it room.
    const days = note('day')
    const chartRoom = new Box(picture.left, picture.top, picture.right - boxOf(days).width - GAP.tight, picture.bottom)
    const frame = (width: number, height: number) => {
        const made = axes({ x: window, y: [LOW, HIGH], width, height, xStep: 1, yStep: 50, labelSize: SMALL, tips: false })
        made.marker({ x: () => now.value, label: 'now', color: 'yellow', labelSize: STRONG, glow: 6 })
        return made
    }
    // The plot is lower than its region by what the axes draw over it and under it: the label of the marker, and the numbers.
    const around = boxOf(frame(chartRoom.width, chartRoom.height)).height - chartRoom.height
    const chart = place(fitted(chartRoom, (width) => frame(width, chartRoom.height - around)), chartRoom, 'left')
    beside(days, chart.world(window()[1], LOW), 'right', 'tight')
    must(CLEAR * chart.plotHeight / (HIGH - LOW) >= 2, 'a point that is clear of a band edge is 2 pixels or more from it')

    // The parts of the forecast, from the back to the front. Each one is drawn up to a share of the horizon.
    band(chart, ahead(WIDE_LOW), ahead(WIDE_HIGH), { from: NOW, to: upTo(() => light.value), fill: 'blue', opacity: LIGHT })
    band(chart, ahead(HALF_LOW), ahead(HALF_HIGH), { from: NOW, to: upTo(() => dark.value), fill: 'blue', opacity: DARK })
    const futures = FUTURES.map((points, i) => chart.plot(points, {
        from: NOW, to: upTo(() => (i < FIRST ? few.value * FIRST - i : many.value)), stroke: 'blue', width: 1.6,
    }).opacity(0.5))
    const median = chart.plot(ahead(MEDIAN), { from: NOW, to: upTo(() => middle.value), stroke: 'blue', width: 4.5, glow: 5 })
    // The metric is one line: its history, and then the truth that arrives.
    chart.plot(MEASURED, { to: () => now.value, stroke: 'ink', width: 3 })
    // Each point of the truth that has arrived, in the color of its side of the wide band.
    const arrived = () => clamp(Math.floor((now.value - NOW) * DAY + 1e-6), 0, HORIZON)
    chart.add(dynamic(() => {
        const marks: Node[] = [], count = arrived()
        for (let h = 0; h < count; h++) {
            const day = NOW + (h + 1) / DAY, at = chart.p(day, RUN.series[HISTORY + h]!)
            // A point is a little larger for the two hours after it lands.
            const fresh = clamp(1 - (now.value - day) * DAY / 2) * (1 - over.value)
            if (RUN.held[h]) marks.push(dot(4.5 + 3 * fresh, 'green').at(at))
            else marks.push(circle(13 + 6 * fresh, { stroke: 'red', width: 2.5 }).at(at), dot(7 + 3 * fresh, 'red').at(at).glow(8))
        }
        return marks
    }))
    chart.add(dynamic(() => dot(6, 'ink').at(chart.p(now.value, valueAt(MEASURED, now.value))).glow(10).opacity(1 - over.value)))

    // ── The words of the forecast ───────────────────────────────────────────

    const title = heading('A forecast is a range')
    const method = source('Method: Hyndman and Athanasopoulos, Forecasting: Principles and Practice (2021), section 5.5. Calibration: Gneiting et al., 2007.')
    const unit = place(note('requests per second'), words, 'right')
    const caption = (content: string) => place(label(content), words, 'left')
    const arrives = caption('A metric arrives, one point each hour.')
    const one = caption('One line is one answer.')
    const possible = caption('Past errors, drawn again at random, give many possible futures.')
    const range = caption(`The forecast is a range: a band for half of the paths, a band for ${ofTen(PROMISE)}.`)
    const truth = caption('Then time goes on. Each point of the truth is inside the wide band, or outside.')
    const luck = caption(`One run can be luck. Here is the same forecaster on ${commas(RUNS)} series.`)
    const thesis = caption('A good forecast is a narrow range that is right as often as it says.')
    // The question is alone on the empty side of the plot.
    const plot = new Box(...chart.world(window()[0], HIGH), ...chart.world(window()[1], LOW))
    const question = place(display('What comes next?'), plot.columns([PAST, AHEAD], 'none')[1]!)

    // The key: each entry has the color that its part has on the background.
    const tint = (share: number) => mixColor(parseColor('bg'), parseColor('blue'), share)
    const names = place(legend([
        { label: 'median', color: 'blue', kind: 'line' },
        { label: 'half of the paths', color: tint(1 - (1 - LIGHT) * (1 - DARK)) },
        { label: `${ofTen(PROMISE)} paths`, color: tint(LIGHT) },
    ], { size: SMALL }), key, 'left')
    const [nameMedian, nameDark, nameLight] = names.children
    for (const name of names.children) name.opacity(0)

    // The count changes when a point lands. At the end of the run it is a share of 10, as the promise is.
    const mono = (content: string, color = 'ink') => text(content, { font: 'mono', size: STRONG, color, anchor: 'right' })
    const countAt = key.point('right')
    const tally = dynamic(() => {
        const count = arrived(), held = RUN.held.slice(0, count).filter(Boolean).length
        return mono(`${String(held).padStart(2, ' ')} of ${String(count).padStart(2, ' ')} seen`).at(countAt)
    })
    const seen = mono(`${ofTen(RUN.count / HORIZON, 1)} seen`).at(countAt)
    const expected = beside(mono(`${ofTen(PROMISE)} expected,`, 'dim'), seen, 'left', 'normal')

    // ── The last picture: the 1,000 runs, one bar for each count ────────────

    const part = 10 / HORIZON
    const bars = (width: number, height: number) => histogram(SHARES, {
        width, height, bins: HORIZON - LEAST + 1, range: [(LEAST - 0.5) * part, (HORIZON + 0.5) * part],
        // The bars leave room over the highest one for the two names.
        max: MOST_RUNS * 1.3, labelSize: SMALL, colors: [tint(0.62)],
    })
    // The bars are lower than the picture by the numbers under them. Their base line is at the bottom, so the room over the bars is inside the picture too.
    const trial = bars(picture.width, picture.height)
    const under = boxOf(trial).bottom - trial.p(0, 0)[1]
    const runs = place(fitted(picture, (width) => bars(width, picture.height - under)), picture, 'bottom')
    const axisName = place(note(`points inside the wide band, of 10, in each of the ${commas(RUNS)} runs`), key, 'left')
    const runCount = dynamic(() => mono(`${commas(Math.round(runs.shown.value)).padStart(5, ' ')} runs`).at(countAt))
    // A line at a share, from the base of the bars to the top of the picture, with its name beside its top.
    const rule = (share: number, color: string, dash?: readonly number[]) => line(runs.toWorld(...runs.p(10 * share, 0)), runs.toWorld(...runs.p(10 * share, runs.peak)), { stroke: color, width: 3, dash })
    const promised = rule(PROMISE, 'blue', [8, 8]), measured = rule(SHARE, 'ink')
    const promisedName = beside(mono(`${ofTen(PROMISE)} expected`, 'blue'), promised, 'right', 'tight', 'top')
    const measuredName = beside(mono(`${ofTen(SHARE, 1)} seen`), measured, 'left', 'tight', 'top')

    // ── Timeline ────────────────────────────────────────────────────────────

    s.chapter('A metric arrives')
    s.at(0, () => s.play(write(title), fadeIn([chart, unit, days, method], { duration: 1 }), delay(fadeIn(arrives, { duration: 0.5 }), 0.7)))
    s.play(now.to(NOW, { ease: linear }), { duration: 9 })

    s.chapter('What comes next?')
    s.play(fadeOut(arrives, { duration: 0.4 }))
    s.play(fadeIn(question, { duration: 0.5 }))
    s.wait(2.6)
    s.play(fadeOut(question, { duration: 0.4 }))

    s.chapter('One line')
    s.add(names)
    s.play(fadeIn(one, { duration: 0.4 }), middle.to(1, { duration: 1.5 }), fade(nameMedian!, 1, { duration: 0.6 }))
    s.wait(1.2)
    s.play(fadeOut(one, { duration: 0.3 }), delay(fadeIn(possible, { duration: 0.4 }), 0.25), fade(median, 0.35, { duration: 0.6 }))
    s.play(few.to(1, { ease: linear }), { duration: 2.4 })
    s.play(many.to(1), { duration: 1 })
    s.wait(1.2)

    s.chapter('A range')
    s.play(fadeOut(possible, { duration: 0.3 }), delay(fadeIn(range, { duration: 0.4 }), 0.25), ...futures.map((path) => fade(path, 0.1, { duration: 0.8 })), fade(median, 1, { duration: 0.8 }))
    s.play(dark.to(1), fade(nameDark!, 1), { duration: 1.3 })
    s.wait(0.6)
    s.play(light.to(1), fade(nameLight!, 1), { duration: 1.3 })
    s.wait(1.6)

    s.chapter('The truth arrives')
    s.play(fadeOut(range, { duration: 0.3 }), delay(fadeIn(truth, { duration: 0.4 }), 0.25), ...futures.map((path) => fade(path, 0, { duration: 0.6 })), fadeIn(tally, { duration: 0.6 }))
    s.play(now.to(NOW + AHEAD, { ease: linear }), { duration: 10 })
    s.play(over.to(1), { duration: 0.6 })
    s.play(fadeOut(tally, { duration: 0.3 }), delay(fadeIn([expected, seen], { duration: 0.5 }), 0.25))
    s.wait(2)

    s.chapter('A thousand runs')
    // A cut: the forecast leaves, and the base line of the bars arrives as it goes.
    s.play(fadeOut([truth, chart, days, unit, names, expected, seen], { duration: 0.5 }), delay(fadeIn(luck, { duration: 0.4 }), 0.35), delay(fadeIn([runs, axisName, runCount], { duration: 0.5 }), 0.4))
    s.play(runs.fillUp({ ease: linear }), { duration: 3 })
    s.play(draw(promised), fadeIn(promisedName), { duration: 0.7 })
    s.play(draw(measured), fadeIn(measuredName), { duration: 0.7 })
    s.wait(1.2)

    s.chapter('As often as it says')
    s.play(fadeOut(luck, { duration: 0.3 }), delay(fadeIn(thesis, { duration: 0.6 }), 0.25))
    s.wait(3.6)
})
