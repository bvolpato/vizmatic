import {
    Box,
    assertEqual,
    boxOf,
    column,
    delay,
    fadeIn,
    fadeOut,
    film,
    fitted,
    heatmap,
     indicate,
    infoBox,
    lanes,
    morphMatching,
    place,
    sceneKit,
    segmentedBar,
    spotlight,
    table,
    tex,
    write,
    zone,
} from 'vizmatic/stage'

// Algorithm 1, linear auxiliary storage, and Theorem 2 HBM traffic bound:
// https://arxiv.org/html/2205.14135v2 (Sections 2.1 and 3).
// A100 capacities/bandwidth below are illustrative hardware figures.
// The 192 KB pool combines L1/shared; at most 164 KB is configurable as shared:
// https://docs.nvidia.com/cuda/ampere-tuning-guide/index.html#unified-shared-memory-l1-texture-cache
// Deterministic 8 x 4 query, key, and value matrices so both full-row softmax
// and 2-tile online softmax execute on real floating-point vectors at build time.
const Q_MAT: readonly (readonly number[])[] = [
    [0.9, 0.4, -0.2, 0.7],
    [0.3, 1.1, 0.5, -0.3],
    [-0.4, 0.8, 0.9, 0.2],
    [1.0, -0.3, 0.4, 0.8],
    [0.2, 0.6, -0.7, 1.0],
    [-0.6, 0.9, 0.3, 0.5],
    [0.8, 0.2, 0.7, -0.4],
    [0.5, -0.5, 1.0, 0.6],
]

const K_MAT: readonly (readonly number[])[] = [
    [0.6, 0.3, -0.1, 0.4],
    [1.1, 0.7, -0.4, 0.8],
    [-0.3, 0.2, 0.8, -0.2],
    [0.7, -0.1, 0.3, 0.9],
    [0.5, 0.8, 0.2, 0.6],
    [1.6, 0.9, -0.5, 1.3],
    [0.8, 0.5, 0.4, 0.7],
    [0.3, -0.4, 0.9, 0.5],
]

const V_MAT: readonly (readonly number[])[] = [
    [0.2, 0.8, 0.5, 0.1],
    [0.9, 0.3, 0.7, 0.4],
    [0.4, 0.6, 0.2, 0.9],
    [0.7, 0.5, 0.8, 0.3],
    [0.3, 0.9, 0.4, 0.6],
    [1.0, 0.2, 0.9, 0.8],
    [0.6, 0.7, 0.3, 0.5],
    [0.5, 0.4, 0.6, 0.2],
]

const SCALE = 1 / Math.sqrt(4)

function computeScores(q: readonly (readonly number[])[], k: readonly (readonly number[])[]): number[][] {
    return q.map((qi) =>
        k.map((kj) => {
            let dot = 0
            for (let d = 0; d < qi.length; d++) dot += qi[d]! * kj[d]!
            return Number((dot * SCALE).toFixed(2))
        }),
    )
}

function standardAttention(scores: readonly (readonly number[])[], v: readonly (readonly number[])[]): number[][] {
    return scores.map((sRow) => {
        const m = Math.max(...sRow)
        const exps = sRow.map((s) => Math.exp(s - m))
        const sum = exps.reduce((a, b) => a + b, 0)
        const weights = exps.map((e) => e / sum)
        return [0, 1, 2, 3].map((d) => weights.reduce((acc, w, j) => acc + w * v[j]![d]!, 0))
    })
}

interface OnlineStep {
    max: number
    sum: number
    rescale: number
    out: number[]
}

