/**
 * Greedy decoding (k = 1) versus beam search (k = 2) in cumulative log-probability space.
 *
 * At step 1, "the" (-0.4) scores slightly higher than "a" (-0.6). Greedy follows "the"
 * alone, leaving "a" unexpanded, and gets trapped in a weak continuation:
 *   "Give the best guess"  ->  -0.4 + (-1.3) + (-1.7) = -3.4
 * Beam search with width k = 2 keeps both "the" (-0.4) and "a" (-0.6), expands "a", prunes
 * dead branches at each depth, and discovers the globally stronger sequence:
 *   "Give a clear proof"   ->  -0.6 + (-0.5) + (-0.8) = -1.9
 */
import {
    Node, assertEqual, barChart, column, fadeIn, fadeOut, film, indicate, place,
    sceneKit, seq, spotlight, tagTrack, tokens, tree, type TreeSpec,
} from 'vizmatic/stage'

// ── Search tree specification & cumulative log-prob invariants ──────────────

const SEARCH_TREE: TreeSpec = {
    id: 'root',
    label: 'Give',
    children: [
        {
            id: 'the',
            label: 'the',
            weight: -0.4,
            children: [
                {
                    id: 'best',
                    label: 'best',
                    weight: -1.3,
                    children: [
                        { id: 'guess', label: 'guess', weight: -1.7 },
                    ],
                },
                { id: 'old', label: 'old', weight: -1.8 },
            ],
        },
        {
            id: 'a',
            label: 'a',
            weight: -0.6,
            children: [
                {
                    id: 'clear',
                    label: 'clear',
                    weight: -0.5,
                    children: [
                        { id: 'proof', label: 'proof', weight: -0.8 },
                    ],
                },
                { id: 'rough', label: 'rough', weight: -1.9 },
            ],
        },
        { id: 'some', label: 'some', weight: -2.0 },
    ],
}

const fmtLogProb = (v: number): string => (Object.is(v, -0) || Math.abs(v) < 1e-9 ? '0.0' : v.toFixed(1))

function collectScores(node: TreeSpec, acc = 0, map = new Map<string, number>()): Map<string, number> {
    const next = acc + (node.weight ?? 0)
    if (node.id) map.set(node.id, Math.round(next * 10) / 10)
    for (const child of node.children ?? []) collectScores(child, next, map)
    return map
}

const SCORES = collectScores(SEARCH_TREE)
assertEqual(
    [
        SCORES.get('the'),
        SCORES.get('a'),
        SCORES.get('best'),
        SCORES.get('clear'),
        SCORES.get('guess'),
        SCORES.get('proof'),
    ],
    [-0.4, -0.6, -1.7, -1.1, -3.4, -1.9],
    'cumulative log-probability scores across greedy and beam paths',
)
assertEqual(
    SCORES.get('proof')! > SCORES.get('guess')!,
    true,
    'beam width k = 2 finds a higher-scoring sequence (-1.9) than greedy (-3.4)',
)

// ── Film ────────────────────────────────────────────────────────────────────

