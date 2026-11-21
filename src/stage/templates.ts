/** Starter films for `vizmatic new`. Each one renders as written and passes `vizmatic check`. */
export interface FilmTemplate {
    readonly name: string
    readonly description: string
    /** The film, for a template of one file. */
    readonly source?: string
    /** For a template of many files: its folder under templates/ in the package. Its film file is film.ts. */
    readonly folder?: string
}

const explainer = `import { axes, colorAlong, dot, draw, dynamic, fadeIn, film, line, tex, text, to, write } from 'vizmatic/stage'

// One idea, shown as it changes: a secant line becomes a tangent.
export default film({ title: 'A limit you can see' }, (s) => {
    s.chapter('The curve')
    const title = s.add(text('A limit you can see', { font: 'serif', size: 72 }).at(0, -440))
    s.play(write(title))

    const plot = s.add(axes({ x: [-1, 4], y: [-1, 9], width: 1080, height: 660, grid: true, xLabel: 'x' }).at(-340, 60))
    s.play(draw(plot.grid, { lag: 0.02 }), draw(plot.lines), fadeIn(plot.numbers), { duration: 1.4 })
    const parabola = plot.plot((x) => x * x, { stroke: colorAlong('blue', 'teal', 'yellow'), width: 5, glow: 6 })
    s.play(draw(parabola))

    s.chapter('The secant')
    const h = s.value(2)
    const secant = s.add(dynamic(() => {
        const x = 1 + h.value
        const slope = 2 + h.value
        const y = (at: number) => 1 + slope * (at - 1)
        return [
            line(plot.world(0.2, y(0.2)), plot.world(3.2, y(3.2)), { stroke: 'yellow', width: 3.5 }),
            dot(9, 'teal').at(plot.world(1, 1)),
            dot(9, 'yellow').at(plot.world(x, x * x)),
        ]
    }))
    s.play(fadeIn(secant))

    const equation = s.add(tex('m = 2 + h', { size: 64 }).at(600, -120))
    s.play(write(equation))

    s.chapter('The limit')
    s.play(h.to(0.02, { duration: 4 }))
    s.play(to(equation, (e) => e.color('yellow').scale(1.15)))
    s.wait(1.5)
})
`

const equation = `import { fadeIn, film, indicate, morphMatching, tex, text, write } from 'vizmatic/stage'

// A derivation where each line grows out of the last one.
export default film({ title: 'Completing the square' }, (s) => {
    const label = s.add(text('Completing the square', { font: 'serif', size: 64 }).at(0, -380))
    s.play(fadeIn(label, { shift: [0, 16] }))

    let current = s.add(tex('x^2 + 6x + 5 = 0', { size: 84 }))
    s.play(write(current))
    s.wait(0.6)

    for (const next of [
        'x^2 + 6x = -5',
        'x^2 + 6x + 9 = 4',
        '(x + 3)^2 = 4',
        'x + 3 = \\\\pm 2',
        'x = -3 \\\\pm 2',
    ]) {
        const target = tex(next, { size: 84 })
        s.play(morphMatching(current, target))
        current = target
        s.wait(0.5)
    }

    s.play(indicate(current, { color: 'yellow', scale: 1.08 }))
    s.wait(1.5)
})
`

