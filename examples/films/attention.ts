/**
 * Scaled dot-product attention, computed for real on small illustrative vectors.
 * Every number on screen is produced by the arithmetic in this file: scores from
 * Q K^T, scaling by sqrt(d), softmax per row, and the weighted sum of values.
 */
import {
    Node, dynamic, fade, fadeIn, fadeOut, film, line, linear, morphMatching, parseColor, parseSvgPath, rect, seq, smoother, text, tex, to, write, mixColor,
    type Rgba,
} from 'vizmatic/stage'

const WORDS = ['the', 'river', 'bank', 'flooded', 'last', 'spring'] as const
const D = 4
const Q = [[0, 0.2, 0.4, 0.5], [0.8, 0.1, 0.1, 0.9], [1.7, 0.1, 0, 0.8], [1.5, 0.4, 0.2, 0.1], [0, 1.7, 0, 0], [0.3, 1.5, 0.1, 0.4]]
const K = [[0.1, 0, 1.6, 0], [2, 0.1, 0, 0.3], [0.9, 0, 0, 0.2], [1.5, 0.2, 0, 1.4], [0, 1.6, 0.3, 0], [0.4, 1.8, 0, 0.1]]
const V = [[0.1, 0.2, 1.5, 0.1], [1.8, 0.3, 0.1, 0.6], [1, 1, 0.2, 0.3], [1.5, 0.2, 0.1, 1.7], [0.1, 1.6, 0.4, 0.2], [0.5, 1.8, 0.1, 0.3]]
const BANK = 2

const dotProduct = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, i) => sum + value * b[i]!, 0)
const RAW = Q.map((q) => K.map((k) => dotProduct(q, k)))
const SCALED = RAW.map((row) => row.map((value) => value / Math.sqrt(D)))
const WEIGHTS = SCALED.map((row) => {
    const exps = row.map(Math.exp)
    const total = exps.reduce((sum, value) => sum + value, 0)
    return exps.map((value) => value / total)
})
const OUTPUT = Array.from({ length: D }, (_, c) => WEIGHTS[BANK]!.reduce((sum, weight, j) => sum + weight * V[j]![c]!, 0))

const CELL = 92
const MATRIX_X = -566, MATRIX_Y = -404
const STRIP = 22
const COLUMN = 480
const VALUE_X = 66