export default film({
    title: 'A beam keeps more than one path',
    description: 'Greedy decoding commits to the locally best token (-3.4), while beam search (k = 2) keeps two hypotheses and finds -1.9.',
    fps: 60,
    look: 'midnight',
    font: 'text-serif',
}, (s) => {
    const { area, heading, source, label } = sceneKit({
        size: 38,
        source: { size: 28 },
        chip: { size: 28, font: 'mono' },
    })

    const title = heading('A beam keeps more than one path')
    const foot = source('Cumulative log-probabilities sum along edges · closer to 0 is higher probability')
    const modeTagHolder = new Node()

    const [prefixBand, mainBand, captionBand] = area.rows([1.15, 6.0, 0.85], 'tight')
    const [treeCol, chartCol] = mainBand.columns([1.95, 1.0], 'normal')

    // ── Top prefix strips: Greedy (k = 1) vs Beam (k = 2) ───────────────────

    const prefixStates = {
        kept: {},
        trapped: { color: 'orange', fill: 0.28, mark: 'cross' as const },
        winner: { color: 'teal', fill: 0.30, mark: 'check' as const },
    }

    const [greedySlot, beamSlot] = prefixBand.columns([1, 1], 'normal')
    const greedyStrip = tokens(['Give'], {
        width: 780,
        size: 29,
        rowSize: 27,
        gap: 10,
        label: 'k=1',
        states: prefixStates,
    })
    const beamStrip = tokens(['Give'], {
        width: 780,
        size: 29,
        rowSize: 27,
        gap: 10,
        label: 'k=2',
        states: prefixStates,
    })
    place(greedyStrip, greedySlot, 'center')
    place(beamStrip, beamSlot, 'center')

    // ── Unified multi-step search tree ──────────────────────────────────────

    const searchTree = tree(SEARCH_TREE, {
        direction: 'right',
        score: 'sum',
        shown: 0,
        width: 1030,
        siblingGap: 102,
        labelSize: 28,
        valueSize: 27,
        edgeLabelSize: 27,
        format: fmtLogProb,
    })
    assertEqual(Math.round(searchTree.score('guess') * 10) / 10, -3.4, 'tree score at greedy leaf guess')
    assertEqual(Math.round(searchTree.score('proof') * 10) / 10, -1.9, 'tree score at beam leaf proof')
    place(searchTree, treeCol, 'center')

    // ── Side BarCharts: step-1 token log-probs & final sequence comparison ──

    const step1Title = label('Step-1 token log-prob', { size: 29, color: 'dim' })
    const step1Bars = barChart(
        [
            { label: 'the', value: Math.exp(-0.4), color: 'orange' },
            { label: 'a', value: Math.exp(-0.6), color: 'teal' },
            { label: 'some', value: Math.exp(-2.0), color: 'blue' },
        ],
        {
            width: 490,
            height: 290,
            max: 0.85,
            labelSize: 28,
            showValues: true,
            states: true,
            format: (p) => Math.log(Math.max(p, 1e-6)).toFixed(1),
        },
    )
    place(column([step1Title, step1Bars], { gap: 28, align: 'center' }), chartCol, 'center')

    const finalTitle = label('Completed sequence log-prob', { size: 29, color: 'dim' })
    const finalBars = barChart(
        [
            { label: 'a..proof', value: Math.exp(-1.9), color: 'teal' },
            { label: 'the..old', value: Math.exp(-2.2), color: 'blue' },
            { label: 'the..guess', value: Math.exp(-3.4), color: 'orange' },
        ],
        {
            width: 500,
            height: 290,
            max: 0.22,
            labelSize: 28,
            showValues: true,
            states: true,
            format: (p) => Math.log(Math.max(p, 1e-6)).toFixed(1),
        },
    )
    place(column([finalTitle, finalBars], { gap: 28, align: 'center' }), chartCol, 'center')

    // ── Stage subtitle helper ───────────────────────────────────────────────

    let activeNote: Node | null = null
    const setStageNote = (words: string) => {
        const next = place(label(words, { size: 32 }), captionBand, 'left')
        if (!activeNote) {
            activeNote = next
            s.add(next)
            return
        }
        const prev = activeNote
        activeNote = next
        s.play(seq(fadeOut(prev, { duration: 0.2 }), fadeIn(next, { duration: 0.3 })))
    }

    // ── Chapter 1: Greedy decoding (k = 1) gets trapped at -3.4 ─────────────

    s.add(title, foot, modeTagHolder)
    const ch1At = 0.2
    setStageNote('Greedy search (k = 1) picks locally highest "the" (-0.4) and ignores runner-up "a" (-0.6).')
    s.chapter('Greedy trap (k = 1)')
    s.caption('Greedy decoding keeps only one token at a time, choosing the locally highest score minus zero point four.', 5.4)

    s.play(
        greedyStrip.enter({ duration: 0.9 }),
        searchTree.enter({ duration: 0.9 }),
        fadeIn(step1Title, { duration: 0.8 }),
        step1Bars.enter({ duration: 1.0 }),
    )

    s.play(searchTree.grow(['the', 'a', 'some'], { duration: 1.3 }))
    s.play(
        searchTree.path('the', { color: 'orange', duration: 1.0 }),
        step1Bars.mark('the', 'chosen', { duration: 0.65 }),
        step1Bars.mark(['a', 'some'], 'masked', { duration: 0.65 }),
        greedyStrip.append('the', { from: step1Bars.bar(0), duration: 0.85 }),
    )
    s.wait(1.6)

    s.caption('Once locked into the, every continuation scores poorly, trapping greedy search at minus three point four.', 7.0)
    setStageNote('Locked into "the", every continuation drops sharply: "Give the best guess" ends at -3.4.')

    s.play(searchTree.grow(['best', 'old'], { duration: 1.1 }))
    s.play(
        searchTree.path('best', { color: 'orange', duration: 1.0 }),
        greedyStrip.append('best', { duration: 0.75 }),
    )
    s.wait(1.0)
    s.play(searchTree.grow(['guess'], { duration: 1.0 }))
    s.play(
        searchTree.path('guess', { color: 'orange', duration: 1.0 }),
        greedyStrip.append('guess', { duration: 0.75 }),
    )
    s.play(greedyStrip.mark([1, 2, 3], 'trapped', { duration: 0.7 }))
    s.wait(2.6)

    // ── Chapter 2: Beam search (k = 2) keeps "the" and "a", discovers -1.9 ──

    const ch2At = s.time
    s.chapter('Beam width k = 2')
    setStageNote('Beam search (k = 2) keeps both "the" (-0.4) and "a" (-0.6), pruning only "some" (-2.0).')
    s.caption('Beam search with k equals two keeps both the and the runner-up token a, pruning only some.', 5.6)

    s.play(
        beamStrip.enter({ duration: 0.85 }),
        step1Bars.clearStates({ duration: 0.5 }),
    )
    s.play(
        searchTree.prune('some', { duration: 0.8 }),
        step1Bars.mark(['the', 'a'], 'chosen', { duration: 0.65 }),
        step1Bars.mark('some', 'masked', { duration: 0.65 }),
    )
    s.play(searchTree.path(['the', 'a'], { color: 'teal', duration: 1.0 }))
    s.wait(1.6)

    s.caption('Expanding a reveals clear at minus one point one, overtaking the best at minus one point seven.', 6.4)
    setStageNote('Step 2: expanding "a" uncovers "a -> clear" (-1.1), overtaking "the -> best" (-1.7).')

    s.play(searchTree.grow(['clear', 'rough'], { duration: 1.2 }))
    s.play(
        searchTree.prune('old', { duration: 0.75 }),
        searchTree.prune('rough', { duration: 0.75 }),
    )
    s.play(searchTree.path(['clear', 'best'], { color: 'teal', duration: 1.0 }))
    s.wait(1.6)

    // Swap right chart to completed path scores as step 3 expands "clear" -> "proof" (-1.9).
    s.play(fadeOut([step1Title, step1Bars], { duration: 0.55 }))
    s.play(
        fadeIn(finalTitle, { duration: 0.65 }),
        finalBars.enter({ duration: 0.95 }),
        searchTree.grow(['proof'], { duration: 1.1 }),
    )

    const ch3At = s.time
    s.chapter('Winning path (-1.9)')
    setStageNote('Winner: "Give a clear proof" reaches -1.9 total log-prob, beating greedy (-3.4) by +1.5.')
    s.caption('At step three, keep selects Give a clear proof at minus one point nine and prunes the greedy trap.', 7.2)

    // Frontier is now ['guess', 'proof']: keep('proof') prunes the entire 'the -> best -> guess' trap!
    s.play(
        searchTree.keep('proof', { color: 'yellow', duration: 1.1 }),
        finalBars.mark('a..proof', 'chosen', { duration: 0.65 }),
        finalBars.mark('the..guess', 'masked', { duration: 0.65 }),
        beamStrip.append(['a', 'clear', 'proof'], { duration: 1.3, lag: 0.4 }),
    )
    s.play(
        searchTree.setState('proof', 'done', { duration: 0.7 }),
        beamStrip.mark([1, 2, 3], 'winner', { duration: 0.7 }),
        indicate(finalBars.bar(0), { color: 'yellow', scale: 1.06, duration: 1.0 }),
    )

    s.play(
        spotlight([searchTree, beamStrip, finalBars], {
            keep: [title, foot, modeTagHolder, greedyStrip, finalTitle, activeNote!],
            duration: 0.8,
        }),
    )
    s.wait(2.8)
    s.play(spotlight(null, { duration: 0.6 }))
    s.wait(2.6)

    modeTagHolder.add(
        tagTrack([
            { at: ch1At, word: 'GREEDY k = 1', note: 'trapped at -3.4' },
            { at: ch2At, word: 'BEAM k = 2', note: 'keep top 2' },
            { at: ch3At, word: 'OPTIMUM', note: 'proof = -1.9' },
        ], {
            until: s.time + 1,
            size: 28,
            anchor: 'right',
            noteFont: 'text-serif',
        }).at(area.right, title.get('y')),
    )
})
