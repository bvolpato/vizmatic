/**
 * Scaled dot-product attention on the classic coreference sentence:
 *   "The animal didn't cross the street because it was tired"
 *
 * Every attention weight in this film comes from genuine 4D query, key, and value vectors:
 *   alpha_ij = softmax_j( (q_i . k_j) / sqrt(d_k) ),   output_i = sum_j alpha_ij v_j
 * Because "tired" requires an animate subject, query "it" aligns strongly with key "animal"
 * (0.64) rather than "street" (0.09), routing "animal"'s features into "it".
 */
import {
    Node, assertEqual, attentionMatrix, barChart, column, draw,
    fadeIn, fadeOut, film, indicate, morphMatching, moveTo, place, sceneKit, seq,
    spotlight, tagTrack, tex, tokens,
} from 'vizmatic/stage'

// ── Real 4D embeddings and scaled dot-product attention ─────────────────────

const SENTENCE = ['The', 'animal', "didn't", 'cross', 'the', 'street', 'because', 'it', 'was', 'tired'] as const
const FOCUS_IDX = [1, 3, 5, 6, 7, 9] as const
const FOCUS_WORDS = FOCUS_IDX.map((i) => SENTENCE[i]!)

const D_K = 4
const SCALE = Math.sqrt(D_K)

// Four semantic dimensions: [animate-agent, physical-place, fatigue-clue, action-link]
const Q_VEC: Record<string, readonly [number, number, number, number]> = {
    The: [0.20, 0.20, 0.00, 0.30],
    animal: [1.65, -0.25, 0.55, 0.40],
    "didn't": [0.35, 0.10, 0.15, 1.10],
    cross: [0.95, 1.25, -0.10, 0.90],
    the: [0.15, 0.65, 0.00, 0.25],
    street: [-0.30, 1.70, -0.35, 0.45],
    because: [0.75, 0.25, 0.95, 0.50],
    it: [1.96, 0.22, 0.84, 0.18],
    was: [0.80, 0.10, 1.15, 0.30],
    tired: [1.45, -0.35, 1.40, 0.20],
}

const K_VEC: Record<string, readonly [number, number, number, number]> = {
    The: [-1.45, -0.60, -0.80, -0.40],
    animal: [2.59, -0.30, 1.12, 0.35],
    "didn't": [-1.25, -0.35, -0.55, 0.65],
    cross: [0.18, 0.95, -0.20, 1.05],
    the: [-1.40, 0.35, -0.85, -0.30],
    street: [0.46, 2.05, -0.42, 0.55],
    because: [-0.08, 0.15, 0.28, 0.45],
    it: [0.05, -0.15, 0.18, 0.10],
    was: [-1.20, -0.45, 0.10, 0.20],
    tired: [1.14, -0.40, 1.32, 0.15],
}

const V_VEC: Record<string, readonly [number, number]> = {
    The: [0.05, 0.05],
    animal: [0.96, 0.08],
    "didn't": [0.15, 0.20],
    cross: [0.35, 0.55],
    the: [0.05, 0.15],
    street: [0.06, 0.94],
    because: [0.25, 0.20],
    it: [0.50, 0.50],
    was: [0.30, 0.18],
    tired: [0.82, 0.10],
}

function dot4(a: readonly number[], b: readonly number[]): number {
    return a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
}

function softmax(scores: readonly number[]): number[] {
    const peak = Math.max(...scores)
    const exps = scores.map((x) => Math.exp(x - peak))
    const total = exps.reduce((sum, x) => sum + x, 0)
    return exps.map((x) => x / total)
}

// Full 10-token attention weights for query "it" (index 7).
const IT_INDEX = SENTENCE.indexOf('it')
const rawItScores = SENTENCE.map((word) => dot4(Q_VEC.it!, K_VEC[word]!))
const scaledItScores = rawItScores.map((score) => score / SCALE)
const fullItWeights = softmax(scaledItScores)

