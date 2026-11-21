import {
    Box,
    assertEqual,
    bitField,
    column,
    delay,
    fadeIn,
    fadeOut,
    film,
    histogram,
    infoBox,
    numberLine,
    place,
    sampleGaussian,
    sceneKit,
    seededRandom,
    text,
} from 'vizmatic/stage'

// Exact OCP FP8 E4M3FN positive representable grid on [0, 4] (bias = 7, 3 mantissa bits).
// Spacing doubles at each power of 2: 0.0625 on [0.5, 1], 0.125 on [1, 2], 0.25 on [2, 4].
function buildE4M3Levels(): number[] {
    const out: number[] = [0]
    // Subnormals (e = 0, m = 1..7): 2^-6 * m/8
    for (let m = 1; m <= 7; m++) out.push(Math.pow(2, -6) * (m / 8))
    // Normals (e = 1..15, excluding NaN at e=15, m=7)
    for (let e = 1; e <= 15; e++) {
        const mMax = e === 15 ? 6 : 7
        for (let m = 0; m <= mMax; m++) {
            out.push(Math.pow(2, e - 7) * (1 + m / 8))
        }
    }
    return out
}

const E4M3_POS = buildE4M3Levels()
const E4M3_MAX = E4M3_POS[E4M3_POS.length - 1]!
assertEqual(E4M3_MAX, 448, 'OCP FP8 E4M3FN max finite value is 448')
assertEqual(E4M3_POS[1]!, Math.pow(2, -9), 'smallest positive E4M3 subnormal is 2^-9')

function quantizeE4M3(value: number): number {
    const sign = value < 0 ? -1 : 1
    const abs = Math.min(Math.abs(value), E4M3_MAX)
    let best = 0
    let bestErr = Infinity
    for (let i = 0; i < E4M3_POS.length; i++) {
        const level = E4M3_POS[i]!
        const err = Math.abs(abs - level)
        if (err < bestErr || (err === bestErr && i % 2 === 0)) {
            bestErr = err
            best = level
        }
    }
    return sign * best
}

// Visible ticks on [0, 4] showing non-uniform floating-point spacing.
const LINE_TICKS = E4M3_POS.filter((v) => v === 0 || (v >= 0.25 && v <= 4))
const LABELED_TICKS = [0, 0.5, 1, 2, 3, 4]

// Three illustrative weights in [0, 4] and their exact E4M3 nearest levels.
const PROBE_W1 = 0.68
const PROBE_W2 = 1.44
const PROBE_W3 = 3.11
const SNAP_W1 = quantizeE4M3(PROBE_W1) // 0.6875
const SNAP_W2 = quantizeE4M3(PROBE_W2) // 1.500
const SNAP_W3 = quantizeE4M3(PROBE_W3) // 3.000
assertEqual(SNAP_W1, 0.6875, '0.68 rounds to 0.6875 in E4M3')
assertEqual(SNAP_W2, 1.5, '1.44 rounds to 1.5 in E4M3')
assertEqual(SNAP_W3, 3.0, '3.11 rounds to 3.0 in E4M3')

// 256 deterministic deep-transformer projection weights (std = 0.002, inside E4M3 subnormal zone).
const WEIGHT_STD = 0.002
const rng = seededRandom(42)
const WEIGHTS = Array.from({ length: 256 }, () => sampleGaussian(rng) * WEIGHT_STD)
const ABS_MAX = Math.max(...WEIGHTS.map((w) => Math.abs(w)))
const TENSOR_SCALE = E4M3_MAX / ABS_MAX

