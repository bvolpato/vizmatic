/**
 * Normalized toy model: P(the,a,some) = (0.5,0.4,0.1).
 * P(best,old | the) = (0.6,0.4); P(clear,rough | a) = (0.9,0.1).
 * P(guess | the best) = 0.6; P(proof | a clear) = 0.9.
 * Each final expansion has one omitted alternative with the remaining mass.
 * At a fixed three-token horizon, greedy scores log(0.18) and beam scores log(0.324).
 * This example does not claim beam search is globally optimal in general.
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
            weight: Math.log(0.5),
            children: [
                {
                    id: 'best',
                    label: 'best',
                    weight: Math.log(0.6),
                    children: [
                        { id: 'guess', label: 'guess', weight: Math.log(0.6) },
                    ],
                },
                { id: 'old', label: 'old', weight: Math.log(0.4) },
            ],
        },
        {
            id: 'a',
            label: 'a',
            weight: Math.log(0.4),
            children: [
                {
                    id: 'clear',
                    label: 'clear',
                    weight: Math.log(0.9),
                    children: [
                        { id: 'proof', label: 'proof', weight: Math.log(0.9) },
                    ],
                },
                { id: 'rough', label: 'rough', weight: Math.log(0.1) },
            ],
        },
        { id: 'some', label: 'some', weight: Math.log(0.1) },
    ],
}

const fmtLogProb = (v: number): string => (Object.is(v, -0) || Math.abs(v) < 1e-9 ? '0.0' : v.toFixed(1))

function collectScores(node: TreeSpec, acc = 0, map = new Map<string, number>()): Map<string, number> {
    const next = acc + (node.weight ?? 0)
    if (node.id) map.set(node.id, next)
    for (const child of node.children ?? []) collectScores(child, next, map)
    return map
}

const SCORES = collectScores(SEARCH_TREE)
// The two leaf expansions omit one lower-probability alternative each.
const omittedMass: Record<string, number> = { best: 0.4, clear: 0.1 }
function checkDistribution(node: TreeSpec): void {
    if (!node.children?.length) return
    const mass = node.children.reduce((sum, child) => sum + Math.exp(child.weight!), 0) + (omittedMass[node.id!] ?? 0)
    assertEqual(Math.abs(mass - 1) < 1e-12, true, 'conditional probabilities sum to one')
    for (const child of node.children) checkDistribution(child)
}
checkDistribution(SEARCH_TREE)
assertEqual(['the', 'a', 'some'].sort((a, b) => SCORES.get(b)! - SCORES.get(a)!).slice(0, 2), ['the', 'a'], 'first beam frontier')
assertEqual(['best', 'old', 'clear', 'rough'].sort((a, b) => SCORES.get(b)! - SCORES.get(a)!).slice(0, 2), ['clear', 'best'], 'second beam frontier')
assertEqual(Math.abs(Math.exp(SCORES.get('guess')!) - 0.18) < 1e-12, true, 'greedy sequence probability')
assertEqual(Math.abs(Math.exp(SCORES.get('proof')!) - 0.324) < 1e-12, true, 'beam sequence probability')
assertEqual(SCORES.get('proof')! > SCORES.get('guess')!, true, 'beam wins this fixed-length example')

// ── Film ────────────────────────────────────────────────────────────────────

export default film({
    title: 'A beam keeps more than one path',
    description: 'A normalized toy model: greedy ends at log(0.18), while beam search (k = 2) finds log(0.324).',
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
    const foot = source('Toy model · 3-token horizon · lower-ranked leaf alternatives omitted · natural log scores')
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
    assertEqual(Math.round(searchTree.score('guess') * 10) / 10, -1.7, 'tree score at greedy leaf guess')
    assertEqual(Math.round(searchTree.score('proof') * 10) / 10, -1.1, 'tree score at beam leaf proof')
    place(searchTree, treeCol, 'center')

    // ── Side BarCharts: step-1 token log-probs & final sequence comparison ──

    const step1Title = label('Step-1 token log-prob', { size: 29, color: 'dim' })
    const step1Bars = barChart(
        [
            { label: 'the', value: Math.exp(SCORES.get('the')!), color: 'orange' },
            { label: 'a', value: Math.exp(SCORES.get('a')!), color: 'teal' },
            { label: 'some', value: Math.exp(SCORES.get('some')!), color: 'blue' },
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
            { label: 'a..proof', value: Math.exp(SCORES.get('proof')!), color: 'teal' },
            { label: 'the..guess', value: Math.exp(SCORES.get('guess')!), color: 'orange' },
        ],
        {
            width: 500,
            height: 290,
            max: 0.4,
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

    // ── Chapter 1: Greedy decoding (k = 1) gets trapped at -1.7 ─────────────

    s.add(title, foot, modeTagHolder)
    const ch1At = 0.2
    setStageNote(`Greedy search (k = 1) picks locally highest "the" (${fmtLogProb(SCORES.get('the')!)}) and ignores runner-up "a" (${fmtLogProb(SCORES.get('a')!)}).`)
    s.chapter('Greedy trap (k = 1)')
    s.caption(`Greedy keeps one token: "the", with log-probability ${fmtLogProb(SCORES.get('the')!)}.`, 5.4)

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

    s.caption(`Greedy follows "the" and finishes with log-probability ${fmtLogProb(SCORES.get('guess')!)}.`, 7.0)
    setStageNote(`Locked into "the", every continuation drops sharply: "Give the best guess" ends at ${fmtLogProb(SCORES.get('guess')!)}.`)

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

    // ── Chapter 2: Beam search (k = 2) keeps "the" and "a", discovers -1.1 ──

    const ch2At = s.time
    s.chapter('Beam width k = 2')
    setStageNote(`Beam search (k = 2) keeps both "the" (${fmtLogProb(SCORES.get('the')!)}) and "a" (${fmtLogProb(SCORES.get('a')!)}), pruning only "some" (${fmtLogProb(SCORES.get('some')!)}).`)
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

    s.caption(`Expanding "a" reveals "clear" at ${fmtLogProb(SCORES.get('clear')!)}, ahead of "the best" at ${fmtLogProb(SCORES.get('best')!)}.`, 6.4)
    setStageNote(`Step 2: expanding "a" uncovers "a -> clear" (${fmtLogProb(SCORES.get('clear')!)}), overtaking "the -> best" (${fmtLogProb(SCORES.get('best')!)}).`)

    s.play(searchTree.grow(['clear', 'rough'], { duration: 1.2 }))
    s.play(
        searchTree.prune('old', { duration: 0.75 }),
        searchTree.prune('rough', { duration: 0.75 }),
    )
    s.play(searchTree.path(['clear', 'best'], { color: 'teal', duration: 1.0 }))
    s.wait(1.6)

    // Swap right chart to completed path scores as step 3 expands "clear" -> "proof" (-1.1).
    s.play(fadeOut([step1Title, step1Bars], { duration: 0.55 }))
    s.play(
        fadeIn(finalTitle, { duration: 0.65 }),
        finalBars.enter({ duration: 0.95 }),
        searchTree.grow(['proof'], { duration: 1.1 }),
    )

    const ch3At = s.time
    s.chapter(`Winning path (${fmtLogProb(SCORES.get('proof')!)})`)
    setStageNote(`Winner: "Give a clear proof" reaches ${fmtLogProb(SCORES.get('proof')!)} total log-prob, beating greedy (${fmtLogProb(SCORES.get('guess')!)}) by +${fmtLogProb(SCORES.get('proof')! - SCORES.get('guess')!)}.`)
    s.caption(`Beam selects "Give a clear proof" at ${fmtLogProb(SCORES.get('proof')!)}, ahead of greedy at ${fmtLogProb(SCORES.get('guess')!)}.`, 7.2)

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

    const endAt = s.time
    s.at(0, () => {
        modeTagHolder.add(
            tagTrack([
                { at: ch1At, word: 'GREEDY k = 1', note: `trapped at ${fmtLogProb(SCORES.get('guess')!)}` },
                { at: ch2At, word: 'BEAM k = 2', note: 'keep top 2' },
                { at: ch3At, word: 'WINNER', note: `proof = ${fmtLogProb(SCORES.get('proof')!)}` },
            ], {
                until: endAt + 1,
                size: 28,
                anchor: 'right',
                noteFont: 'text-serif',
            }).at(area.right, title.get('y')),
        )
    })
})