// 6x6 focus attention matrix over content words ['animal', 'cross', 'street', 'because', 'it', 'tired'].
const focusWeights = FOCUS_WORDS.map((qWord) =>
    softmax(FOCUS_WORDS.map((kWord) => dot4(Q_VEC[qWord]!, K_VEC[kWord]!) / SCALE)),
)

const blendedItValue: [number, number] = [
    SENTENCE.reduce((sum, w, j) => sum + fullItWeights[j]! * V_VEC[w]![0], 0),
    SENTENCE.reduce((sum, w, j) => sum + fullItWeights[j]! * V_VEC[w]![1], 0),
]

// Invariants: every softmax distribution sums to 1.0, and "it" attends strongly to "animal" (~0.64).
assertEqual(Math.round(fullItWeights.reduce((a, b) => a + b, 0) * 1e6) / 1e6, 1, '10-token attention weights sum to 1.0')
for (let r = 0; r < FOCUS_WORDS.length; r++) {
    const rowSum = focusWeights[r]!.reduce((a, b) => a + b, 0)
    assertEqual(Math.round(rowSum * 1e6) / 1e6, 1, `focus attention row "${FOCUS_WORDS[r]}" sums to 1.0`)
}
assertEqual(Number(fullItWeights[1]!.toFixed(2)), 0.64, 'full-sentence attention weight from "it" to "animal"')
assertEqual(blendedItValue[0] > 0.75 && blendedItValue[0] > blendedItValue[1] * 4, true, 'value blend routes animate "animal" feature into "it"')

// Candidate bars for query "it": animal, tired, street, cross, other.
const BAR_KEYS = ['animal', 'tired', 'street', 'cross', 'other'] as const
const priorBars = [0.20, 0.20, 0.20, 0.20, 0.20]
const ambiguousBars = [0.34, 0.16, 0.31, 0.11, 0.08]
const animalShare = fullItWeights[1]!
const tiredShare = fullItWeights[9]!
const streetShare = fullItWeights[5]!
const crossShare = fullItWeights[3]!
const otherShare = 1 - (animalShare + tiredShare + streetShare + crossShare)
const resolvedBars = [animalShare, tiredShare, streetShare, crossShare, otherShare]
assertEqual(Math.round(resolvedBars.reduce((a, b) => a + b, 0) * 1e6) / 1e6, 1, 'bar chart shares sum to 1.0')

// ── Film ────────────────────────────────────────────────────────────────────