const architecture = `import { column, connector, draw, fadeIn, film, infoBox, lagged, place, row, sceneKit, write, zone } from 'vizmatic/stage'

// An engineering figure, not a slide: relational layout places every tier, box, and routed edge.
const { area, heading, source } = sceneKit({ size: 36 })

export default film({ title: 'The checkout read path' }, (s) => {
    const title = s.add(heading('The checkout read path'))
    const foot = s.add(source('Peak hour: 12.4k requests per second at the edge, p99 budget 180 ms'))
    s.play(write(title), fadeIn(foot))

    const box = (name: string, subtitle: string, accent: string, rows: readonly [string, string][]) =>
        infoBox({ title: name, subtitle, accent, size: 16, width: 224, rows: rows.map(([label, value]) => ({ label, value })) })

    const cdn = box('CDN', 'Fastly, 214 POPs', 'dim', [['hit rate', '91%'], ['p50', '18 ms'], ['edge', '12.4k rps']])
    const gateway = box('Gateway', 'Envoy, 24 pods', 'blue', [['role', 'auth + route'], ['p99', '9 ms'], ['load', '1.1k rps']])
    const cart = box('Cart', 'Go, 42 pods', 'teal', [['p99', '48 ms'], ['cpu', '61%'], ['load', '840 rps']])
    const pricing = box('Pricing', 'Rust, 18 pods', 'teal', [['p99', '22 ms'], ['cpu', '44%'], ['load', '790 rps']])
    const search = box('Search', 'Java, 30 pods', 'teal', [['p99', '96 ms'], ['cpu', '72%'], ['load', '310 rps']])
    const ranker = box('Ranker', 'Python, 12 GPUs', 'purple', [['p99', '71 ms'], ['gpu', '83%'], ['load', '310 rps']])
    const orders = box('Orders DB', 'Postgres 16', 'gold', [['topology', '1 + 3'], ['size', '2.8 TB'], ['lag', '40 ms']])
    const cache = box('Price cache', 'Redis 7', 'gold', [['hit rate', '97%'], ['ram', '64 GB'], ['p99', '2 ms']])
    const index = box('Search index', 'Vespa', 'gold', [['docs', '2.1 B'], ['nodes', '11'], ['p99', '38 ms']])
    const features = box('Feature store', 'ScyllaDB', 'gold', [['features', '900'], ['size', '18 TB'], ['p99', '6 ms']])

    const [edgeCol, serviceCol, storeCol] = area.inset(0, 18).columns([1.05, 2.1, 2.1], 68)
    place(column([cdn, gateway], { gap: 68 }), edgeCol!)
    place(row([column([cart, search], { gap: 68 }), column([pricing, ranker], { gap: 68 })], { gap: 68 }), serviceCol!)
    place(row([column([orders, index], { gap: 68 }), column([cache, features], { gap: 68 })], { gap: 68 }), storeCol!)

    const tiers = [
        zone([cdn, gateway], { title: 'Edge', padding: 24, titleSize: 22, borderWidth: 1.5, dash: true }),
        zone([cart, pricing, search, ranker], { title: 'Services', padding: 24, titleSize: 22, borderWidth: 1.5, dash: true }),
        zone([orders, cache, index, features], { title: 'Stores', padding: 24, titleSize: 22, borderWidth: 1.5, dash: true }),
    ]
    s.play(lagged(tiers.map((tier) => tier.enter()), { lag: 0.16 }))

    const routes = [
        connector(cdn, gateway, { label: '1.1k rps', labelSize: 14 }),
        connector(gateway, cart, { route: 'ortho', label: '840', labelSize: 14 }),
        connector(gateway, search, { route: 'ortho', label: '310', labelSize: 14 }),
        connector(cart, pricing, { label: '790', labelSize: 14 }),
        connector(search, ranker, { label: '310', labelSize: 14 }),
        connector(pricing, orders, { label: 'read 2 ms', labelSize: 14 }),
        connector(ranker, index, { label: 'ann 38 ms', labelSize: 14 }),
        connector(orders, cache, { label: 'miss 3%', labelSize: 14 }),
        connector(index, features, { label: 'join 6 ms', labelSize: 14 }),
    ]
    s.play(lagged(routes.map((edge) => draw(edge)), { lag: 0.1 }))

    s.chapter('A cache hit')
    for (const edgeIndex of [0, 1, 3, 5]) s.play(routes[edgeIndex]!.pulse({ color: 'yellow', duration: 0.5 }))
    s.chapter('A search')
    for (const edgeIndex of [0, 2, 4, 6, 8]) s.play(routes[edgeIndex]!.pulse({ color: 'teal', duration: 0.5 }))
    s.wait(1.5)
})
`

const chart = `import { barChart, fadeIn, film, indicate, place, sceneKit, write } from 'vizmatic/stage'

// Bars that arrive in order, placed inside the scene frame with the takeaway in the heading.
const { area, heading, source } = sceneKit({ size: 36 })

const data = [
    { label: 'Mon', value: 42, color: 'blue' },
    { label: 'Tue', value: 58, color: 'blue' },
    { label: 'Wed', value: 51, color: 'blue' },
    { label: 'Thu', value: 73, color: 'teal' },
    { label: 'Fri', value: 96, color: 'yellow' },
]

export default film({ title: 'Friday doubled Monday' }, (s) => {
    const title = s.add(heading('Friday doubled Monday'))
    const foot = s.add(source('Orders per minute across the weekday peak window'))
    s.play(write(title), fadeIn(foot))

    const bars = place(barChart(data, {
        width: area.width - 220,
        height: area.height - 180,
        max: 100,
        ticks: 4,
        showValues: true,
        labelSize: 28,
    }), area)
    s.play(bars.enter({ lag: 0.18 }))
    s.play(indicate(bars.bar(4), { color: 'yellow', scale: 1.04 }))
    s.wait(1.5)
})
`

