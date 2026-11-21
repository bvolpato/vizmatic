import {
    BAR_STATES,
    Box,
    assertEqual,
    barChart,
    delay,
    dotProduct,
    fadeIn,
    fadeOut,
    film,
    infoBox,
    layerStack,
    place,
    sceneKit,
    stableSoftmax,
    text,
    tokens,
} from 'vizmatic/stage'

// Deterministic 4D residual stream and 5-token unembedding matrix so every probability
// shown by the logit lens comes from real dot products and softmax at build time.
const X_RAW = [0.20, 0.10, 0.15, -0.10] as const
const X_EMBED = [0.50, -0.20, 0.30, -0.35] as const
const D_ATTN = [0.55, 0.65, -0.15, 0.30] as const
const X_ATTN = X_EMBED.map((v, i) => Number((v + D_ATTN[i]!).toFixed(2)))
const D_MLP = [0.75, 0.50, -0.30, 0.25] as const
const X_MLP = X_ATTN.map((v, i) => Number((v + D_MLP[i]!).toFixed(2)))

const VOCAB = [
    { token: 'Paris', weights: [1.35, 1.25, -0.40, 0.50] },
    { token: 'Lyon', weights: [0.65, 0.55, 0.30, -0.20] },
    { token: 'London', weights: [0.50, -0.25, 0.90, -0.40] },
    { token: 'Berlin', weights: [0.30, -0.45, 0.70, -0.60] },
    { token: 'Rome', weights: [0.20, 0.10, 0.60, -0.80] },
] as const

const logitLens = (x: readonly number[]): number[] =>
    stableSoftmax(VOCAB.map((entry) => dotProduct(entry.weights, x)))

const P_EMBED = logitLens(X_EMBED)
const P_ATTN = logitLens(X_ATTN)
const P_MLP = logitLens(X_MLP)

// Verify residual addition and monotonic confidence gain on the true token ("Paris").
assertEqual(X_ATTN[0]!, 1.05, 'attention residual stream component 0 equals x0 + dAttn')
assertEqual(X_MLP[0]!, 1.80, 'MLP residual stream component 0 equals x1 + dMlp')
assertEqual(Math.abs(P_MLP.reduce((a, b) => a + b, 0) - 1) < 1e-9, true, 'softmax probabilities sum to 1')
assertEqual(P_ATTN[0]! > P_EMBED[0]! && P_MLP[0]! > P_ATTN[0]!, true, 'Paris probability climbs after attention and MLP')
assertEqual(P_MLP[0]! > 0.80, true, 'Paris exceeds 80% after the MLP update')