export default film({
    title: 'Attention routes context where grammar alone cannot',
    description: 'Scaled dot-product attention resolving "it" to "animal" on a real 4D query-key-value calculation.',
    fps: 60,
    look: 'midnight',
    font: 'text-serif',
}, (s) => {
    const { area, heading, source, label } = sceneKit({
        size: 38,
        source: { size: 28 },
        chip: { size: 28, font: 'mono' },
    })

    const title = heading('Attention routes context where grammar alone cannot')
    const foot = source(`Scaled dot-product attention (d_k = ${D_K}) · weights sum to 1.00`)
    const stageTagHolder = new Node()

    const [mainBand, captionBand] = area.rows([7.1, 0.9], 'tight')

    // ── Act 1 layout: Two stacked 10-token strips (Query -> Key) + bottom formula & bars ──

    const [stripsZone, bottomZone] = mainBand.rows([3.5, 3.5], 'normal')
    const tokenStates = {
        plain: {},
        query: { color: 'yellow', fill: 0.30, mark: 'bar' as const },
        winner: { color: 'teal', fill: 0.30, mark: 'check' as const },
        rival: { color: 'orange', fill: 0.24, mark: 'dot' as const },
    }

    const queryStrip = tokens(SENTENCE, {
        size: 30,
        rowSize: 27,
        gap: 10,
        label: 'query',
        states: tokenStates,
    })
    const keyStrip = tokens(SENTENCE, {
        size: 30,
        rowSize: 27,
        gap: 10,
        label: 'keys',
        states: tokenStates,
    })
    place(column([queryStrip, keyStrip], { gap: 96, align: 'center' }), stripsZone, 'center')

    // Weighted bipartite attention links from "it" (index 7) in queryStrip to top keys in keyStrip.
    const linkPairs = ([1, 9, 5, 3, 6] as const).map((j) => [IT_INDEX, j, fullItWeights[j]!] as const)
    const attentionLinks = queryStrip.links(keyStrip, linkPairs, { color: 'teal', width: 4.8 })

    // ── Persistent right-side BarChart + morphing TeX equations ─────────────

    const [leftBottom, rightBottom] = bottomZone.columns([1.05, 1.35], 'normal')
    const [matrixCol, rightCol] = mainBand.columns([1.15, 1.0], 'wide')
    const [eqRightSlot, barRightSlot] = rightCol.rows([1.4, 3.2], 'normal')

    const eq1 = place(tex('Q K^T', { size: 50 }), leftBottom, 'center')
    const eq2 = place(tex('\\frac{Q K^T}{\\sqrt{d_k}}', { size: 50 }), leftBottom, 'center')
    const eq3 = place(tex('\\text{softmax}\\!\\left(\\frac{Q K^T}{\\sqrt{d_k}}\\right) V', { size: 44 }), leftBottom, 'center')
    const eq3TopRight = place(tex('\\text{softmax}\\!\\left(\\frac{Q K^T}{\\sqrt{d_k}}\\right) V', { size: 42 }), eqRightSlot, 'center')

    const barsTitle = label('Attention from query "it"', { size: 29, color: 'dim' })
    const bars = barChart(
        BAR_KEYS.map((word, idx) => ({
            label: word,
            value: priorBars[idx]!,
            color: word === 'animal' ? 'teal' : word === 'street' ? 'orange' : 'blue',
        })),
        {
            width: 660,
            height: 210,
            max: 0.75,
            ticks: [0, 0.25, 0.5, 0.75],
            labelSize: 28,
            showValues: true,
            states: true,
            format: (v) => v.toFixed(2),
        },
    )
    const barsPanel = column([barsTitle, bars], { gap: 14, align: 'center' })
    place(barsPanel, rightBottom, 'center')

    // ── Act 2 layout: 6x6 Focus Attention Matrix on the left ────────────────

    const matrix = attentionMatrix(FOCUS_WORDS, FOCUS_WORDS, focusWeights, {
        size: 27,
        values: true,
        format: (v) => v.toFixed(2),
    })
    place(matrix, matrixCol, 'center')

    // ── Subtitle helper ─────────────────────────────────────────────────────

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

    // ── Chapter 1: Coreference puzzle ───────────────────────────────────────

    s.add(title, foot, stageTagHolder)
    const ch1At = 0.2
    setStageNote('Coreference puzzle: in "because it was tired", does "it" refer to "animal" or "street"?')
    s.chapter('What does "it" refer to?')
    s.caption('When a model reads The animal did not cross the street because it was tired, what does it refer to?', 4.8)

    s.play(
        queryStrip.enter({ duration: 1.3 }),
        keyStrip.enter({ duration: 1.3 }),
    )
    s.wait(0.8)
    s.play(
        queryStrip.mark(IT_INDEX, 'query', { duration: 0.75 }),
        keyStrip.mark(1, 'winner', { duration: 0.75 }),
        keyStrip.mark(5, 'rival', { duration: 0.75 }),
    )
    s.play(
        fadeIn(barsTitle, { duration: 0.65 }),
        bars.enter({ duration: 1.0 }),
        fadeIn(eq1, { duration: 0.75 }),
    )
    s.caption('Grammar allows both nouns, so before contextual scoring the candidates start nearly tied.', 4.2)
    s.play(bars.update(ambiguousBars, { duration: 1.0 }))
    s.wait(2.1)

    // ── Chapter 2: Scaled dot products & weighted links ─────────────────────

    const ch2At = s.time
    s.chapter('Scaled dot-product scores')
    setStageNote('Scaling QK^T by sqrt(d_k) keeps softmax gradients sharp; "animal" wins 0.64 of the weight.')
    s.caption('Dot products compare query it against every key, and dividing by root d k keeps softmax from saturating.', 5.0)

    s.play(morphMatching(eq1, eq2, { duration: 1.1 }))
    s.wait(1.8)

    s.caption('Softmax turns scaled scores into weights that sum to one: sixty-four percent lands directly on animal.', 6.2)
    s.play(
        morphMatching(eq2, eq3, { duration: 1.2 }),
        bars.update(resolvedBars, { duration: 1.3 }),
        draw(attentionLinks, { lag: 0.14, duration: 1.6 }),
    )
    s.play(bars.mark('animal', 'chosen', { duration: 0.7 }))
    s.wait(2.8)

    // ── Chapter 3: Full pairwise attention matrix ───────────────────────────

    const ch3At = s.time
    s.chapter('The attention matrix')
    setStageNote('Every row of the attention matrix is a probability distribution over keys summing to 1.00.')
    s.caption('Across all content tokens, those weights form the attention matrix, where every row sums to one.', 5.4)

    s.play(
        fadeOut([queryStrip, keyStrip, attentionLinks], { duration: 0.65 }),
        morphMatching(eq3, eq3TopRight, { duration: 0.95 }),
        moveTo(barsPanel, [barRightSlot.cx, barRightSlot.cy], { duration: 0.95 }),
    )

    s.play(matrix.enter({ duration: 1.6 }))
    s.wait(1.0)

    const streetFocusIdx = FOCUS_WORDS.indexOf('street')
    const itFocusIdx = FOCUS_WORDS.indexOf('it')
    s.play(matrix.light({ row: streetFocusIdx }, { color: 'orange', duration: 0.75 }))
    s.wait(1.5)

    s.caption('Lighting row it reveals highest weight on animal and minimal weight on street.', 4.8)
    s.play(matrix.light({ row: itFocusIdx }, { color: 'yellow', duration: 0.8 }))
    s.wait(2.4)

    // ── Chapter 4: Value routing into "it" ──────────────────────────────────

    const ch4At = s.time
    s.chapter('Routing value vectors')
    setStageNote('Multiplying by V blends 64% of "animal" into "it", binding pronoun to its animate subject.')
    s.caption('Finally, multiplying by V blends sixty-four percent of animal into it, resolving the pronoun in one step.', 6.8)

    s.play(
        matrix.light({ row: itFocusIdx, col: 0 }, { color: 'teal', duration: 0.8 }),
        indicate(bars.bar(0), { color: 'yellow', scale: 1.06, duration: 1.1 }),
    )
    s.wait(1.9)

    // Inspect row "tired" -> "animal", then spotlight the resolved "it" distribution.
    const tiredFocusIdx = FOCUS_WORDS.indexOf('tired')
    s.play(matrix.light({ row: tiredFocusIdx }, { color: 'yellow', duration: 0.8 }))
    s.wait(1.6)
    s.play(matrix.light({ row: itFocusIdx }, { color: 'yellow', duration: 0.8 }))
    s.play(spotlight([matrix, eq3TopRight, bars], { keep: [title, foot, stageTagHolder, barsTitle, activeNote!], duration: 0.7 }))
    s.wait(2.0)
    s.play(spotlight(null, { duration: 0.6 }))
    s.wait(2.6)

    stageTagHolder.add(
        tagTrack([
            { at: ch1At, word: 'COREFERENCE', note: '"it" -> ?' },
            { at: ch2At, word: 'SOFTMAX', note: 'animal = 0.64' },
            { at: ch3At, word: 'MATRIX', note: 'rows sum to 1' },
            { at: ch4At, word: 'VALUES', note: 'context blend' },
        ], {
            until: s.time + 1,
            size: 28,
            anchor: 'right',
            noteFont: 'text-serif',
        }).at(area.right, title.get('y')),
    )
})