const deck = `import { fadeIn, fadeOut, film, lagged, text, write, type Node } from 'vizmatic/stage'

// A presentation. Each chapter is a step: use \`vizmatic preview\` and press the arrow keys.
function points(items: readonly string[]): Node[] {
    return items.map((item, i) => text(item, { size: 38, color: 'dim', maxWidth: 1200 }).at(0, -60 + i * 90))
}

export default film({ title: 'Quarterly review' }, (s) => {
    const slides = [
        { title: 'What shipped', items: ['Faster checkout, with p95 down 38%', 'A new search index, live in two regions', 'Zero severity-one incidents'] },
        { title: 'What we learned', items: ['Most latency sat in two slow queries', 'Canary traffic caught every regression', 'On-call load tracks deploy size'] },
        { title: 'What comes next', items: ['Move orders to the new storage tier', 'Cut the deploy size in half', 'Publish the latency budget per team'] },
    ]
    for (const slide of slides) {
        s.chapter(slide.title)
        const heading = s.add(text(slide.title, { font: 'serif', size: 88 }).at(0, -280))
        s.play(write(heading))
        const body = points(slide.items)
        s.play(lagged(body.map((item) => fadeIn(item, { shift: [0, 18] })), { lag: 0.35 }))
        s.wait(2)
        s.play(fadeOut([heading, ...body], { shift: [0, -24] }))
    }
})
`

const story = `import { breathe, connector, draw, film, flowStream, metricTile, namedBox, place, popIn, row, sceneKit, slideIn, titleCard } from 'vizmatic/stage'

// A three-act product and metrics story built with high-level choreography helpers.
const { area, heading, source } = sceneKit({ size: 36 })

export default film({ title: 'Zero-copy pipeline launch' }, (s) => {
    // Act 1: Cinematic opening title card
    s.chapter('Opening')
    const opener = titleCard('Zero-Copy Pipelines', {
        eyebrow: 'Release 2.0',
        subtitle: 'Hardware-accelerated frames from vector stage to MP4',
        accent: 'teal',
    })
    s.play(opener.enter())
    s.wait(1.0)
    s.clear()

    // Act 2: Architecture flow with animated signal streams and camera focus
    s.chapter('Pipeline')
    const title = heading('Every stage stays on the GPU')
    const foot = source('Measured on 1080p60 dark bloom scenes with hardware H.264')
    s.play(slideIn(title, { from: 'left', distance: 28 }), slideIn(foot, { from: 'bottom', distance: 16 }))

    const stages = [
        namedBox('Vector Stage', { width: 320, height: 120, color: 'blue', sub: '2D paths + SDF' }),
        namedBox('WebGL2 Bloom', { width: 320, height: 120, color: 'teal', sub: 'Float32 direct' }),
        namedBox('Media Engine', { width: 320, height: 120, color: 'yellow', sub: 'H.264 hardware' }),
    ]
    place(row(stages, { gap: 130 }), area)
    s.stagger(stages, (node) => popIn(node), { lag: 0.18 })

    const edges = [
        connector(stages[0]!, stages[1]!, { label: 'texSubImage2D', labelSize: 18 }),
        connector(stages[1]!, stages[2]!, { label: 'VideoFrame', labelSize: 18 }),
    ]
    s.stagger(edges, (edge) => draw(edge), { lag: 0.2 })
    s.play(flowStream(edges[0]!, { count: 3, color: 'teal' }), flowStream(edges[1]!, { count: 3, color: 'yellow' }))

    s.focus(stages[1]!, { zoom: 1.45, duration: 0.9 })
    s.play(breathe(stages[1]!, { scale: 1.05, duration: 1.0 }))
    s.resetView({ duration: 0.8 })
    s.clear({ keep: [title, foot] })

    // Act 3: Animated KPI summary tiles
    s.chapter('Results')
    const tiles = [
        metricTile({ label: 'Export speed', value: 32.1, digits: 1, suffix: ' fps', delta: '2.1x faster', color: 'teal' }),
        metricTile({ label: 'GPU 4x blur', value: 25.1, digits: 1, suffix: ' fps', delta: '2.6x total', color: 'blue' }),
        metricTile({ label: 'Browser hero', value: 60, suffix: ' fps', delta: 'Direct WebGL2', color: 'yellow' }),
    ]
    place(row(tiles, { gap: 64 }), area)
    s.stagger(tiles, (tile) => tile.enter(), { lag: 0.22 })
    s.wait(1.5)
})
`

export const FILM_TEMPLATES: readonly FilmTemplate[] = [
    { name: 'explainer', description: 'A graph, a moving value, and an equation, in three chapters.', source: explainer },
    { name: 'equation', description: 'A step-by-step derivation that morphs glyph by glyph.', source: equation },
    { name: 'architecture', description: 'Services with live detail, and packets traveling along the edges.', source: architecture },
    { name: 'chart', description: 'Bars that grow in order, with the takeaway as the title.', source: chart },
    { name: 'deck', description: 'A stepped presentation with one chapter per slide.', source: deck },
    { name: 'story', description: 'A three-act launch story with title card, signal streams, camera focus, and animated KPI tiles.', source: story },
    { name: 'narrated', description: 'A folder for a film that follows a recorded voice: a script, two scenes, and the build.', folder: 'narrated' },
]
