/**
 * Executive engineering presentation deck: "Why we rebuilt the renderer".
 *
 * Designed for both stepped slide-by-slide advancing (<vz-film stepped> / arrow keys)
 * and continuous 60 fps playback with zero blank transitions.
 * Benchmarks come from real repository measurements:
 *   - Legacy TSX per-frame layout (720p): 3.6 fps (277 ms/frame)
 *   - Stage keyed-track sampler (1080p): 72.4 fps (13.8 ms/frame) -> 20.1x fps, 45x pixels/s
 */
import {
    Node, assertEqual, barChart, codeBlock, column, draw, fadeIn, fadeOut, film,
    lagged, line, morphCode, pipeline, place, row, sceneKit, tagTrack, write,
} from 'vizmatic/stage'

// ── Measured repository benchmarks ──────────────────────────────────────────

const OLD_FPS = 3.6
const NEW_FPS = 72.4
const OLD_PIXELS = 1280 * 720
const NEW_PIXELS = 1920 * 1080

const FPS_SPEEDUP = Math.round((NEW_FPS / OLD_FPS) * 10) / 10
const PIXEL_SPEEDUP = Math.round((NEW_FPS * NEW_PIXELS) / (OLD_FPS * OLD_PIXELS))

assertEqual([FPS_SPEEDUP, PIXEL_SPEEDUP], [20.1, 45], 'measured frame-rate and pixel-rate speedups')

// ── Presentation Deck ───────────────────────────────────────────────────────

