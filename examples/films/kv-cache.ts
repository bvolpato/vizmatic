import {
    Box,
    TOKEN_STATES,
    assertEqual,
    countUp,
    counter,
    graph,
    heatmap,
    indicate,
    infoBox,
    narrated,
    place,
    sceneKit,
    segmentedBar,
    text,
    tokens,
    type SceneClock,
    type Stage,
    type TimingFile,
} from 'vizmatic/stage'

// Exact verified KV-cache math for a 7B Transformer (32 layers, 32 heads, head dim 128, FP16).
// Per-token KV bytes = 2 (K & V) * 32 layers * 32 heads * 128 dim * 2 bytes = 524,288 B = 0.5 MiB.
const LAYERS = 32
const KV_HEADS_MHA = 32
const KV_HEADS_GQA = 4
const HEAD_DIM = 128
const BYTES_FP16 = 2

const BYTES_PER_TOKEN_MHA = 2 * LAYERS * KV_HEADS_MHA * HEAD_DIM * BYTES_FP16
const BYTES_PER_TOKEN_GQA = 2 * LAYERS * KV_HEADS_GQA * HEAD_DIM * BYTES_FP16
const MIB = 1024 * 1024
const GIB = 1024 * MIB

assertEqual(BYTES_PER_TOKEN_MHA / MIB, 0.5, '7B MHA KV cache costs exactly 0.5 MiB per token')
assertEqual(BYTES_PER_TOKEN_MHA / BYTES_PER_TOKEN_GQA, 8, 'GQA-8 compresses KV cache by exactly 8x')

const WEIGHTS_GIB = 14.0
const GPU_CAP_GIB = 24.0
const KV_4K_GIB = (4096 * BYTES_PER_TOKEN_MHA) / GIB
const KV_16K_GIB = (16384 * BYTES_PER_TOKEN_MHA) / GIB
const KV_24K_MHA_GIB = (24576 * BYTES_PER_TOKEN_MHA) / GIB
const KV_24K_GQA_GIB = (24576 * BYTES_PER_TOKEN_GQA) / GIB

assertEqual(KV_4K_GIB, 2.0, '4096 tokens = 2.0 GiB')
assertEqual(KV_16K_GIB, 8.0, '16384 tokens = 8.0 GiB')
assertEqual(KV_24K_MHA_GIB, 12.0, '24576 tokens MHA = 12.0 GiB (26 GiB total > 24 GiB GPU)')
assertEqual(KV_24K_GQA_GIB, 1.5, '24576 tokens GQA-8 = 1.5 GiB (15.5 GiB total < 24 GiB GPU)')

// Projection work across N = 1,024 tokens: N(N+1)/2 = 524,800 vs 1,024 (512.5x).
const SEQ_N = 1024
const PROJECTIONS_NO_CACHE = (SEQ_N * (SEQ_N + 1)) / 2
assertEqual(PROJECTIONS_NO_CACHE, 524800, 'triangular sum for 1024 tokens is 524,800')
assertEqual(Math.floor(PROJECTIONS_NO_CACHE / SEQ_N), 512, 'KV cache avoids >500x redundant projections')

const kit = sceneKit({ size: 38, source: { y: -420 } })
const STAGE_AREA = new Box(kit.area.left + 14, kit.area.top + 32, kit.area.right - 14, kit.area.bottom - 20)

const PROMPT_WORDS = ['The', 'quick', 'brown', 'fox', 'jumps', 'over'] as const
const CAUSAL_SCORES: readonly (readonly number[])[] = [
    [0.95, 0, 0, 0, 0, 0],
    [0.38, 0.88, 0, 0, 0, 0],
    [0.24, 0.42, 0.86, 0, 0, 0],
    [0.18, 0.31, 0.54, 0.91, 0, 0],
    [0.14, 0.22, 0.36, 0.62, 0.85, 0],
    [0.12, 0.19, 0.28, 0.49, 0.58, 0.89],
]

