/**
 * A short presentation, played one chapter at a time with
 * <vz-film src="..." stepped>. The arrow keys move between slides, and each slide
 * builds with its own motion. The speed figures were measured on this repository:
 * a 234-frame 720p film took 64.84 s on the old path, about 3.6 frames per second,
 * and a 955-frame 1080p film on this engine rendered at 72.4 frames per second.
 */
import {
    Node, arrow, dot, dynamic, draw, fadeIn, fadeOut, film, line, linear, lagged, rect, seq, smoother, text, tex, write,
    type ColorInput,
} from 'vizmatic/stage'

const LEFT = -820
const OLD_FPS = 3.6
const NEW_FPS = 72.4
const OLD_PIXELS = 1280 * 720
const NEW_PIXELS = 1920 * 1080

function place<T extends Node>(node: T, x: number, y: number): T {
    node.at(x + node.bounds().width / 2, y)
    return node
}

export default film({
    title: 'Why we rebuilt the renderer',
    description: 'A six-step talk that plays one chapter at a time, with a timeline you can see and a measured result.',
    fps: 60,
    look: 'paper',
}, (s) => {
    const heading = (content: string) => place(text(content, { font: 'text-serif', size: 72 }), LEFT, -370)
    const kicker = (content: string) => place(text(content, { size: 20, color: 'dim', uppercase: true, tracking: 0.1, weight: 600 }), LEFT, -446)
    const pageNumber = s.value(2)
    const pageMark = dynamic(() => {
        const label = text(`${Math.round(pageNumber.value)} / 6`, { font: 'mono', size: 20, color: 'dim' })
        return label.at(820 - label.bounds().width / 2, 480)
    })
    const footerRule = line([LEFT, 446], [820, 446], { stroke: 'grid', width: 1.3 })
    const footerName = place(text('Why we rebuilt the renderer', { size: 20, color: 'dim' }), LEFT, 480)

    // ── 1. Title ────────────────────────────────────────────────────────────

    s.chapter('Title')
    const lead = place(text('Engineering review', { size: 24, color: 'dim', uppercase: true, tracking: 0.1, weight: 600 }), LEFT, -220)
    const big = text('Drawing a frame should not mean laying out a page.', { font: 'text-serif', size: 116, maxWidth: 1400, leading: 1.02 })
    big.alignTo([LEFT, 0], 'left').alignTo([0, -170], 'top')
    const underline = line([LEFT, 220], [LEFT + 340, 220], { stroke: 'teal', width: 5 })
    s.play(fadeIn(lead, { shift: [0, 10] }), write(big), { duration: 2.2 })
    s.play(draw(underline), { duration: 0.7 })
    s.wait(0.3)

    // ── 2. The problem ──────────────────────────────────────────────────────

    s.chapter('The problem')
    s.play(fadeOut([lead, big, underline], { shift: [0, -30] }), { duration: 0.6 })
    const k2 = kicker('The problem'), h2 = heading('Every frame repeated all of the work.')
    s.add(footerRule, footerName)
    s.play(fadeIn([k2, footerName, footerRule, pageMark]), write(h2), { duration: 1.2 })
    const stages = ['TSX', 'React tree', 'Flex layout', 'SVG text', 'Rasterize', 'Encode']
    const stageWidth = 216, stageGap = 58, top = -200
    const nodes = stages.map((name, i) => {
        const x = LEFT + i * (stageWidth + stageGap)
        const chip = rect(stageWidth, 96, { fill: 'surface', stroke: i < 5 ? 'gridStrong' : 'grid', width: 1.6, radius: 8 }).at(x + stageWidth / 2, top + 48)
        const label = text(name, { size: 27, weight: 600 }).moveTo([x + stageWidth / 2, top + 48])
        return new Node().add(chip, label)
    })
    const links = stages.slice(1).map((_, i) => {
        const x = LEFT + i * (stageWidth + stageGap) + stageWidth
        return arrow([x + 6, top + 48], [x + stageGap - 6, top + 48], { stroke: 'dim', width: 2.2, tip: 12 })
    })
    const cycle = new Node().add(
        line([LEFT + 2, top + 118], [LEFT + 2, top + 150], { stroke: 'red', width: 3 }),
        line([LEFT + 2, top + 150], [LEFT + 4 * (stageWidth + stageGap) + stageWidth, top + 150], { stroke: 'red', width: 3 }),
        line([LEFT + 4 * (stageWidth + stageGap) + stageWidth, top + 150], [LEFT + 4 * (stageWidth + stageGap) + stageWidth, top + 118], { stroke: 'red', width: 3 }),
    )
    const cycleLabel = place(text('Repeated for every frame', { size: 26, color: 'red' }), LEFT + 14, top + 184)
    s.play(lagged(nodes.map((node) => fadeIn(node, { shift: [0, 14] })), { lag: 0.22 }), lagged(links.map((link) => fadeIn(link)), { lag: 0.22 }), { duration: 1.5 })
    s.play(draw(cycle, { lag: 0.2 }), fadeIn(cycleLabel), { duration: 0.9 })
    const costBig = text('277 ms', { font: 'mono', size: 150, color: 'red' })
    place(costBig, LEFT, 210)
    const costNote = place(text('per frame at 720p, or 3.6 frames per second.', { size: 34, color: 'dim' }), LEFT + costBig.bounds().width + 44, 228)
    s.play(fadeIn(costBig, { shift: [0, 16] }), fadeIn(costNote, { shift: [0, 16] }), { duration: 0.9 })
    s.wait(0.3)

    // ── 3. The idea ─────────────────────────────────────────────────────────

    s.chapter('The idea')
    s.play(fadeOut([k2, h2, ...nodes, ...links, cycle, cycleLabel, costBig, costNote], { shift: [0, -24] }), { duration: 0.6 })
    const k3 = kicker('The idea'), h3 = heading('Compile once. Sample anywhere.')
    pageNumber.set(3)
    s.play(fadeIn(k3), write(h3), { duration: 1.2 })
    // A real timeline: three tracks of keys, a playhead, and the picture they produce.
    const TRACK_X = LEFT, TRACK_W = 900, TRACK_TOP = -210, TRACK_H = 92
    const tracks: { name: string; color: ColorInput; keys: readonly [number, number][] }[] = [
        { name: 'x position', color: 'blue', keys: [[0.05, 0.3], [0.55, 0.9]] },
        { name: 'scale', color: 'teal', keys: [[0.25, 0.55], [0.7, 0.95]] },
        { name: 'color', color: 'pink', keys: [[0.1, 0.4], [0.6, 0.8]] },
    ]
    const trackNodes = new Node()
    tracks.forEach((track, i) => {
        const y = TRACK_TOP + i * TRACK_H
        trackNodes.add(place(text(track.name, { font: 'mono', size: 21, color: 'dim' }), TRACK_X, y - 28))
        trackNodes.add(line([TRACK_X, y], [TRACK_X + TRACK_W, y], { stroke: 'grid', width: 1.6 }))
        for (const [from, to2] of track.keys) {
            trackNodes.add(rect((to2 - from) * TRACK_W, 22, { fill: track.color, stroke: null, radius: 4 }).at(TRACK_X + ((from + to2) / 2) * TRACK_W, y).opacity(0.85))
        }
    })
    const playhead = s.value(0)
    const eased = (u: number) => u * u * (3 - 2 * u)
    const sampleTrack = (index: number, t: number): number => {
        let value = 0
        for (const [from, end] of tracks[index]!.keys) {
            const clipped = Math.max(0, Math.min(1, (t - from) / (end - from)))
            value += eased(clipped) * 0.5
        }
        return value
    }
    const head = dynamic(() => {
        const x = TRACK_X + playhead.value * TRACK_W
        const stamp = text(`t = ${(playhead.value * 4).toFixed(2)} s`, { font: 'mono', size: 20, color: 'ink' })
        stamp.at(x, TRACK_TOP + 3 * TRACK_H - 22)
        return [line([x, TRACK_TOP - 44], [x, TRACK_TOP + 2.5 * TRACK_H], { stroke: 'ink', width: 2.4 }), stamp]
    })
    const PIC_X = 250, PIC_W = 570
    const picture = dynamic(() => {
        const t = playhead.value
        const px = sampleTrack(0, t), scale = sampleTrack(1, t), tint = sampleTrack(2, t)
        const color: ColorInput = tint < 0.25 ? 'blue' : tint < 0.75 ? 'teal' : 'pink'
        return [
            rect(PIC_W, 300, { fill: 'surface', stroke: 'grid', width: 1.6, radius: 8 }).at(PIC_X + PIC_W / 2, TRACK_TOP + 110),
            dot(26 + 54 * scale, color).at(PIC_X + 60 + px * (PIC_W - 120), TRACK_TOP + 110),
        ]
    })
    const idea = place(text('A frame is a pure function of time, so playback can seek in any direction with no replay.', { size: 30, color: 'dim' }), LEFT, 210)
    s.play(fadeIn(trackNodes, { lag: 0.02 }), fadeIn(head), fadeIn(picture), { duration: 1 })
    s.play(seq(playhead.to(1, { ease: linear, duration: 2.6 }), playhead.to(0.34, { ease: smoother, duration: 1.2 }), playhead.to(0.76, { ease: smoother, duration: 1 })), { duration: 4.8 })
    s.play(fadeIn(idea, { shift: [0, 12] }), { duration: 0.7 })
    s.wait(0.3)

    // ── 4. The result ───────────────────────────────────────────────────────

    s.chapter('The result')
    s.play(fadeOut([k3, h3, trackNodes, head, picture, idea], { shift: [0, -24] }), { duration: 0.6 })
    const k4 = kicker('The result'), h4 = heading('Twenty times the speed, at higher resolution.')
    pageNumber.set(4)
    s.play(fadeIn(k4), write(h4), { duration: 1.2 })
    const BAR_X = LEFT + 370, BAR_W = 960, BAR_TOP = -200, SCALE = BAR_W / NEW_FPS
    const rows: { name: string; note: string; value: number; color: ColorInput; y: number }[] = [
        { name: 'Before', note: '720p, flex layout per frame', value: OLD_FPS, color: 'red', y: BAR_TOP },
        { name: 'After', note: '1080p, sampled vector frames', value: NEW_FPS, color: 'teal', y: BAR_TOP + 130 },
    ]
    const grow = s.value(0)
    const bars = dynamic(() => rows.flatMap((row) => {
        const width = Math.max(2, row.value * SCALE * grow.value)
        return [
            rect(width, 62, { fill: row.color, stroke: null, radius: 3 }).at(BAR_X + width / 2, row.y),
            place(text(`${(row.value * grow.value).toFixed(1)} fps`, { font: 'mono', size: 36, color: row.color === 'red' ? 'red' : 'ink' }), BAR_X + width + 20, row.y),
        ]
    }))
    const barLabels = new Node().add(...rows.flatMap((row) => [
        place(text(row.name, { size: 36, weight: 600 }), LEFT, row.y - 16),
        place(text(row.note, { size: 22, color: 'dim' }), LEFT, row.y + 22),
    ]))
    const speed = NEW_FPS / OLD_FPS
    const pixels = NEW_PIXELS / OLD_PIXELS
    const facts: [string, string][] = [
        [`${speed.toFixed(0)} times`, 'more frames each second'],
        [`${pixels.toFixed(2)} times`, 'the pixels in each frame'],
        [`${(speed * pixels).toFixed(0)} times`, 'the pixels per second, measured end to end'],
    ]
    const factNodes = facts.map(([value, note], i) => {
        const x = LEFT + i * 560
        return new Node().add(
            place(text(value, { font: 'text-serif', size: 86, color: 'ink' }), x, 150),
            place(text(note, { size: 26, color: 'dim' }), x, 226),
        )
    })
    const measured = place(text('Measured on two demo films on one 18-core laptop, in the same week.', { size: 20, color: 'faint' }), LEFT, 330)
    s.add(bars)
    s.play(fadeIn([barLabels, measured]), grow.to(1, { ease: smoother }), { duration: 2 })
    s.play(lagged(factNodes.map((node) => fadeIn(node, { shift: [0, 14] })), { lag: 0.3 }), { duration: 1.4 })
    s.wait(0.3)

    // ── 5. What it costs ────────────────────────────────────────────────────

    s.chapter('The tradeoff')
    s.play(fadeOut([k4, h4, bars, barLabels, measured, ...factNodes], { shift: [0, -24] }), { duration: 0.6 })
    const k5 = kicker('The tradeoff'), h5 = heading('Pixels stay. Layout moves to authoring.')
    pageNumber.set(5)
    s.play(fadeIn(k5), write(h5), { duration: 1.2 })
    const eq = tex('\\text{frame}(t) = \\text{paint}\\big(\\text{sample}(\\text{timeline}, t)\\big)', { size: 56 })
    eq.alignTo([LEFT, 0], 'left').alignTo([0, -220], 'top')
    const columns: [string, ColorInput, string][] = [
        ['Keep', 'teal', 'Diagrams and dashboards still lay out from TSX, and keep every check they had.'],
        ['Gain', 'blue', 'Live seeking in the browser, and the same pixels from Node for video.'],
        ['Pay', 'orange', 'Motion is authored as a timeline, so a frame cannot depend on the one before it.'],
    ]
    const cards = columns.map(([name, color, body], i) => {
        const x = LEFT + i * 560
        return new Node().add(
            line([x, -68], [x + 510, -68], { stroke: color, width: 4 }),
            place(text(name, { font: 'text-serif', size: 62 }), x, -16),
            (() => {
                const paragraph = text(body, { size: 30, color: 'dim', maxWidth: 500, leading: 1.4 })
                paragraph.alignTo([x, 0], 'left').alignTo([0, 44], 'top')
                return paragraph
            })(),
        )
    })
    s.play(write(eq), { duration: 1.3 })
    s.play(lagged(cards.map((node) => fadeIn(node, { shift: [0, 16] })), { lag: 0.3 }), { duration: 1.5 })
    s.wait(0.3)

    // ── 6. The end ──────────────────────────────────────────────────────────

    s.chapter('Next')
    s.play(fadeOut([k5, h5, eq, ...cards], { shift: [0, -24] }), { duration: 0.6 })
    const closing = text('Ship the film, not a screenshot.', { font: 'text-serif', size: 124, maxWidth: 1660, leading: 1.02 })
    closing.alignTo([LEFT, 0], 'left').alignTo([0, -190], 'top')
    const contact = place(text('This deck is one TypeScript file. Press the right arrow to step through it.', { size: 32, color: 'dim' }), LEFT, 210)
    pageNumber.set(6)
    s.play(write(closing), { duration: 2 })
    s.play(fadeIn(contact, { shift: [0, 10] }), { duration: 0.8 })
    s.wait(2)
})