function tiledOnlineAttention(
    scores: readonly (readonly number[])[],
    v: readonly (readonly number[])[],
    tileCols: number,
): { out: number[][]; row0Steps: OnlineStep[] } {
    const row0Steps: OnlineStep[] = []
    const out = scores.map((sRow, rowIdx) => {
        let m = -Infinity
        let l = 0
        let acc = [0, 0, 0, 0]
        for (let start = 0; start < sRow.length; start += tileCols) {
            const tile = sRow.slice(start, start + tileCols)
            const tileMax = Math.max(...tile)
            const nextM = Math.max(m, tileMax)
            const alpha = m === -Infinity ? 0 : Math.exp(m - nextM)
            const pTile = tile.map((s) => Math.exp(s - nextM))
            const tileSum = pTile.reduce((a, b) => a + b, 0)
            const nextL = alpha * l + tileSum
            acc = acc.map((prev, d) => {
                const pv = pTile.reduce((sum, p, offset) => sum + p * v[start + offset]![d]!, 0)
                return (alpha * l * prev + pv) / nextL
            })
            m = nextM
            l = nextL
            if (rowIdx === 0) {
                row0Steps.push({ max: m, sum: l, rescale: alpha, out: [...acc] })
            }
        }
        return acc
    })
    return { out, row0Steps }
}

const SCORES = computeScores(Q_MAT, K_MAT)
const STD_OUT = standardAttention(SCORES, V_MAT)
const TILED = tiledOnlineAttention(SCORES, V_MAT, 4)

let maxDiff = 0
for (let i = 0; i < STD_OUT.length; i++) {
    for (let d = 0; d < 4; d++) {
        maxDiff = Math.max(maxDiff, Math.abs(STD_OUT[i]![d]! - TILED.out[i]![d]!))
    }
}
assertEqual(maxDiff < 1e-9, true, 'flash-attention tiled online softmax matches full-row softmax within 1e-9')
assertEqual(TILED.row0Steps.length, 2, 'two tiles across N = 8 with block width 4')