// Compare relative error |w - q(w)| / sigma (in percent of weight std) unscaled vs AbsMax-scaled.
const unscaledRelErrPct = WEIGHTS.map((w) => Math.min(50, (Math.abs(w - quantizeE4M3(w)) / WEIGHT_STD) * 100))
const scaledRelErrPct = WEIGHTS.map((w) => {
    const q = quantizeE4M3(w * TENSOR_SCALE) / TENSOR_SCALE
    return Math.min(50, (Math.abs(w - q) / WEIGHT_STD) * 100)
})
const rmse = (arr: readonly number[]) => Math.sqrt(arr.reduce((sum, x) => sum + x * x, 0) / arr.length)
const UNSCALED_RMSE = rmse(unscaledRelErrPct)
const SCALED_RMSE = rmse(scaledRelErrPct)
assertEqual(SCALED_RMSE < UNSCALED_RMSE * 0.5, true, 'per-tensor AbsMax scaling cuts FP8 RMSE by more than half')

export default film(
    {
        title: 'FP8 quantization: shrinking 32 bits down to 8',
        description:
            'Inspect how FP32, BF16, and FP8 allocate sign, exponent, and mantissa bits, watch real weights snap to non-uniform E4M3 levels, and see per-tensor scaling rescue small weights from subnormal loss.',
        look: 'blueprint',
        font: 'text-serif',
        fps: 60,
        poster: 26.5,
    },
    (s) => {
        const kit = sceneKit({ size: 38, source: { y: -420 } })
        const title = kit.heading('FP8 quantization: shrinking 32 bits down to 8')
        const source = kit.source('OCP FP8 Specification (E4M3FN, bias 7, max 448) · 256 deterministic N(0, 0.002²) weights')
        s.add(title, source)

        const mainArea = new Box(
            kit.area.left + 12,
            kit.area.top + 32,
            kit.area.right - 12,
            kit.area.bottom - 14,
        )

        // ── Chapter 1: Bit layouts (FP32 -> BF16 -> FP8 E4M3 & E5M2) ───────────
        s.chapter('Budgeting 8 bits')
        s.caption('Cutting a weight from 32 bits to 8 quarters memory bandwidth, leaving only 7 bits for range and precision.', 11.4)

        const [bfRowsArea, bfFooter] = mainArea.rows([0.76, 0.24], 12)
        const fp32Label = kit.left('FP32  (32 bits · 4 bytes)', { color: 'dim' })
        const fp32Bits = bitField(
            [
                { bits: 1, label: 'sign', value: '0', color: 'orange' },
                { bits: 8, label: 'exponent (8)', value: '01111111', color: 'teal' },
                { bits: 23, label: 'mantissa (23)', value: '01100000000000000000000', color: 'blue' },
            ],
            { width: 1220, height: 50, minWidth: 96, size: 27, numbers: false },
        )

        const bf16Label = kit.left('BF16  (16 bits · 2 bytes)', { color: 'dim' })
        const bf16Bits = bitField(
            [
                { bits: 1, label: 'sign', value: '0', color: 'orange' },
                { bits: 8, label: 'exponent (8)', value: '01111111', color: 'teal' },
                { bits: 7, label: 'mantissa (7)', value: '0110000', color: 'blue' },
            ],
            { width: 880, height: 50, minWidth: 96, size: 27, numbers: false },
        )

        const e4m3Label = kit.left('FP8 E4M3  (8 bits · 1 byte · weights & activations)', { color: 'gold' })
        const e4m3Bits = bitField(
            [
                { bits: 1, label: 'sign', value: '0', color: 'orange' },
                { bits: 4, label: 'exponent (4)', value: '0111', color: 'teal' },
                { bits: 3, label: 'mantissa (3)', value: '011', color: 'gold' },
            ],
            { width: 640, height: 50, minWidth: 96, size: 27, numbers: false },
        )

        const bitStack = column(
            [
                column([fp32Label, fp32Bits], { gap: 16, align: 'left' }),
                column([bf16Label, bf16Bits], { gap: 16, align: 'left' }),
                column([e4m3Label, e4m3Bits], { gap: 16, align: 'left' }),
            ],
            { gap: 12, align: 'left' },
        )
        place(bitStack, bfRowsArea!, 'center')

        const decodeCard = infoBox({
            title: 'Live E4M3 decode: (-1)ˢ × 2ᵉ⁻⁷ × (1 + m/8)',
            rows: [
                { label: '0 | 0111 | 011', value: '2⁰ × (1 + 3/8) = 1.375', tone: 'gold' },
                { label: 'tradeoff', value: 'only 254 finite values across ±448', tone: 'teal' },
            ],
            accent: 'gold',
            size: 27,
        })
        place(decodeCard, bfFooter!, 'center')

        s.add(fp32Label.hide(), fp32Bits.hide(), bf16Label.hide(), bf16Bits.hide(), e4m3Label.hide(), e4m3Bits.hide(), decodeCard.hide())

        s.play(
            fadeIn(fp32Label, { duration: 0.45 }),
            fp32Bits.enter({ duration: 1.0 }),
        )
        s.play(
            fadeIn(bf16Label, { duration: 0.45 }),
            bf16Bits.enter({ duration: 0.9 }),
            delay(fadeIn(e4m3Label, { duration: 0.45 }), 0.5),
            delay(e4m3Bits.enter({ duration: 0.9 }), 0.55),
        )
        s.play(fadeIn(decodeCard, { duration: 0.6 }))
        s.wait(1.4)
        // Flip exponent 0111 -> 1000 (+1 power of 2 -> 2.75) and mantissa -> 000 (3.00 -> 2.00)
        s.play(
            e4m3Bits.setValue('exponent (4)', '1000', { duration: 0.8 }),
            delay(e4m3Bits.setValue('mantissa (3)', '100', { duration: 0.8 }), 0.5),
        )
        s.wait(1.8)

        // ── Chapter 2: Non-uniform grid & quantization rounding ────────────────
        s.chapter('Non-uniform quantization grid')
        s.caption('Floating-point ticks double in spacing after every power of two, so larger weights suffer larger absolute rounding error.', 12.6)

        const [lineHeaderSlot, lineBodySlot, lineCardsSlot] = mainArea.rows([0.14, 0.50, 0.36], 18)
        const lineHeading = kit.label('Exact representable FP8 E4M3 ticks on [0, 4]', { color: 'ink' })
        place(lineHeading, lineHeaderSlot!, 'center')

        const gridLine = numberLine({
            range: [0, 4],
            length: 1460,
            ticks: LINE_TICKS,
            tickLabels: LABELED_TICKS,
            format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
            size: 27,
            labelSize: 26,
            points: [
                { name: 'w1', value: PROBE_W1, label: 'w₁ = 0.68', color: 'teal' },
                { name: 'w2', value: PROBE_W2, label: 'w₂ = 1.44', color: 'gold' },
                { name: 'w3', value: PROBE_W3, label: 'w₃ = 3.11', color: 'orange' },
            ],
        })
        place(gridLine, lineBodySlot!, 'center')

        const errBracket = gridLine.bracket('w3', PROBE_W3, {
            side: 'under',
            color: 'red',
            label: (gap) => `Δ = ${gap.toFixed(2)}`,
        })

        const snapCard = infoBox({
            title: 'Quantization step doubles with magnitude',
            rows: [
                { label: 'w₁ (0.68 → 0.6875)', value: 'step = 0.0625 · |err| = 0.0075', tone: 'teal' },
                { label: 'w₂ (1.44 → 1.500)', value: 'step = 0.125 · |err| = 0.060', tone: 'gold' },
                { label: 'w₃ (3.11 → 3.000)', value: 'step = 0.250 · |err| = 0.110', tone: 'red' },
            ],
            accent: 'teal',
            size: 27,
        })
        place(snapCard, lineCardsSlot!, 'center')

        s.add(lineHeading.hide(), gridLine.hide(), errBracket.hide(), snapCard.hide())

        s.play(
            fadeOut([fp32Label, fp32Bits, bf16Label, bf16Bits, e4m3Label, e4m3Bits, decodeCard], { duration: 0.4 }),
            delay(fadeIn(lineHeading, { duration: 0.45 }), 0.4),
            delay(gridLine.enter({ duration: 1.5 }), 0.45),
        )
        s.wait(1.4)
        s.play(
            gridLine.snap(['w1', 'w2', 'w3'], { duration: 1.4 }),
            delay(fadeIn(errBracket, { duration: 0.6 }), 0.8),
            delay(fadeIn(snapCard, { duration: 0.6 }), 0.9),
        )
        s.wait(4.2)

        // ── Chapter 3: Per-tensor AbsMax scaling rescues small weights ─────────
        s.chapter('Per-tensor scaling beats subnormal loss')
        s.caption('Typical transformer weights sit near the E4M3 subnormal cliff. Scaling by 448 over max magnitude cuts quantization error sharply.', 13.0)

        const [histCol, summaryCol] = mainArea.columns([1.14, 0.86], 32)
        const histTitle = kit.label('Relative quantization error (% of σ) · 256 weights', { color: 'ink' })
        const errorHist = histogram(unscaledRelErrPct, {
            width: Math.round(histCol!.width - 84),
            height: 410,
            bins: 20,
            range: [0, 50],
            max: 210,
            colors: ['orange', 'red'],
            labelSize: 26,
        })
        const scaledOutline = errorHist.outline(scaledRelErrPct, { color: 'teal', width: 4.5 })

        place(histTitle, new Box(histCol!.left, histCol!.top, histCol!.right, histCol!.top + 52), 'left')
        place(errorHist, new Box(histCol!.left, histCol!.top + 58, histCol!.right, histCol!.bottom - 10), 'center')

        const unscaledCard = infoBox({
            title: 'Raw FP8 E4M3 (unscaled)',
            rows: [
                { label: 'weight std σ', value: '0.002 (< 2⁻⁶ subnormal)', tone: 'orange' },
                { label: 'rel. RMSE', value: `${UNSCALED_RMSE.toFixed(1)}% of σ`, tone: 'red' },
            ],
            accent: 'orange',
            size: 27,
        })
        const scaledCard = infoBox({
            title: 'AbsMax scaled FP8',
            rows: [
                { label: 'scale s', value: `${Math.round(TENSOR_SCALE).toLocaleString('en-US')}× (448 / max|w|)`, tone: 'teal' },
                { label: 'rel. RMSE', value: `${SCALED_RMSE.toFixed(1)}% (${(UNSCALED_RMSE / SCALED_RMSE).toFixed(1)}× lower)`, tone: 'green' },
            ],
            accent: 'teal',
            size: 27,
        })
        const [cardTop, cardBot] = summaryCol!.rows([1, 1], 24)
        place(unscaledCard, cardTop!, 'center')
        place(scaledCard, cardBot!, 'center')

        s.add(histTitle.hide(), errorHist.hide(), scaledOutline.hide(), unscaledCard.hide(), scaledCard.hide())

        s.play(
            fadeOut([lineHeading, gridLine, errBracket, snapCard], { duration: 0.4 }),
            delay(fadeIn(histTitle, { duration: 0.45 }), 0.45),
            delay(errorHist.fillUp({ duration: 1.9 }), 0.5),
            delay(fadeIn(unscaledCard, { duration: 0.55 }), 0.9),
        )
        s.wait(1.6)
        s.play(
            scaledOutline.fillUp({ duration: 1.9 }),
            delay(fadeIn(scaledCard, { duration: 0.55 }), 0.8),
        )
        const closingNote = text('One float32 scale per tensor unlocks 4× smaller weights with minimal accuracy loss.', {
            size: 27,
            color: 'dim',
        })
        place(closingNote, new Box(kit.area.left, kit.area.bottom - 12, kit.area.right, kit.area.bottom + 24), 'center')
        s.add(closingNote.hide())
        s.play(fadeIn(closingNote, { duration: 0.55 }))
        s.wait(3.2)
    },
)