// ── Scene 1: Recomputing K and V on every decode step ────────────────────────
function recompute(s: Stage, c: SceneClock): void {
    const title = kit.heading('Without a KV cache: O(N²) projection work')
    const source = kit.source('7B Transformer (32 layers, 32 heads, d_head = 128, FP16) · exact count')
    s.add(title, source)

    const [leftCol, rightCol] = STAGE_AREA.columns([1.08, 0.92], 44)
    const gridTitle = kit.label('Causal attention matrix (recomputed each step)', { color: 'ink' })
    const causalGrid = heatmap(CAUSAL_SCORES, {
        cell: 68,
        gap: 6,
        size: 26,
        labelSize: 26,
        domain: [0, 1],
        colors: ['surface', 'blue', 'teal', 'gold'],
        rowLabels: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5'],
        columnLabels: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'],
        initial: (r, col) => (col > r ? 'future' : 'open'),
    })
    place(gridTitle, new Box(leftCol!.left, leftCol!.top, leftCol!.right, leftCol!.top + 52), 'left')
    place(causalGrid, new Box(leftCol!.left, leftCol!.top + 58, leftCol!.right, leftCol!.bottom), 'center')

    const [countSlot, cardSlot] = rightCol!.rows([0.38, 0.62], 24)
    const projLabel = kit.note('K/V projections over N = 1,024 tokens (no cache)', { color: 'orange' })
    const projCount = counter(1024, {
        size: 56,
        weight: 700,
        color: 'orange',
        digits: 0,
        grouped: true,
    })
    place(projLabel, new Box(countSlot!.left, countSlot!.top + 10, countSlot!.right, countSlot!.top + 48), 'center')
    place(projCount, new Box(countSlot!.left, countSlot!.top + 56, countSlot!.right, countSlot!.bottom), 'center')

    const wasteCard = infoBox({
        title: 'Redundant decode projections',
        rows: [
            { label: 'step t work', value: 'projects all 1..t keys & values', tone: 'orange' },
            { label: 'N = 1,024 total', value: '524,800 vs 1,024 (512× wasted)', tone: 'red' },
        ],
        accent: 'red',
        size: 26,
    })
    place(wasteCard, cardSlot!, 'center')

    s.add(gridTitle, causalGrid, projLabel, projCount, wasteCard.hide())

    s.at(c.cue('attends').start - 0.1, () => {
        s.play(causalGrid.light({ row: [0, 5], col: [0, 5] }, { color: 'teal', duration: 0.7 }))
    })
    s.at(c.cue('recomputes').start - 0.1, () => {
        s.play(
            causalGrid.light({ row: 5, col: [0, 4] }, { color: 'orange', duration: 0.7 }),
            countUp(projCount, PROJECTIONS_NO_CACHE, { duration: 1.5 }),
        )
    })
    c.show('waste', wasteCard)
}

// ── Scene 2: Prefill once, read cached rows during decode ────────────────────
function cache(s: Stage, c: SceneClock): void {
    const title = kit.heading('Prefill once, then stream one query per token')
    const source = kit.source('Past keys and values are immutable under causal masking')
    s.add(title, source)

    const [topRow, midRow, botRow] = STAGE_AREA.rows([0.24, 0.42, 0.34], 20)

    const seqStrip = tokens(
        PROMPT_WORDS.slice(0, 5).map((w) => ({ text: w, state: 'kept' })),
        {
            label: 'tokens',
            width: 1420,
            size: 32,
            rowSize: 26,
            gap: 14,
            states: TOKEN_STATES,
            spans: [{ from: 0, to: 4, label: 'prefill prompt (cached once)', color: 'teal' }],
        },
    )
    place(seqStrip, topRow!, 'center')

    const kvTensor = heatmap(
        [
            [0.82, 0.64, 0.91, 0.55, 0.78, 0.88],
            [0.45, 0.73, 0.61, 0.84, 0.52, 0.79],
        ],
        {
            cellWidth: 118,
            cellHeight: 68,
            gap: 8,
            size: 26,
            labelSize: 26,
            domain: [0, 1],
            colors: ['surface', 'teal', 'gold'],
            rowLabels: ['K cache', 'V cache'],
            columnLabels: ['t0', 't1', 't2', 't3', 't4', 't5 (new)'],
            shown: { rows: 2, columns: 5 },
            initial: 'empty',
        },
    )
    place(kvTensor, midRow!, 'center')

    const cacheCard = infoBox({
        title: 'Cached decode step (token t₅)',
        rows: [
            { label: 'new compute', value: '1 query q₅ + append k₅, v₅', tone: 'green' },
            { label: 'past tokens', value: 'read K[0..4], V[0..4] from HBM', tone: 'gold' },
        ],
        accent: 'teal',
        size: 27,
    })
    place(cacheCard, botRow!, 'center')

    s.add(seqStrip, kvTensor, cacheCard.hide())

    s.at(c.cue('prefill').start - 0.1, () => {
        s.play(kvTensor.mark({ row: [0, 1], col: [0, 4] }, 'open', { duration: 0.8 }))
    })
    s.at(c.cue('saves').start - 0.1, () => {
        s.play(seqStrip.mark([0, 1, 2, 3, 4], 'cached', { duration: 0.7 }))
    })
    s.at(c.cue('query').start - 0.1, () => {
        s.play(
            seqStrip.append({ text: 'over', state: 'generated' }, { duration: 0.7 }),
            kvTensor.grow({ columns: 1 }, { duration: 0.7 }),
        )
    })
    s.at(c.cue('cached').start - 0.1, () => {
        s.play(
            kvTensor.mark({ row: [0, 1], col: 5 }, 'open', { duration: 0.4 }),
            kvTensor.light({ row: [0, 1], col: [0, 5] }, { color: 'gold', duration: 0.7 }),
        )
    })
    c.show('cached', cacheCard)
}