export default film(
    {
        title: 'FlashAttention: tiling beats memory bandwidth',
        description: 'Naive attention stalls on HBM reads and writes of the N x N matrix. Tiling inside SRAM with online softmax computes exact attention without storing the full score matrix.',
        look: 'blueprint',
        font: 'text-serif',
        fps: 60,
        poster: 21.5,
    },
    (s) => {
        const kit = sceneKit({ size: 38, source: { y: -420 } })
        const title = kit.heading('FlashAttention: tiling beats memory bandwidth')
        const source = kit.source('Dao et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness," NeurIPS 2022')
        s.add(title, source)

        // ── Chapters 1 & 2: Memory hierarchy + N x N tile sweep ─────────────
        s.chapter('The memory wall')
        s.caption('Naive attention writes the entire N by N score matrix to slow GPU HBM, leaving Tensor Cores waiting.', 11.8)

        const [leftPane, rightPane] = kit.area.inset(4, 4).columns([1.05, 1], 48)
        const [hbmSlot, sramSlot, timelineSlot] = leftPane!.rows([1.15, 1.15, 1.08], 18)

        const hbmBar = segmentedBar(
            [
                { name: 'Q', value: 10, color: 'blue' },
                { name: 'K1,V1', value: 8, color: 'teal' },
                { name: 'K2,V2', value: 8, color: 'purple' },
            ],
            {
                capacity: 84,
                width: hbmSlot!.width - 96,
                height: 36,
                size: 26,
            },
        )
        const hbmZone = zone([hbmBar], {
            title: 'A100 HBM: 40 GB, 1.5 TB/s',
            color: 'orange',
            titleSize: 27,
            padding: 18,
        })
        place(hbmZone, hbmSlot!, 'center')

        const sramBar = segmentedBar(
            [{ name: 'Qi,Oi', value: 6, color: 'blue' }],
            {
                capacity: 20,
                width: sramSlot!.width - 96,
                height: 36,
                size: 26,
            },
        )
        const sramZone = zone([sramBar], {
            title: 'L1/shared per SM: 192 KB',
            color: 'teal',
            titleSize: 27,
            padding: 18,
        })
        place(sramZone, sramSlot!, 'center')

        const wallLanes = fitted(timelineSlot!.inset(12, 0), (width) =>
            lanes(
                ['Cores', 'HBM'],
                [
                    { lane: 'Cores', start: 0, end: 1.6, label: 'Q K^T', color: 'blue' },
                    { lane: 'Cores', start: 1.6, end: 6.2, idle: true, color: 'dim' },
                    { lane: 'HBM', start: 1.6, end: 6.2, label: 'write+read S', color: 'red' },
                    { lane: 'Cores', start: 6.2, end: 7.6, label: 'softmax', color: 'teal' },
                    { lane: 'Cores', start: 7.6, end: 11.8, idle: true, color: 'dim' },
                    { lane: 'HBM', start: 7.6, end: 11.8, label: 'write+read P', color: 'orange' },
                ],
                {
                    domain: [0, 12],
                    width,
                    barHeight: 44,
                    pitch: 74,
                    size: 26,
                },
            ),
        )
        place(wallLanes, timelineSlot!, 'center')

        const matrixTitle = kit.label('Attention score matrix  S = Q K^T / sqrt(d)', { color: 'ink' })
        const scoreGrid = heatmap(SCORES, {
            cell: 52,
            gap: 5,
            size: 26,
            labelSize: 26,
            values: false,
            colors: ['surface', 'blue', 'teal', 'gold'],
            rowLabels: ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
            columnLabels: ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'],
        })
        const matrixNote = kit.note('Naive pass materializes all N^2 scores in HBM', {
            color: 'orange',
            align: 'center',
        })
        const matrixNoteTiled = kit.note('Only one 4 x 4 tile lives in fast SRAM at a time', {
            color: 'teal',
            align: 'center',
        })

        place(column([matrixTitle, scoreGrid, matrixNote], { gap: 20, align: 'center' }), rightPane!.inset(8, 4), 'center')
        place(matrixNoteTiled, boxOf(matrixNote), 'center')

        const tileStatusBox = timelineSlot!.inset(14, 6)
        const tileCard = infoBox({
            title: 'Fused on-chip SRAM loop',
            rows: [
                { label: 'streamed', value: 'K_j, V_j from HBM', tone: 'teal' },
                { label: 'HBM writes', value: '0 intermediate scores', tone: 'green' },
            ],
            accent: 'teal',
            size: 27,
        })
        place(tileCard, tileStatusBox, 'center')

        s.add(
            hbmZone.hide(),
            sramZone.hide(),
            wallLanes.hide(),
            matrixTitle.hide(),
            scoreGrid.hide(),
            matrixNote.hide(),
            matrixNoteTiled.hide(),
            tileCard.hide(),
        )

        s.play(
            fadeIn(title, { duration: 0.6 }),
            fadeIn(source, { duration: 0.6 }),
            fadeIn(hbmZone.frame, { duration: 0.7 }),
            ...(hbmZone.title ? [fadeIn(hbmZone.title, { duration: 0.7 })] : []),
            fadeIn(hbmZone, { duration: 0.7 }),
            fadeIn(sramZone, { duration: 0.7 }),
            hbmBar.enter({ duration: 1.3 }),
            sramBar.enter({ duration: 1.1 }),
            fadeIn(matrixTitle, { duration: 0.7 }),
            scoreGrid.enter({ duration: 1.5 }),
        )
        s.play(
            hbmBar.insert({ name: 'S,P (N^2)', value: 52, color: 'red' }, { duration: 1.4 }),
            wallLanes.enter({ duration: 0.9 }),
            fadeIn(matrixNote, { duration: 0.7 }),
        )
        s.play(wallLanes.showAll({ duration: 5.8 }))
        s.play(indicate(hbmBar.part('S,P (N^2)'), { color: 'red', duration: 1.2 }))
        s.wait(2.8)

        // ── Chapter 2: Tile inside SRAM ─────────────────────────────────────
        s.chapter('Tile inside SRAM')
        s.caption('FlashAttention drops the N by N buffer and streams small K and V tiles through fast on-chip SRAM.', 12.2)

        const windows = scoreGrid.windows(4, { stride: 4 })
        const w00 = windows[0]![0]!
        const w01 = windows[0]![1]!
        const w10 = windows[1]![0]!
        const w11 = windows[1]![1]!

        s.play(
            fadeOut(wallLanes, { duration: 0.35 }),
            fadeOut(matrixNote, { duration: 0.25 }),
            hbmBar.remove('S,P (N^2)', { duration: 1.1 }),
            delay(fadeIn(tileCard, { duration: 0.6 }), 0.45),
            delay(fadeIn(matrixNoteTiled, { duration: 0.55 }), 0.45),
        )

        s.play(
            hbmBar.send('K1,V1', sramBar, { duration: 1.4 }),
            scoreGrid.light(w00, { color: 'teal', duration: 0.75 }),
        )
        s.wait(1.1)
        s.play(
            sramBar.send('K1,V1', hbmBar, { before: 'K2,V2', duration: 1.1 }),
            delay(hbmBar.send('K2,V2', sramBar, { duration: 1.2 }), 0.4),
            delay(scoreGrid.light(w01, { color: 'gold', duration: 0.7 }), 0.45),
        )
        s.wait(1.0)
        s.play(
            sramBar.send('K2,V2', hbmBar, { duration: 1.05 }),
            delay(hbmBar.send('K1,V1', sramBar, { duration: 1.15 }), 0.35),
            delay(scoreGrid.light(w10, { color: 'teal', duration: 0.65 }), 0.4),
        )
        s.play(
            sramBar.send('K1,V1', hbmBar, { before: 'K2,V2', duration: 1.05 }),
            delay(hbmBar.send('K2,V2', sramBar, { duration: 1.15 }), 0.35),
            delay(scoreGrid.light(w11, { color: 'gold', duration: 0.65 }), 0.4),
        )
        s.wait(1.8)

        // ── Chapter 3: Online softmax without the full row ──────────────────
        s.chapter('Online softmax without the full row')
        s.caption('When a new tile contains a larger score, rescaling by exp(m minus m prime) keeps the running sum exact.', 12.2)

        const [left3, right3] = kit.area.inset(8, 8).columns([1.08, 1], 44)
        const [tilesArea, stateArea] = left3!.rows([1.15, 1], 20)

        const rowLabel = kit.label('Query row q0 streamed in two 1 x 4 tiles', { color: 'ink' })
        const tile1Scores = [SCORES[0]!.slice(0, 4)]
        const tile2Scores = [SCORES[0]!.slice(4, 8)]
        const tile1Heat = heatmap(tile1Scores, {
            cellWidth: 102,
            cellHeight: 54,
            gap: 6,
            size: 26,
            valueSize: 26,
            labelSize: 26,
            values: true,
            domain: [-0.5, 2.5],
            colors: ['surface', 'blue', 'teal'],
            rowLabels: ['tile 1'],
            columnLabels: ['k0', 'k1', 'k2', 'k3'],
        })
        const tile2Heat = heatmap(tile2Scores, {
            cellWidth: 102,
            cellHeight: 54,
            gap: 6,
            size: 26,
            valueSize: 26,
            labelSize: 26,
            values: true,
            domain: [-0.5, 2.5],
            colors: ['surface', 'blue', 'gold'],
            rowLabels: ['tile 2'],
            columnLabels: ['k4', 'k5', 'k6', 'k7'],
        })
        place(column([rowLabel, tile1Heat, tile2Heat], { gap: 18, align: 'center' }), tilesArea!, 'center')

        const step0 = TILED.row0Steps[0]!
        const step1 = TILED.row0Steps[1]!

        const stateTable = table(
            [
                { key: 'stat', label: 'SRAM register', sample: 'running max  m' },
                { key: 'val', label: 'Value', align: 'right', mono: true, sample: '0.0000' },
                { key: 'status', label: 'Step', sample: 'rescaled', marks: true },
            ],
            [
                { id: 'max', stat: 'running max  m', val: step0.max.toFixed(2), status: { value: 'tile 1', state: 'pending' } },
                { id: 'sum', stat: 'denom sum  l', val: step0.sum.toFixed(3), status: { value: 'tile 1', state: 'pending' } },
                { id: 'out', stat: 'output  O[0,0]', val: step0.out[0]!.toFixed(4), status: { value: 'partial', state: 'pending' } },
            ],
            { size: 27, width: stateArea!.width - 24 },
        )
        place(stateTable, stateArea!, 'center')

        const eqInner = new Box(right3!.left + 32, right3!.top + 64, right3!.right - 32, right3!.bottom - 28)
        const [eqTopBox, eqMidBox, eqNoteBox] = eqInner.rows([1, 1, 0.8], 20)

        const eqHeader = kit.label('Exact online rescaling identity', { color: 'blue' })
        place(eqHeader, new Box(right3!.left + 20, right3!.top + 8, right3!.right - 20, right3!.top + 56), 'center')

        const eqStandard = tex(String.raw`P_{0,j} = \frac{e^{s_j - m}}{\sum_{k=1}^{N} e^{s_k - m}}`, { size: 38 })
        const eqOnline = tex(String.raw`m' = \max(m, \tilde{m}), \quad \ell' = e^{m - m'}\ell + \tilde{\ell}`, { size: 33 })
        for (const g of eqOnline.part("e^{m - m'}")) g.color('gold')
        place(eqStandard, eqTopBox!, 'center')
        place(eqOnline, eqTopBox!, 'center')

        const eqOutUpdate = tex(String.raw`O' = \frac{e^{m - m'}\ell\,O + \tilde{P} V_j}{\ell'}`, { size: 36 })
        for (const g of eqOutUpdate.part("e^{m - m'}")) g.color('gold')
        place(eqOutUpdate, eqMidBox!, 'center')

        const rescaleBadge = kit.note(
            `Tile 2 peak ${step1.max.toFixed(2)} > ${step0.max.toFixed(2)}: rescale by exp(${step0.max.toFixed(2)} - ${step1.max.toFixed(2)}) = ${step1.rescale.toFixed(3)}`,
            { color: 'gold', align: 'center' },
        )
        place(rescaleBadge, eqNoteBox!, 'center')

        s.add(
            rowLabel.hide(),
            tile1Heat.hide(),
            tile2Heat.hide(),
            stateTable.hide(),
            eqHeader.hide(),
            eqStandard.hide(),
            eqOnline.hide(),
            eqOutUpdate.hide(),
            rescaleBadge.hide(),
        )

        s.play(
            fadeOut([hbmZone, sramZone, matrixTitle, scoreGrid, matrixNoteTiled, tileCard], { duration: 0.4 }),
            delay(fadeIn(rowLabel, { duration: 0.5 }), 0.45),
            delay(tile1Heat.enter({ duration: 0.95 }), 0.5),
            delay(tile2Heat.enter({ duration: 0.95 }), 0.7),
            delay(stateTable.enter({ duration: 1.0 }), 0.55),
            delay(fadeIn(eqHeader, { duration: 0.55 }), 0.5),
            delay(write(eqStandard, { duration: 1.25 }), 0.55),
        )
        s.play(tile1Heat.light({ row: 0, col: [0, 3] }, { color: 'teal', duration: 0.6 }))
        s.wait(1.2)

        s.play(
            morphMatching(eqStandard, eqOnline, { duration: 1.45 }),
            delay(write(eqOutUpdate, { duration: 1.2 }), 0.55),
        )
        s.play(
            tile1Heat.light(null, { duration: 0.35 }),
            delay(tile2Heat.light({ row: 0, col: [0, 3] }, { color: 'gold', duration: 0.6 }), 0.2),
            stateTable.light('max', null, { duration: 0.45 }),
            stateTable.setCell('max', 'val', step1.max.toFixed(2), { duration: 0.6 }),
            stateTable.setCell('max', 'status', { value: 'updated', state: 'warn' }, { duration: 0.6 }),
            fadeIn(rescaleBadge, { duration: 0.65 }),
        )
        s.play(
            indicate(eqOnline.part("e^{m - m'}"), { color: 'gold', duration: 0.9 }),
            stateTable.light('sum', null, { duration: 0.45 }),
            stateTable.setCell('sum', 'val', step1.sum.toFixed(3), { duration: 0.6 }),
            stateTable.setCell('sum', 'status', { value: 'rescaled', state: 'pass' }, { duration: 0.6 }),
            delay(stateTable.setCell('out', 'val', step1.out[0]!.toFixed(4), { duration: 0.6 }), 0.25),
            delay(stateTable.setCell('out', 'status', { value: 'exact', state: 'pass' }, { duration: 0.6 }), 0.25),
        )
        s.play(stateTable.light('out', null, { duration: 0.45 }))
        s.wait(2.8)

        // ── Chapter 4: Exact output, less intermediate storage ─────────────────────
        s.chapter('Exact output, less intermediate storage')
        s.caption('Fusing tile operations avoids quadratic intermediate storage. HBM traffic still depends on sequence length, head dimension, and SRAM capacity.', 11.2)

        const [topCompare, botVerify] = kit.area.inset(10, 8).rows([1.15, 1], 28)

        const speedLanes = fitted(topCompare!.inset(16, 0), (width) =>
            lanes(
                ['Standard HBM', 'FlashAttention'],
                [
                    { lane: 'Standard HBM', start: 0, end: 1.5, label: 'Q K^T', color: 'blue' },
                    { lane: 'Standard HBM', start: 1.5, end: 7.4, label: 'HBM write + read S', color: 'red' },
                    { lane: 'Standard HBM', start: 7.4, end: 8.7, label: 'softmax', color: 'teal' },
                    { lane: 'Standard HBM', start: 8.7, end: 14.5, label: 'HBM write + read P', color: 'orange' },
                    { lane: 'Standard HBM', start: 14.5, end: 16.0, label: 'P V', color: 'blue' },
                    { id: 'fused', lane: 'FlashAttention', start: 0, end: 2.5, label: 'fused tile loop', color: 'teal' },
                ],
                {
                    domain: [0, 16],
                    width,
                    barHeight: 46,
                    pitch: 98,
                    size: 26,
                    axisLabel: 'Illustrative schedule; widths are not measured timings',
                },
            ),
        )
        place(speedLanes, topCompare!, 'center')

        const [verifyLeft, verifyRight] = botVerify!.columns([1.22, 1], 36)
        const verifyTable = table(
            [
                { key: 'metric', label: 'Metric (N = 8 check)' },
                { key: 'std', label: 'Standard', align: 'right', mono: true },
                { key: 'flash', label: 'FlashAttention', align: 'right', mono: true, marks: true },
            ],
            [
                {
                    id: 'o0',
                    metric: 'Output O[0, 0]',
                    std: STD_OUT[0]![0]!.toFixed(6),
                    flash: { value: TILED.out[0]![0]!.toFixed(6), state: 'pass' },
                },
                {
                    id: 'err',
                    metric: 'Max abs difference',
                    std: 'baseline',
                    flash: { value: maxDiff.toExponential(1), state: 'pass' },
                },
                {
                    id: 'mem',
                    metric: 'Extra HBM memory',
                    std: 'O(N^2)',
                    flash: { value: 'O(N)', state: 'pass' },
                },
            ],
            { size: 27, width: verifyLeft!.width - 16 },
        )
        place(verifyTable, verifyLeft!, 'center')

        const payoffCard = infoBox({
            title: 'Exact attention, fewer HBM accesses',
            rows: [
                { label: 'HBM traffic', value: 'Theta(N^2 d^2 / M)', tone: 'teal' },
                { label: 'SRAM M', value: 'd <= M <= N d', tone: 'blue' },
                { label: 'units', value: 'scalar elements', tone: 'dim' },
            ],
            accent: 'teal',
            size: 27,
        })
        place(payoffCard, verifyRight!, 'center')

        s.add(speedLanes.hide(), verifyTable.hide(), payoffCard.hide())

        s.play(
            fadeOut([rowLabel, tile1Heat, tile2Heat, stateTable, eqHeader, eqOnline, eqOutUpdate, rescaleBadge], { duration: 0.4 }),
            delay(speedLanes.enter({ duration: 0.95 }), 0.45),
            delay(verifyTable.enter({ duration: 1.05 }), 0.65),
            delay(fadeIn(payoffCard, { shift: [0, 16], duration: 0.85 }), 0.8),
        )
        s.play(speedLanes.showAll({ duration: 3.8 }))
        s.play(
            spotlight([payoffCard, verifyTable], {
                keep: [title, source, speedLanes],
                dim: 0.25,
                duration: 0.85,
            }),
            verifyTable.light('err', null, { duration: 0.55 }),
        )
        s.wait(2.8)
        s.play(spotlight(null, { duration: 0.7 }))
        s.wait(2.8)
    },
)