export default film({
    title: 'Why we rebuilt the renderer',
    description: 'Five-slide engineering review comparing per-frame flex layout against pure timeline track sampling.',
    fps: 60,
    look: 'paper',
    font: 'text-serif',
}, (s) => {
    const { area, heading, source, label, card, chip } = sceneKit({
        size: 40,
        heading: { size: 54 },
        source: { size: 28 },
        chip: { size: 28, font: 'mono' },
    })

    // Persistent editorial deck chrome so cross-slide transitions never leave a blank frame.
    const footRule = line([area.left, area.bottom + 18], [area.right, area.bottom + 18], {
        stroke: 'gridStrong',
        width: 1.5,
    })
    const footNote = source('Why we rebuilt the renderer · Engineering architecture review')
    const deckTagHolder = new Node()
    s.add(footRule, footNote, deckTagHolder)

    const [bodyBand, noteBand] = area.rows([6.4, 1.1], 'normal')

    // ── Slide 1: Thesis ─────────────────────────────────────────────────────

    const s1At = 0.05
    s.chapter('1. Thesis')
    s.caption('Drawing a single video frame should not require laying out a document page from scratch.', 5.6)

    const kicker1 = chip('ENGINEERING REVIEW', { fill: 'surface', stroke: 'gridStrong', color: 'dim' })
    const heroTitle = label('Drawing a frame should not mean laying out a page.', {
        size: 68,
        anchor: 'left',
        align: 'left',
        maxWidth: 1560,
        leading: 1.12,
    })
    const accentRule = line([0, 0], [360, 0], { stroke: 'teal', width: 5 })
    const subThesis = label('Why we separated one-time compilation from per-frame sampling.', {
        size: 34,
        color: 'dim',
        anchor: 'left',
    })

    const slide1Group = column([kicker1, heroTitle, accentRule, subThesis], { gap: 34, align: 'left' })
    place(slide1Group, area, 'left')

    s.play(
        fadeIn(kicker1, { shift: [0, 12], duration: 0.6 }),
        write(heroTitle, { duration: 1.3 }),
    )
    s.play(
        draw(accentRule, { duration: 0.55 }),
        fadeIn(subThesis, { shift: [0, 12], duration: 0.65 }),
    )
    s.wait(3.5)

    // ── Slide 2: Pipeline architecture ──────────────────────────────────────

    const s2At = s.time
    s.chapter('2. Architecture')
    s.caption('A film function runs once to build keyed tracks; any frame f of t is then sampled directly.', 7.0)

    s.play(fadeOut([kicker1, heroTitle, accentRule, subThesis], { shift: [0, -22], duration: 0.5 }))

    const h2 = heading('Compile once into tracks. Sample any frame f(t).')
    const archPipe = pipeline(
        ['Film function', 'Keyed tracks', 'Any frame f(t)'],
        {
            width: 1500,
            lanes: 2,
            size: 30,
            itemFont: 'mono',
            color: 'teal',
        },
    )
    place(archPipe, bodyBand, 'center')
    const note2 = place(
        label('No per-frame flex layout: every frame is a pure lookup.', { size: 32, color: 'dim' }),
        noteBand,
        'left',
    )

    s.play(
        fadeIn(h2, { shift: [0, 12], duration: 0.6 }),
        archPipe.enter({ duration: 0.9 }),
        fadeIn(note2, { duration: 0.7 }),
    )
    s.play(
        archPipe.put([
            { id: 't = 0.40s', color: 'teal', lane: 0 },
            { id: 't = 8.25s', color: 'blue', lane: 1 },
        ], { duration: 0.65 }),
    )
    s.play(archPipe.move(['t = 0.40s', 't = 8.25s'], 'Keyed tracks', { duration: 0.85 }))
    s.play(archPipe.move(['t = 0.40s', 't = 8.25s'], 'Any frame f(t)', { duration: 0.85 }))
    s.play(archPipe.pass(['t = 0.40s', 't = 8.25s'], { duration: 0.55 }))
    s.wait(1.4)
    s.play(archPipe.exit(['t = 0.40s', 't = 8.25s'], { duration: 0.65 }))
    s.wait(2.2)

    // ── Slide 3: Authoring model (codeBlock + morphCode) ────────────────────

    const s3At = s.time
    s.chapter('3. Authoring')
    s.caption('Instead of re-running layout inside a frame loop, authors compose timelines that morph cleanly.', 7.4)

    s.play(fadeOut([h2, archPipe, note2], { shift: [0, -20], duration: 0.5 }))

    const h3 = heading('Author timelines, not per-frame layout loops.')
    const oldSnippet = [
        '// Legacy loop: full layout pass every frame',
        'for (let f = 0; f < totalFrames; f++) {',
        '  renderFlexPage(stateAtFrame(f))',
        '}',
    ].join('\n')

    const newSnippet = [
        '// Stage: compile tracks once, sample any f(t)',
        'export default film({ fps: 60 }, (s) => {',
        '  s.play(fadeIn(chart), morphMatching(a, b))',
        '})',
    ].join('\n')

    const codeBefore = codeBlock(oldSnippet, { size: 30, minWidth: 1220, padding: 30 })
    const codeAfter = codeBlock(newSnippet, { size: 30, minWidth: 1220, padding: 30 })
    place(codeBefore, bodyBand, 'center')
    place(codeAfter, bodyBand, 'center')

    const note3 = place(
        label('Seeking to 40.0 s costs the same as seeking to 0.1 s.', { size: 32, color: 'dim' }),
        noteBand,
        'left',
    )

    s.play(
        fadeIn(h3, { shift: [0, 12], duration: 0.6 }),
        fadeIn(codeBefore, { shift: [0, 14], duration: 0.85 }),
        fadeIn(note3, { duration: 0.7 }),
    )
    s.wait(1.6)
    s.play(morphCode(codeBefore, codeAfter, { duration: 1.15 }))
    s.wait(2.8)

    // ── Slide 4: Measured throughput (barChart) ─────────────────────────────

    const s4At = s.time
    s.chapter('4. Benchmark')
    s.caption('End-to-end rendering jumped from three point six frames per second to seventy-two point four.', 6.8)

    s.play(fadeOut([h3, codeAfter, note3], { shift: [0, -20], duration: 0.5 }))

    const h4 = heading('20.1x faster frames, 45x more pixels per second.')
    const speedBars = barChart(
        [
            { label: '720p flex layout', value: OLD_FPS, color: 'orange' },
            { label: '1080p track sampler', value: NEW_FPS, color: 'teal' },
        ],
        {
            horizontal: true,
            width: 1080,
            height: 250,
            max: 85,
            labelSize: 30,
            showValues: true,
            states: true,
            format: (v) => `${v.toFixed(1)} fps`,
        },
    )
    place(speedBars, bodyBand, 'center')

    const note4 = place(
        label('Measured on this repo: 277 ms/frame at 720p down to 13.8 ms/frame at 1080p.', { size: 32, color: 'dim' }),
        noteBand,
        'left',
    )

    s.play(
        fadeIn(h4, { shift: [0, 12], duration: 0.6 }),
        speedBars.enter({ duration: 1.0 }),
        fadeIn(note4, { duration: 0.7 }),
    )
    s.play(speedBars.mark('1080p track sampler', 'chosen', { duration: 0.65 }))
    s.wait(3.8)

    // ── Slide 5: Tradeoffs & verdict (three editorial cards) ────────────────

    const s5At = s.time
    s.chapter('5. Tradeoffs')
    s.caption('Static TSX figures stay untouched, while motion gains deterministic tracks and instant scrubbing.', 7.0)

    s.play(fadeOut([h4, speedBars, note4], { shift: [0, -20], duration: 0.5 }))

    const h5 = heading('What we keep, what we gain, what we pay.')
    const keepCard = card({
        title: 'Keep',
        width: 540,
        height: 340,
        titleSize: 38,
        captionSize: 28,
        captionLines: 2,
        figure: chip('TSX + Satori', { fill: 'surface', stroke: 'gridStrong', color: 'ink' }),
        caption: 'Dense static diagrams and docs figures stay in TSX.',
    })
    const gainCard = card({
        title: 'Gain',
        width: 540,
        height: 340,
        titleSize: 38,
        captionSize: 28,
        captionLines: 2,
        color: 'teal',
        figure: chip('72.4 fps @ 1080p', { fill: 'teal', stroke: 'teal', color: 'bg' }),
        caption: 'Instant browser scrubbing and crisp 60 fps MP4s.',
    })
    const payCard = card({
        title: 'Pay',
        width: 540,
        height: 340,
        titleSize: 38,
        captionSize: 28,
        captionLines: 2,
        figure: chip('f(t) tracks', { fill: 'surface', stroke: 'orange', color: 'orange' }),
        caption: 'Motion is authored on explicit tracks, not hooks.',
    })

    place(row([keepCard, gainCard, payCard], { gap: 45, align: 'center' }), bodyBand, 'center')
    const note5 = place(
        label('Use arrow keys in stepped mode, or play straight through at 60 fps.', { size: 32, color: 'dim' }),
        noteBand,
        'left',
    )

    s.play(
        fadeIn(h5, { shift: [0, 12], duration: 0.6 }),
        lagged(
            [keepCard, gainCard, payCard].map((c) => fadeIn(c, { shift: [0, 18], duration: 0.7 })),
            { lag: 0.25 },
        ),
        fadeIn(note5, { duration: 0.7 }),
    )
    s.wait(4.2)

    deckTagHolder.add(
        tagTrack([
            { at: s1At, word: '1 / 5', note: 'Thesis' },
            { at: s2At, word: '2 / 5', note: 'Architecture' },
            { at: s3At, word: '3 / 5', note: 'Authoring' },
            { at: s4At, word: '4 / 5', note: 'Benchmark' },
            { at: s5At, word: '5 / 5', note: 'Tradeoffs' },
        ], {
            until: s.time + 1,
            size: 28,
            anchor: 'right',
            noteFont: 'text-serif',
        }).at(area.right, footNote.get('y')),
    )
})