// ── Scene 3: Linear VRAM growth hits the 24 GiB GPU wall ─────────────────────
function vram(s: Stage, c: SceneClock): void {
    const title = kit.heading('The memory wall: linear KV cache growth')
    const source = kit.source('7B FP16 weights = 14 GiB · MHA KV cache = 0.5 MiB/token on 24 GiB GPU')
    s.add(title, source)

    const [barSlot, cardsSlot] = STAGE_AREA.rows([0.46, 0.54], 24)
    const [leftCardSlot, rightCardSlot] = cardsSlot!.columns([1, 1], 36)

    const vramBar = segmentedBar(
        [
            { name: 'Model weights', value: WEIGHTS_GIB, color: 'blue' },
            { name: 'KV cache', value: KV_4K_GIB, color: 'teal' },
        ],
        {
            title: '24 GiB GPU VRAM budget',
            width: 1440,
            capacity: GPU_CAP_GIB,
            max: 28,
            free: 'free',
            over: 'OOM',
            format: (v) => `${v.toFixed(1)} GiB`,
            size: 27,
        },
    )
    place(vramBar, barSlot!, 'center')

    const formulaCard = infoBox({
        title: 'Per-token cache footprint (MHA)',
        rows: [
            { label: 'formula', value: '2 × 32 layers × 32 heads × 128 × 2 B', tone: 'teal' },
            { label: 'size / token', value: '512 KiB (0.5 MiB) per token', tone: 'gold' },
        ],
        accent: 'teal',
        size: 27,
    })
    const oomCard = infoBox({
        title: 'At 24,576 context tokens',
        rows: [
            { label: 'KV cache', value: '12.0 GiB (+ 14.0 GiB weights = 26 GiB)', tone: 'red' },
            { label: 'verdict', value: 'Out of memory (+2.0 GiB over 24 GiB)', tone: 'orange' },
        ],
        accent: 'red',
        size: 27,
    })
    place(formulaCard, leftCardSlot!, 'center')
    place(oomCard, rightCardSlot!, 'center')

    s.add(vramBar, formulaCard, oomCard.hide())

    s.at(c.cue('grows').start - 0.1, () => {
        s.play(vramBar.resize('KV cache', KV_16K_GIB, { duration: 1.1 }))
    })
    s.at(c.cue('per-token').start - 0.1, () => {
        s.play(indicate(formulaCard, { color: 'gold', duration: 0.8 }))
    })
    s.at(c.cue('overflow').start - 0.1, () => {
        s.play(vramBar.resize('KV cache', KV_24K_MHA_GIB, { duration: 1.0 }))
    })
    c.show('overflow', oomCard)
}