export default film({
    title: 'Attention, computed',
    description: 'Queries, keys, and values produce a live heatmap as softmax(QK^T / sqrt(d)) V builds up term by term.',
    fps: 60,
    bloom: 0.07,
}, (s) => {
    const fill = s.value(0)
    const scaled = s.value(0)
    const soft = s.value(0)
    const focus = s.value(0)
    const arcs = s.value(0)
    const flow = s.value(0)

    const cellValue = (i: number, j: number): number => {
        const raw = RAW[i]![j]!, half = SCALED[i]![j]!
        const before = raw + (half - raw) * scaled.value
        return before + (WEIGHTS[i]![j]! - before) * soft.value
    }
    const highest = () => {
        let best = 0
        for (let i = 0; i < WORDS.length; i++) for (let j = 0; j < WORDS.length; j++) best = Math.max(best, cellValue(i, j))
        return best
    }

    const groundTone = parseColor('bg')
    const inkTone = parseColor('ink')
    const blueTone = parseColor('blue')
    const heatStops = [mixColor(groundTone, blueTone, 0.1), mixColor(groundTone, blueTone, 0.48), parseColor('teal'), parseColor('yellow')]
    const heat = (amount: number): Rgba => {
        const at = Math.max(0, Math.min(1, amount)) * (heatStops.length - 1)
        const index = Math.min(heatStops.length - 2, Math.floor(at))
        return mixColor(heatStops[index]!, heatStops[index + 1]!, at - index)
    }
    const strip = (values: readonly number[], color: string, x: number, y: number, size: number, vertical = false, alpha = 1): Node[] => {
        const tone = parseColor(color)
        return values.map((value, c) => {
            const shade = mixColor(groundTone, tone, Math.min(1, 0.14 + value / 1.9))
            const px = x + (vertical ? 0 : c * (size + 2)), py = y + (vertical ? c * (size + 2) : 0)
            return rect(size, size, { fill: shade, stroke: null, radius: 2 }).at(px + size / 2, py + size / 2).opacity(alpha)
        })
    }

    // ── The matrix ──────────────────────────────────────────────────────────

    const rowY = (i: number) => MATRIX_Y + i * CELL
    const colX = (j: number) => MATRIX_X + j * CELL

    const matrix = dynamic(() => {
        const items: Node[] = []
        const shown = fill.value
        const top = highest()
        for (let i = 0; i < WORDS.length; i++) {
            for (let j = 0; j < WORDS.length; j++) {
                const order = i * WORDS.length + j
                const amount = Math.max(0, Math.min(1, shown - order))
                if (amount <= 0) continue
                const value = cellValue(i, j)
                const intensity = value / top
                const color = heat(intensity)
                items.push(rect(CELL - 3, CELL - 3, { fill: color, stroke: null, radius: 3 }).at(colX(j) + CELL / 2, rowY(i) + CELL / 2).opacity(amount))
                const label = text(value.toFixed(2), { font: 'mono', size: 23, color: intensity > 0.52 ? groundTone : inkTone })
                items.push(label.moveTo([colX(j) + CELL / 2, rowY(i) + CELL / 2]).opacity(amount))
            }
        }
        const f = focus.value
        if (f > 0) {
            items.push(rect(CELL * WORDS.length + 2, CELL + 2, { stroke: 'yellow', width: 3, radius: 5 })
                .at(MATRIX_X + (CELL * WORDS.length) / 2, rowY(BANK) + CELL / 2).opacity(f))
        }
        // The scan cursor shows which pair the current dot product belongs to.
        if (shown > 0 && shown < WORDS.length * WORDS.length) {
            const index = Math.floor(shown)
            const i = Math.floor(index / WORDS.length), j = index % WORDS.length
            items.push(rect(CELL - 1, CELL - 1, { stroke: 'ink', width: 2.6, radius: 4 }).at(colX(j) + CELL / 2, rowY(i) + CELL / 2))
        }
        return items
    })

    const rowLabels = new Node()
    const colLabels = new Node()
    WORDS.forEach((word, i) => {
        rowLabels.add(text(word, { size: 24, color: i === BANK ? 'yellow' : 'ink' }).alignTo([MATRIX_X - 124, 0], 'right').moveTo([0, 0]))
        const row = rowLabels.children[i]!
        row.alignTo([MATRIX_X - 124, 0], 'right')
        const b = row.bounds()
        row.shift(0, rowY(i) + CELL / 2 - (b.y + b.height / 2))
        colLabels.add(text(word, { size: 22, color: i === BANK ? 'yellow' : 'ink' }).moveTo([colX(i) + CELL / 2, MATRIX_Y - 60]))
    })
    const qStrips = new Node().add(...Q.flatMap((values, i) => strip(values, 'blue', MATRIX_X - 112, rowY(i) + CELL / 2 - STRIP / 2, STRIP)))
    const kStrips = new Node().add(...K.flatMap((values, j) => strip(values, 'teal', colX(j) + (CELL - (STRIP * 4 + 6) * 0.84) / 2, MATRIX_Y - 32, STRIP * 0.84)))
    const qTag = tex('Q', { size: 30, color: 'blue', display: false }).moveTo([MATRIX_X - 112 + 46, MATRIX_Y - 28])
    const kTag = tex('K', { size: 30, color: 'teal', display: false }).moveTo([MATRIX_X + CELL * WORDS.length + 30, MATRIX_Y - 24])
    const sums = dynamic(() => {
        if (soft.value <= 0) return null
        return WORDS.map((_, i) => {
            const total = WEIGHTS[i]!.reduce((sum, value) => sum + value, 0)
            const row = text(`= ${total.toFixed(2)}`, { font: 'mono', size: 20, color: 'dim' })
            return row.alignTo([MATRIX_X + CELL * WORDS.length + 10, 0], 'left').moveTo([MATRIX_X + CELL * WORDS.length + 46, rowY(i) + CELL / 2]).opacity(soft.value)
        })
    })

    // ── Values and the output ───────────────────────────────────────────────

    const vStrips = new Node().add(...V.flatMap((values, i) => strip(values, 'purple', VALUE_X + 112, rowY(i) + CELL / 2 - STRIP / 2, STRIP)))
    const vTag = tex('V', { size: 30, color: 'purple', display: false }).moveTo([VALUE_X + 158, MATRIX_Y - 24])
    const OUT_Y = 196
    const outTag = tex('z_{\\text{bank}}', { size: 30, color: 'yellow', display: false }).moveTo([VALUE_X + 158, OUT_Y - 40])
    const output = dynamic(() => {
        const a = flow.value
        const items: Node[] = []
        if (a > 0 && a < 1) {
            // Each word's value travels to the output, thinned by its attention share.
            WORDS.forEach((_, j) => {
                const local = Math.max(0, Math.min(1, a * 1.5 - j * 0.1))
                if (local <= 0 || local >= 1) return
                const eased = local * local * (3 - 2 * local)
                const y = rowY(j) + CELL / 2 - STRIP / 2 + (OUT_Y - (rowY(j) + CELL / 2 - STRIP / 2)) * eased
                items.push(...strip(V[j]!, 'purple', VALUE_X + 112, y, STRIP, false, Math.min(1, WEIGHTS[BANK]![j]! * 3.2) * (1 - eased * 0.4)))
            })
        }
        const progress = Math.max(0, Math.min(1, (a - 0.45) / 0.55))
        if (progress > 0) items.push(...strip(OUTPUT.map((value) => value * progress), 'yellow', VALUE_X + 112, OUT_Y, STRIP))
        if (a >= 1) {
            items.push(text(`(${OUTPUT.map((value) => value.toFixed(2)).join(', ')})`, { font: 'mono', size: 19, color: 'yellow' }).moveTo([VALUE_X + 158, OUT_Y + 42]))
        }
        return items
    })

    // ── The sentence and its arcs ───────────────────────────────────────────

    const SENTENCE_Y = 440
    const sentence = text('the river bank flooded last spring', { font: 'text-serif', size: 92 }).moveTo([-250, -30])
    const wordEnds: [number, number][] = []
    let cursor = 0
    for (const word of WORDS) {
        const glyphCount = word.length
        wordEnds.push([cursor, cursor + glyphCount])
        cursor += glyphCount
    }
    const wordsOf = (index: number) => sentence.chars.slice(wordEnds[index]![0], wordEnds[index]![1])

    const arcDiagram = dynamic(() => {
        const a = arcs.value
        if (a <= 0) return null
        const center = (index: number): number => {
            const glyphs = wordsOf(index)
            const first = glyphs[0]!.bounds(), last = glyphs[glyphs.length - 1]!.bounds()
            return (first.x + last.x + last.width) / 2
        }
        const start = center(BANK)
        const top = SENTENCE_Y - 42
        return WORDS.flatMap((_, j) => {
            const end = center(j)
            const weight = WEIGHTS[BANK]![j]!
            const bend = j === BANK ? 0 : Math.min(170, 52 + Math.abs(end - start) * 0.34)
            const path = j === BANK
                ? parseSvgPath(`M${start - 22} ${top}C${start - 42} ${top - 64} ${start + 42} ${top - 64} ${start + 22} ${top}`)
                : parseSvgPath(`M${start} ${top}C${start} ${top - bend} ${end} ${top - bend} ${end} ${top}`)
            const node = new Node(path).stroke('yellow', 1.4 + 22 * weight, Math.min(1, 0.26 + weight * 1.9)).set('cap', 'butt')
            node.set('trimTo', a)
            return [node]
        })
    })

    // ── Column ──────────────────────────────────────────────────────────────

    const rule = line([COLUMN - 44, -540], [COLUMN - 44, 540], { stroke: 'grid', width: 1.2 })
    const place = <T extends Node>(node: T, top: number): T => {
        node.alignTo([COLUMN, 0], 'left').alignTo([0, top], 'top')
        return node
    }
    const title = place(text('Every word asks a question of every other word.', { font: 'text-serif', size: 52, maxWidth: 420, leading: 1.08 }), -490)
    const eq0 = place(tex('Q K^{T}', { size: 48 }), -304)
    const eq1 = place(tex('\\frac{Q K^{T}}{\\sqrt{d}}', { size: 42 }), -322)
    const eq2 = place(tex('\\mathrm{softmax}\\left(\\frac{Q K^{T}}{\\sqrt{d}}\\right)', { size: 38 }), -322)
    const eq3 = place(tex('\\mathrm{softmax}\\left(\\frac{Q K^{T}}{\\sqrt{d}}\\right) V', { size: 38 }), -322)
    for (const eq of [eq0, eq1, eq2, eq3]) {
        for (const glyph of eq.part('Q')) glyph.fill('blue')
        for (const glyph of eq.part('K')) glyph.fill('teal')
    }
    for (const glyph of eq3.part('V')) glyph.fill('purple')

    const note = (content: string) => place(text(content, { size: 24, color: 'dim', maxWidth: 410, leading: 1.42 }), -178)
    const note0 = note('Each cell is one dot product: how well the query of a row word matches the key of a column word.')
    const note1 = note(`Dividing by the square root of d keeps long vectors from pushing softmax into a corner. Here d = ${D}.`)
    const note2 = note('Softmax turns each row into shares that sum to 1. The row for "bank" is now a budget of attention.')
    const note3 = note('The output for "bank" is those shares applied to the value of every word.')

    const shareLabel = place(text('What "bank" looks at', { size: 19, color: 'dim', uppercase: true, tracking: 0.08, weight: 600 }), -36)
    const ranked = WORDS.map((word, j) => ({ word, weight: WEIGHTS[BANK]![j]!, j })).sort((a, b) => b.weight - a.weight)
    const shares = dynamic(() => {
        const a = soft.value
        return ranked.flatMap((entry, index) => {
            const y = 6 + index * 48
            const barWidth = 200 * entry.weight * 2.6 * a
            return [
                place(text(entry.word, { size: 24, color: 'ink' }), y).opacity(a),
                rect(Math.max(1, barWidth), 16, { fill: 'yellow', stroke: null, radius: 2 }).at(COLUMN + 108 + barWidth / 2, y + 14).opacity(a),
                text((entry.weight * a).toFixed(3), { font: 'mono', size: 22, color: 'yellow' }).alignTo([870, 0], 'right').alignTo([0, y + 1], 'top').opacity(a),
            ]
        })
    })
    const caveat = place(text('Illustrative vectors. Real arithmetic.', { size: 20, color: 'faint' }), 486)

    // ── Timeline ────────────────────────────────────────────────────────────

    s.add(rule)
    s.chapter('A sentence')
    s.play(write(sentence), { duration: 1.6 })
    s.play(write(title), { duration: 1.8 })
    s.play(to(sentence, (node) => {
        node.moveTo([-400, SENTENCE_Y])
        node.scale(0.54)
    }), fade(rule, 1), { duration: 1.2 })
    for (const index of [BANK]) s.play(...wordsOf(index).map((glyph) => to(glyph, (g) => g.fill('yellow'), { duration: 0.6 })))
    s.wait(0.2)

    s.chapter('Scores')
    s.play(fadeIn([rowLabels, colLabels], { lag: 0.04 }), fadeIn(qStrips, { lag: 0.01 }), fadeIn(kStrips, { lag: 0.01 }), fadeIn([qTag, kTag]), { duration: 1.2 })
    s.play(write(eq0), fadeIn(note0), { duration: 1.2 })
    s.add(matrix)
    s.play(fill.to(36, { ease: linear }), { duration: 4.6 })
    s.wait(0.6)

    s.chapter('Scale')
    // One note leaves before the next arrives, so two sentences never share the same lines.
    s.play(morphMatching(eq0, eq1), seq(fadeOut(note0), fadeIn(note1)), { duration: 1.3 })
    s.play(scaled.to(1, { ease: smoother }), { duration: 1.8 })
    s.wait(0.8)

    s.chapter('Softmax')
    s.play(morphMatching(eq1, eq2), seq(fadeOut(note1), fadeIn(note2)), { duration: 1.3 })
    s.add(sums, shares)
    s.play(soft.to(1, { ease: smoother }), fadeIn(shareLabel), focus.to(1), { duration: 2.6 })
    s.wait(0.6)
    s.add(arcDiagram)
    s.play(arcs.to(1, { ease: smoother }), { duration: 1.8 })
    s.wait(1.2)

    s.chapter('Values')
    s.play(morphMatching(eq2, eq3), seq(fadeOut(note2), fadeIn(note3)), fadeIn(vStrips, { lag: 0.01 }), fadeIn(vTag), { duration: 1.5 })
    s.add(output)
    s.play(flow.to(1, { ease: linear }), fadeIn(outTag), { duration: 3.2 })
    s.play(fadeIn(caveat), { duration: 0.8 })
    s.wait(3)
})