export default film(
    {
        title: 'The residual stream: how layers refine a prediction',
        description:
            'A transformer reads and writes one shared vector through additive residual branches. Logit-lens projections reveal how attention and the MLP progressively sharpen the next-token distribution.',
        look: 'paper',
        font: 'text-serif',
        fps: 60,
        poster: 24.5,
    },
    (s) => {
        const kit = sceneKit({ size: 38, source: { y: -420 } })
        const title = kit.heading('The residual stream: how layers refine a prediction')
        const source = kit.source('Elhage et al., "A Mathematical Framework for Transformer Circuits," Anthropic 2021 · toy 4D residual model')
        s.add(title, source)

        const stageArea = new Box(
            kit.area.left + 8,
            kit.area.top + 14,
            kit.area.right - 8,
            kit.area.bottom - 14,
        )
        const [leftCol, rightCol] = stageArea.columns([0.92, 1.08], 36)
        const [promptRow, chartSlot, cardSlot] = rightCol!.rows([0.21, 0.49, 0.30], 18)

        // Top of right column: prompt strip
        const promptStrip = tokens(
            [
                { text: 'The', state: 'kept' },
                { text: 'capital', state: 'kept' },
                { text: 'of', state: 'kept' },
                { text: 'France', state: 'kept' },
                { text: 'is', state: 'generated' },
            ],
            {
                label: 'prompt',
                width: Math.round(promptRow!.width - 140),
                size: 27,
                rowSize: 26,
                gap: 8,
                spans: [{ from: 1, to: 3, label: 'context read by attention', color: 'teal' }],
            },
        )
        place(promptStrip, promptRow!, 'center')

        // Full-height left column: Transformer residual layer stack
        const stack = layerStack(
            [
                { id: 'embed', label: 'Embed', color: 'blue', shape: '(T, 4)' },
                {
                    label: 'Residual block',
                    repeat: 'L',
                    layers: [
                        { branch: [{ id: 'attn', label: 'Norm + Attention', color: 'teal' }] },
                        { branch: [{ id: 'mlp', label: 'Norm + MLP', color: 'orange' }] },
                    ],
                },
                { id: 'unembed', label: 'Unembed Wᵀ', color: 'purple', shape: '(T, V)' },
            ],
            {
                cells: 4,
                digits: 2,
                size: 26,
                blockHeight: 48,
                shape: 'id',
            },
        )
        place(stack, leftCol!, 'center')

        // Middle of right column: Logit-lens probability readout
        const lensTitle = kit.label('Logit lens: P(next token | residual stream)', { color: 'ink' })
        const probChart = barChart(
            VOCAB.map((entry, idx) => ({
                label: entry.token,
                value: P_EMBED[idx]!,
                color: idx === 0 ? 'teal' : 'blue',
            })),
            {
                width: Math.round(chartSlot!.width - 96),
                height: 245,
                max: 1.0,
                ticks: [0, 0.25, 0.5, 0.75, 1.0],
                showValues: true,
                format: (v) => `${Math.round(v * 100)}%`,
                labelSize: 26,
                states: BAR_STATES,
            },
        )
        place(lensTitle, new Box(chartSlot!.left, chartSlot!.top, chartSlot!.right, chartSlot!.top + 52), 'left')
        place(probChart, new Box(chartSlot!.left, chartSlot!.top + 56, chartSlot!.right, chartSlot!.bottom), 'center')

        const embedCard = infoBox({
            title: 'Stage 1: Token embedding alone',
            rows: [
                { label: 'stream x₀', value: '[0.50, -0.20, 0.30, -0.35]', tone: 'blue' },
                { label: 'P(Paris)', value: `${Math.round(P_EMBED[0]! * 100)}% (context not read yet)`, tone: 'dim' },
            ],
            accent: 'blue',
            size: 26,
        })
        const attnCard = infoBox({
            title: 'Stage 2: Attention writes context delta',
            rows: [
                { label: 'Δ_attn', value: '[+0.55, +0.65, -0.15, +0.30]', tone: 'teal' },
                { label: 'x₁ = x₀ + Δ', value: '[1.05, 0.45, 0.15, -0.05]', tone: 'teal' },
                { label: 'P(Paris)', value: `${Math.round(P_ATTN[0]! * 100)}% · French cities rise`, tone: 'green' },
            ],
            accent: 'teal',
            size: 26,
        })
        const mlpCard = infoBox({
            title: 'Stage 3: MLP sharpens the answer',
            rows: [
                { label: 'Δ_mlp', value: '[+0.75, +0.50, -0.30, +0.25]', tone: 'orange' },
                { label: 'x₂ = x₁ + Δ', value: '[1.80, 0.95, -0.15, 0.20]', tone: 'orange' },
                { label: 'P(Paris)', value: `${Math.round(P_MLP[0]! * 100)}% · top prediction`, tone: 'green' },
            ],
            accent: 'orange',
            size: 26,
        })

        // Close-up card used by stack.open('attn', ...)
        const attnDetail = infoBox({
            title: 'Inside Attention: additive update',
            rows: [
                { label: 'queries', value: '"is" attends to "capital", "France"', tone: 'teal' },
                { label: 'residual', value: 'adds Δ_attn without erasing x₀', tone: 'blue' },
            ],
            accent: 'teal',
            size: 26,
        })

        for (const card of [embedCard, attnCard, mlpCard, attnDetail]) {
            place(card, cardSlot!, 'center')
        }

        s.add(
            promptStrip.hide(),
            stack.hide(),
            lensTitle.hide(),
            probChart.hide(),
            embedCard.hide(),
            attnCard.hide(),
            mlpCard.hide(),
            attnDetail.hide(),
        )

        // ── Chapter 1: Enter the residual highway ──────────────────────────────
        s.chapter('Embed onto the residual stream')
        s.caption('A transformer starts by embedding the current token onto a shared residual highway.', 9.6)

        s.play(
            promptStrip.enter({ duration: 0.9 }),
            delay(stack.enter({ duration: 1.2 }), 0.3),
        )
        s.play(
            stack.feed(X_RAW, { duration: 0.7 }),
            stack.light('embed', { duration: 0.4 }),
        )
        s.play(
            stack.pass('embed', X_EMBED, { duration: 1.4 }),
            delay(fadeIn(lensTitle, { duration: 0.45 }), 0.4),
            delay(probChart.enter({ duration: 0.9 }), 0.5),
            delay(fadeIn(embedCard, { duration: 0.55 }), 0.7),
        )
        s.play(probChart.mark('Paris', 'target', { duration: 0.5 }))
        s.wait(2.2)

        // ── Chapter 2: Attention copies context into the stream ────────────────
        s.chapter('Attention adds context')
        s.caption('Attention reads earlier tokens and adds a residual delta to the stream without overwriting it.', 10.6)

        s.play(
            fadeOut(embedCard, { duration: 0.35 }),
            stack.light('attn', { duration: 0.45 }),
            delay(stack.open('attn', attnDetail, { duration: 0.85 }), 0.25),
        )
        s.wait(1.8)
        s.play(
            stack.close({ duration: 0.45 }),
            delay(stack.pass('attn', X_ATTN, { duration: 2.3 }), 0.35),
            delay(probChart.update(P_ATTN, { duration: 1.1 }), 1.85),
            delay(fadeIn(attnCard, { duration: 0.55 }), 2.0),
        )
        s.wait(2.4)

        // ── Chapter 3: MLP recalls the fact and sharpens the distribution ──────
        s.chapter('MLP sharpens the prediction')
        s.caption('The MLP branch adds a second delta that amplifies the target logit and lifts Paris past 80 percent.', 10.4)

        s.play(
            fadeOut(attnCard, { duration: 0.35 }),
            stack.light('mlp', { duration: 0.45 }),
        )
        s.play(
            stack.pass('mlp', X_MLP, { duration: 2.3 }),
            delay(probChart.update(P_MLP, { duration: 1.1 }), 1.55),
            delay(fadeIn(mlpCard, { duration: 0.55 }), 1.75),
        )
        s.wait(2.3)

        // ── Chapter 4: Unembed to final token ──────────────────────────────────
        s.chapter('Unembed and emit next token')
        s.caption('Unembedding projects the final residual vector onto the vocabulary and selects Paris.', 7.6)

        s.play(
            stack.light('unembed', { duration: 0.45 }),
            stack.pass('unembed', X_MLP, { duration: 1.3 }),
            delay(probChart.mark('Paris', 'chosen', { duration: 0.55 }), 0.9),
            delay(promptStrip.append({ text: 'Paris', state: 'generated' }, { duration: 0.85 }), 1.1),
        )
        const takeaway = text('Every layer communicates solely by adding to one shared residual vector.', {
            size: 26,
            color: 'dim',
        })
        place(takeaway, new Box(kit.area.left, kit.area.bottom - 14, kit.area.right, kit.area.bottom + 24), 'center')
        s.add(takeaway.hide())
        s.play(fadeIn(takeaway, { duration: 0.6 }))
        s.wait(2.8)
    },
)