// ── Scene 4: Grouped-Query Attention (GQA-8) shrinks KV cache 8x ─────────────
function gqa(s: Stage, c: SceneClock): void {
    const title = kit.heading('Grouped-Query Attention: 8× smaller KV cache')
    const source = kit.source('Ainslie et al., GQA (EMNLP 2023) · 32 query heads sharing 4 K/V head groups')
    s.add(title, source)

    const [topArea, botArea] = STAGE_AREA.rows([0.52, 0.48], 22)
    const [graphSlot, cardSlot] = topArea!.columns([1.08, 0.92], 36)

    const headGraph = graph(
        [
            { id: 'q0', label: 'Q0..Q3 (4)', color: 'blue', width: 170, height: 58 },
            { id: 'q1', label: 'Q4..Q7 (4)', color: 'blue', width: 170, height: 58 },
            { id: 'kv', label: '1 shared K/V', color: 'gold', width: 214, height: 64 },
            { id: 'out', label: '64 KiB / tok', color: 'green', width: 214, height: 64 },
        ],
        [
            { from: 'q0', to: 'kv', color: 'teal' },
            { from: 'q1', to: 'kv', color: 'teal' },
            { from: 'kv', to: 'out', color: 'green' },
        ],
        {
            layout: 'dagre',
            direction: 'LR',
            width: Math.round(graphSlot!.width - 20),
            height: 250,
            fit: true,
            labelSize: 27,
            fillOpacity: 0.16,
        },
    )
    place(headGraph, graphSlot!, 'center')

    const gqaCard = infoBox({
        title: 'GQA-8 at 24,576 tokens',
        rows: [
            { label: 'MHA (32 KV)', value: '12.0 GiB · OOM on 24 GiB', tone: 'red' },
            { label: 'GQA (4 KV)', value: '1.5 GiB · 8.5 GiB free (8×)', tone: 'green' },
        ],
        accent: 'green',
        size: 27,
    })
    place(gqaCard, cardSlot!, 'center')

    const gqaBar = segmentedBar(
        [
            { name: 'Model weights', value: WEIGHTS_GIB, color: 'blue' },
            { name: 'KV cache', value: KV_24K_MHA_GIB, color: 'teal' },
        ],
        {
            title: '24 GiB GPU VRAM budget (24,576 tokens)',
            width: 1440,
            capacity: GPU_CAP_GIB,
            max: 28,
            free: 'free',
            over: 'OOM',
            format: (v) => `${v.toFixed(1)} GiB`,
            size: 27,
        },
    )
    place(gqaBar, botArea!, 'center')

    const closing = text('Same query expressivity, 8× less KV memory bandwidth during decode.', {
        size: 27,
        color: 'dim',
    })
    place(closing, new Box(kit.area.left, kit.area.bottom - 16, kit.area.right, kit.area.bottom + 24), 'center')

    s.add(gqaBar, headGraph.hide(), gqaCard.hide(), closing.hide())

    s.at(c.cue('share').start - 0.1, () => {
        s.play(headGraph.enter({ duration: 1.0 }))
    })
    s.at(c.cue('drops').start - 0.1, () => {
        s.play(gqaBar.resize('KV cache', KV_24K_GQA_GIB, { duration: 1.1 }))
    })
    c.show('inside', [gqaCard, closing])
}

const TIMING: TimingFile = {"intro":2.2,"lead":2.7,"gap":0.4,"tail":0.8,"scenes":[{"id":"recompute","title":"The redundant work","beats":[{"say":"Every new token in a language model attends to every token before it.","duration":4.55,"hold":0.35,"words":[{"text":"Every","start":0.25,"end":0.55},{"text":"new","start":0.55,"end":0.725},{"text":"token","start":0.725,"end":1.15},{"text":"in","start":1.15,"end":1.238},{"text":"a","start":1.238,"end":1.3},{"text":"language","start":1.3,"end":1.725},{"text":"model","start":1.725,"end":2.375},{"text":"attends","start":2.375,"end":2.775},{"text":"to","start":2.775,"end":2.913},{"text":"every","start":2.913,"end":3.225},{"text":"token","start":3.225,"end":3.538},{"text":"before","start":3.538,"end":3.9},{"text":"it","start":3.9,"end":4.3}],"cues":[{"id":"attends","phrase":"attends to every token"}]},{"say":"Without a cache, decoding step by step recomputes the same keys and values over and over.","duration":5.85,"hold":0.4,"words":[{"text":"Without","start":0.225,"end":0.512},{"text":"a","start":0.512,"end":0.575},{"text":"cache","start":0.575,"end":1.125},{"text":"decoding","start":1.225,"end":1.725},{"text":"step","start":1.725,"end":1.975},{"text":"by","start":1.975,"end":2.15},{"text":"step","start":2.15,"end":2.688},{"text":"recomputes","start":2.688,"end":3.263},{"text":"the","start":3.263,"end":3.35},{"text":"same","start":3.35,"end":3.65},{"text":"keys","start":3.65,"end":4.05},{"text":"and","start":4.05,"end":4.175},{"text":"values","start":4.175,"end":4.675},{"text":"over","start":4.675,"end":4.912},{"text":"and","start":4.912,"end":5.013},{"text":"over","start":5.013,"end":5.6}],"cues":[{"id":"recomputes","phrase":"recomputes the same keys"}]},{"say":"Over a thousand tokens, that repeats projection work more than five hundred times.","duration":5.15,"hold":1,"words":[{"text":"Over","start":0.25,"end":0.487},{"text":"a","start":0.487,"end":0.588},{"text":"thousand","start":0.588,"end":1},{"text":"tokens","start":1,"end":1.725},{"text":"that","start":1.825,"end":2.025},{"text":"repeats","start":2.025,"end":2.45},{"text":"projection","start":2.45,"end":3},{"text":"work","start":3,"end":3.25},{"text":"more","start":3.25,"end":3.438},{"text":"than","start":3.438,"end":3.625},{"text":"five","start":3.625,"end":3.938},{"text":"hundred","start":3.938,"end":4.225},{"text":"times","start":4.225,"end":4.9}],"cues":[{"id":"waste","phrase":"five hundred times"}]}]},{"id":"cache","title":"Keep keys and values","beats":[{"say":"Past tokens never change. So the model computes each key and value once during prefill and saves them.","duration":6.945,"hold":0.35,"words":[{"text":"Past","start":0.225,"end":0.463},{"text":"tokens","start":0.463,"end":0.825},{"text":"never","start":0.825,"end":1.075},{"text":"change","start":1.075,"end":1.675},{"text":"So","start":2.345,"end":2.433},{"text":"the","start":2.433,"end":2.52},{"text":"model","start":2.52,"end":2.87},{"text":"computes","start":2.87,"end":3.295},{"text":"each","start":3.295,"end":3.533},{"text":"key","start":3.533,"end":4.058},{"text":"and","start":4.058,"end":4.195},{"text":"value","start":4.195,"end":4.545},{"text":"once","start":4.545,"end":4.82},{"text":"during","start":4.82,"end":5.07},{"text":"pre","start":5.07,"end":5.308},{"text":"fill","start":5.308,"end":5.758},{"text":"and","start":5.758,"end":5.908},{"text":"saves","start":5.908,"end":6.258},{"text":"them","start":6.258,"end":6.72}],"cues":[{"id":"prefill","phrase":"once during pre fill"},{"id":"saves","phrase":"saves them"}]},{"say":"During decode, each new token builds one query and reads the cached rows in a single pass.","duration":5.8,"hold":1,"words":[{"text":"During","start":0.25,"end":0.475},{"text":"decode","start":0.475,"end":1.175},{"text":"each","start":1.275,"end":1.5},{"text":"new","start":1.5,"end":1.675},{"text":"token","start":1.675,"end":2.1},{"text":"builds","start":2.1,"end":2.35},{"text":"one","start":2.35,"end":2.575},{"text":"query","start":2.575,"end":3.138},{"text":"and","start":3.138,"end":3.275},{"text":"reads","start":3.275,"end":3.562},{"text":"the","start":3.562,"end":3.663},{"text":"cached","start":3.663,"end":4.05},{"text":"rows","start":4.05,"end":4.425},{"text":"in","start":4.425,"end":4.513},{"text":"a","start":4.513,"end":4.612},{"text":"single","start":4.612,"end":4.925},{"text":"pass","start":4.925,"end":5.55}],"cues":[{"id":"query","phrase":"one query"},{"id":"cached","phrase":"cached rows"}]}]},{"id":"vram","title":"The memory wall","beats":[{"say":"There is a catch. The cache grows linearly with context length.","duration":4.545,"hold":0.35,"words":[{"text":"There","start":0.3,"end":0.425},{"text":"is","start":0.425,"end":0.537},{"text":"a","start":0.537,"end":0.625},{"text":"catch","start":0.625,"end":1.2},{"text":"The","start":1.87,"end":1.945},{"text":"cache","start":1.945,"end":2.27},{"text":"grows","start":2.27,"end":2.57},{"text":"linearly","start":2.57,"end":3.07},{"text":"with","start":3.07,"end":3.245},{"text":"context","start":3.245,"end":3.77},{"text":"length","start":3.77,"end":4.295}],"cues":[{"id":"grows","phrase":"grows linearly"}]},{"say":"On a 7B model, every token adds half a megabyte. At 24 thousand tokens, the cache overflows a 24 gigabyte GPU.","duration":9.545,"hold":1.1,"words":[{"text":"On","start":0.225,"end":0.338},{"text":"a","start":0.338,"end":0.45},{"text":"seven","start":0.45,"end":0.825},{"text":"billion","start":0.825,"end":1.175},{"text":"model","start":1.175,"end":1.725},{"text":"every","start":1.825,"end":2.125},{"text":"token","start":2.125,"end":2.5},{"text":"adds","start":2.5,"end":2.775},{"text":"half","start":2.775,"end":3.013},{"text":"a","start":3.013,"end":3.062},{"text":"megabyte","start":3.062,"end":3.775},{"text":"At","start":4.42,"end":4.545},{"text":"twenty","start":4.545,"end":4.845},{"text":"four","start":4.845,"end":5.07},{"text":"thousand","start":5.07,"end":5.42},{"text":"tokens","start":5.42,"end":6.145},{"text":"the","start":6.245,"end":6.357},{"text":"cache","start":6.357,"end":6.695},{"text":"overflows","start":6.695,"end":7.295},{"text":"a","start":7.295,"end":7.37},{"text":"twenty","start":7.37,"end":7.695},{"text":"four","start":7.695,"end":7.92},{"text":"gigabyte","start":7.92,"end":8.357},{"text":"G","start":8.357,"end":8.57},{"text":"P","start":8.57,"end":8.795},{"text":"U.","start":8.795,"end":9.245}],"cues":[{"id":"per-token","phrase":"half a megabyte"},{"id":"overflow","phrase":"overflows"}]}]},{"id":"gqa","title":"Grouped-query compression","beats":[{"say":"Grouped-query attention breaks that wall. Eight query heads share one pair of key and value heads.","duration":6.295,"hold":0.4,"words":[{"text":"Grouped","start":0.25,"end":0.55},{"text":"query","start":0.55,"end":0.9},{"text":"attention","start":0.9,"end":1.325},{"text":"breaks","start":1.325,"end":1.613},{"text":"that","start":1.613,"end":1.775},{"text":"wall","start":1.775,"end":2.275},{"text":"Eight","start":2.945,"end":3.12},{"text":"query","start":3.12,"end":3.445},{"text":"heads","start":3.445,"end":3.882},{"text":"share","start":3.882,"end":4.12},{"text":"one","start":4.12,"end":4.345},{"text":"pair","start":4.345,"end":4.558},{"text":"of","start":4.558,"end":4.683},{"text":"key","start":4.683,"end":5.02},{"text":"and","start":5.02,"end":5.145},{"text":"value","start":5.145,"end":5.495},{"text":"heads","start":5.495,"end":6.07}],"cues":[{"id":"share","phrase":"share one pair"}]},{"say":"Cache memory drops eightfold, from 12 gigabytes to 1.5, keeping long context fast and inside memory.","duration":7.725,"hold":1.3,"words":[{"text":"Cache","start":0.25,"end":0.575},{"text":"memory","start":0.575,"end":0.975},{"text":"drops","start":0.975,"end":1.325},{"text":"eightfold","start":1.325,"end":2.025},{"text":"from","start":2.125,"end":2.3},{"text":"twelve","start":2.3,"end":2.625},{"text":"gigabytes","start":2.625,"end":3.125},{"text":"to","start":3.125,"end":3.25},{"text":"one","start":3.25,"end":3.475},{"text":"point","start":3.475,"end":3.725},{"text":"five","start":3.725,"end":4.35},{"text":"keeping","start":4.475,"end":4.812},{"text":"long","start":4.812,"end":5.15},{"text":"context","start":5.15,"end":5.725},{"text":"fast","start":5.725,"end":6.213},{"text":"and","start":6.213,"end":6.35},{"text":"inside","start":6.35,"end":6.8},{"text":"memory","start":6.8,"end":7.5}],"cues":[{"id":"drops","phrase":"drops eightfold"},{"id":"inside","phrase":"inside memory"}]}]}]}

export default narrated({
    title: 'KV Cache: why decoding stays fast',
    description: 'Narrated walkthrough of autoregressive KV caching, linear VRAM growth on a 7B model, and Grouped-Query Attention compression.',
    look: 'midnight',
    font: 'text-serif',
    fps: 60,
    bloom: 0.35,
    poster: 64.8,
    intro: {
        title: 'KV Cache',
        subtitle: 'Why decoding stays fast',
    },
    timing: TIMING,
    scenes: { recompute, cache, vram, gqa },
})
