/**
 * A closed curve is a sum of rotating arrows. The coefficients are a real
 * discrete Fourier transform of an ampersand's outline, and every readout comes
 * from them, including the energy and error figures via Parseval's identity.
 */
import {
    Node, dot, dynamic, draw, fade, fadeIn, film, flash, fontFor, linear, linearGradient, line, parseColor, pathBounds,
    pointAt, polyPath, circlePath, rect, smoother, signedArea, text, tex, transformPath, write, ramp,
    type Path, type Rgba, type Ring, type Vec,
} from 'vizmatic/stage'

const TAU = Math.PI * 2
const SAMPLES = 2048
const MAX_FREQ = 320
const TRACE = 900
const MAX_TERMS = 240

interface Term { n: number; re: number; im: number; size: number }

/** Discrete Fourier transform, for the frequencies a drawing actually needs. */
function transform(points: readonly Vec[]): Term[] {
    const terms: Term[] = []
    const m = points.length
    for (let n = -MAX_FREQ; n <= MAX_FREQ; n++) {
        let re = 0, im = 0
        for (let j = 0; j < m; j++) {
            const angle = -TAU * n * j / m
            const c = Math.cos(angle), s = Math.sin(angle)
            re += points[j]![0] * c - points[j]![1] * s
            im += points[j]![0] * s + points[j]![1] * c
        }
        re /= m
        im /= m
        terms.push({ n, re, im, size: Math.hypot(re, im) })
    }
    return terms
}

export default film({
    title: 'Fourier epicycles',
    description: 'An ampersand redrawn by a chain of rotating arrows as the term count grows.',
    fps: 60,
}, (s) => {
    fontFor('serif', 400, true)
    const glyph = text('&', { font: 'text-serif', italic: true, size: 900 }).at(-300, 40)
    const leaf = glyph.chars[0]!
    const world = transformPath(leaf.get('path')!, leaf.worldMatrix())
    const outline: Ring = [...world].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0]!
    const single: Path = [outline]
    const points: Vec[] = Array.from({ length: SAMPLES }, (_, i) => pointAt(single, i / SAMPLES))

    const all = transform(points)
    const center = all.find((term) => term.n === 0)!
    const ranked = all.filter((term) => term.n !== 0).sort((a, b) => b.size - a.size)
    const terms = ranked.slice(0, MAX_TERMS)
    const totalPower = ranked.reduce((sum, term) => sum + term.size * term.size, 0)
    const cumulative: number[] = [0]
    for (const term of ranked) cumulative.push(cumulative[cumulative.length - 1]! + term.size * term.size)
    const shapeBounds = pathBounds(single)!

    // Rotation tables, so the whole curve costs additions per frame instead of sines.
    const cosTable = new Float32Array(terms.length * (TRACE + 1))
    const sinTable = new Float32Array(terms.length * (TRACE + 1))
    terms.forEach((term, k) => {
        for (let i = 0; i <= TRACE; i++) {
            const angle = TAU * term.n * i / TRACE
            cosTable[k * (TRACE + 1) + i] = Math.cos(angle)
            sinTable[k * (TRACE + 1) + i] = Math.sin(angle)
        }
    })
    const weightOf = (k: number, count: number) => Math.max(0, Math.min(1, count - k))
    const curvePoint = (index: number, count: number): Vec => {
        let x = center.re, y = center.im
        const limit = Math.min(terms.length, Math.ceil(count))
        for (let k = 0; k < limit; k++) {
            const term = terms[k]!, w = weightOf(k, count)
            const c = cosTable[k * (TRACE + 1) + index]!, sn = sinTable[k * (TRACE + 1) + index]!
            x += w * (term.re * c - term.im * sn)
            y += w * (term.re * sn + term.im * c)
        }
        return [x, y]
    }

    const phase = s.value(0)
    const count = s.value(1)
    const reveal = s.value(0)
    // The exact end of the chain. The camera follows this, so it must not snap to the table's
    // steps: at 9x zoom, one step is a jump of about 50 pixels, and the whole frame shakes.
    const tip = (): Vec => {
        const u = phase.value % 1
        const n = count.value
        let x = center.re, y = center.im
        const limit = Math.min(terms.length, Math.ceil(n))
        for (let k = 0; k < limit; k++) {
            const term = terms[k]!, w = weightOf(k, n)
            const angle = TAU * term.n * u
            const c = Math.cos(angle), sn = Math.sin(angle)
            x += w * (term.re * c - term.im * sn)
            y += w * (term.re * sn + term.im * c)
        }
        return [x, y]
    }

    const stroke = linearGradient(
        [shapeBounds.x, shapeBounds.y + shapeBounds.height], [shapeBounds.x + shapeBounds.width, shapeBounds.y],
        ['teal', 'blue', 'purple', 'pink', 'yellow'],
    )
    const faintInk: Rgba = parseColor('dim')

    // Faint ghost of the target, so the viewer can judge how close the sum has come.
    const target = new Node(single).stroke('faint', 1.6).dash([3, 9])

    // The camera zooms in later. Marks divide by the zoom so lines stay fine at any scale.
    const follow = s.value(0)
    const zoom = s.value(1)

    const curve = dynamic(() => {
        const n = count.value
        const frac = reveal.value
        if (frac <= 0) return null
        const end = Math.floor(TRACE * Math.min(1, frac))
        const out: Vec[] = []
        for (let i = 0; i <= end; i++) out.push(curvePoint(i, n))
        const z = zoom.value
        return new Node(polyPath(out, frac >= 1)).stroke(stroke, 3.2 / Math.pow(z, 0.8)).glow(7 / Math.pow(z, 0.8), 'blue')
    })

    const chain = dynamic(() => {
        const n = count.value
        const u = phase.value % 1
        const z = zoom.value
        const limit = Math.min(terms.length, Math.ceil(n))
        let x = center.re, y = center.im
        const rings: Ring[][] = [[], [], []]
        const shafts: Ring[][] = [[], [], []]
        const heads: Ring[][] = [[], [], []]
        for (let k = 0; k < limit; k++) {
            const term = terms[k]!, w = weightOf(k, n)
            const angle = TAU * term.n * u
            const c = Math.cos(angle), sn = Math.sin(angle)
            const vx = w * (term.re * c - term.im * sn), vy = w * (term.re * sn + term.im * c)
            const bucket = k < 8 ? 0 : k < 40 ? 1 : 2
            const radius = term.size * w
            if (radius > 0.25 / z) rings[bucket]!.push(...circlePath(x, y, radius))
            const nx = x + vx, ny = y + vy
            const length = Math.hypot(vx, vy)
            if (length > 0.5 / z) {
                const tipLength = Math.min(length * 0.34, 16 / z)
                const ux = vx / length, uy = vy / length
                const bx = nx - ux * tipLength, by = ny - uy * tipLength
                shafts[bucket]!.push(...polyPath([[x, y], [bx, by]]))
                const half = tipLength * 0.36
                heads[bucket]!.push(...polyPath([[nx, ny], [bx - uy * half, by + ux * half], [bx + uy * half, by - ux * half]], true))
            }
            x = nx
            y = ny
        }
        const out: Node[] = []
        const circleAlpha = [0.42, 0.26, 0.14], shaftAlpha = [1, 0.8, 0.5], widths = [2.4, 1.6, 1]
        for (let b = 0; b < 3; b++) {
            if (rings[b]!.length) out.push(new Node(rings[b]!).stroke('blue', 1.2 / z, circleAlpha[b]))
            if (shafts[b]!.length) out.push(new Node(shafts[b]!).stroke('ink', widths[b]! / z, shaftAlpha[b]))
            if (heads[b]!.length) out.push(new Node(heads[b]!).fill('ink', shaftAlpha[b]))
        }
        out.push(dot(6.5 / z, 'yellow').at(x, y).glow(10 / z))
        return out
    })

    // ── Right column ────────────────────────────────────────────────────────

    const COLUMN = 470
    // An opaque column keeps the readouts clean while the camera works underneath it.
    const backing = rect(960 - COLUMN + 60, 1080, { fill: 'bg', stroke: null }).at((COLUMN - 60 + 960) / 2 , 0).pin()
    const rule = line([COLUMN - 60, -540], [COLUMN - 60, 540], { stroke: 'grid', width: 1.2 }).pin()
    const title = text('A drawing is a sum of circles.', { font: 'text-serif', size: 66 }).pin()
    title.alignTo([-864, 0], 'left').alignTo([0, -484], 'top')
    const eqTerm = tex('z(t) = \\sum_{k=1}^{N} c_k \\, e^{2\\pi i n_k t}', { size: 44 }).pin()
    eqTerm.alignTo([COLUMN, 0], 'left').alignTo([0, -466], 'top')
    const eqNote = text('Each term is one arrow: a length, a start angle, and a whole number of turns per trip.', {
        size: 22, color: 'dim', maxWidth: 400, leading: 1.4,
    }).pin()
    eqNote.alignTo([COLUMN, 0], 'left').alignTo([0, -300], 'top')

    const labelStyle = { size: 19, color: 'dim' as const, uppercase: true, tracking: 0.08, weight: 600 as const }
    const termLabel = text('Arrows in the chain', labelStyle).pin().alignTo([COLUMN, 0], 'left').alignTo([0, -196], 'top')
    const termRead = dynamic(() => text(String(Math.round(count.value)), { font: 'mono', size: 86, color: 'yellow' })
        .alignTo([COLUMN, 0], 'left').alignTo([0, -166], 'top')).pin()
    const energyLabel = text('Energy captured', labelStyle).pin().alignTo([COLUMN, 0], 'left').alignTo([0, -32], 'top')
    const energyRead = dynamic(() => {
        const n = Math.round(count.value)
        const share = (100 * cumulative[Math.min(n, cumulative.length - 1)]!) / totalPower
        return text(`${share.toFixed(2)}%`, { font: 'mono', size: 40, color: 'ink' })
            .alignTo([COLUMN, 0], 'left').alignTo([0, -2], 'top')
    }).pin()
    const errorLabel = text('RMS distance to outline', labelStyle).pin().alignTo([COLUMN, 0], 'left').alignTo([0, 82], 'top')
    const errorRead = dynamic(() => {
        const n = Math.round(count.value)
        const rest = Math.sqrt(Math.max(0, totalPower - cumulative[Math.min(n, cumulative.length - 1)]!))
        return text(`${rest.toFixed(1)} px`, { font: 'mono', size: 40, color: 'ink' })
            .alignTo([COLUMN, 0], 'left').alignTo([0, 112], 'top')
    }).pin()

    // The spectrum: every frequency in play, lit as its arrow joins the chain.
    const BAR_X = COLUMN, BAR_WIDTH = 394, BAR_BASE = 446, BAR_HEIGHT = 190, RANGE = 48
    const logTop = Math.log10(terms[0]!.size + 1)
    const spectrumPaint = ramp(2, 'faint', 'yellow')
    const spectrumLabel = text('Spectrum, by frequency', labelStyle).pin().alignTo([COLUMN, 0], 'left').alignTo([0, 208], 'top')
    const rankByFrequency = new Map(terms.map((term, k) => [term.n, k]))
    const spectrum = dynamic(() => {
        const n = count.value
        const lit: Ring[] = [], dark: Ring[] = []
        for (let f = -RANGE; f <= RANGE; f++) {
            if (f === 0) continue
            const term = all.find((entry) => entry.n === f)!
            const x = BAR_X + ((f + RANGE) / (2 * RANGE)) * BAR_WIDTH
            const height = (Math.log10(term.size + 1) / logTop) * BAR_HEIGHT
            const rank = rankByFrequency.get(f)
            ;(rank !== undefined && rank < n ? lit : dark).push(...polyPath([[x, BAR_BASE], [x, BAR_BASE - Math.max(1, height)]]))
        }
        return [
            new Node(dark).stroke(spectrumPaint[0]!, 2.4),
            new Node(lit).stroke(spectrumPaint[1]!, 2.4),
            line([BAR_X, BAR_BASE + 3], [BAR_X + BAR_WIDTH, BAR_BASE + 3], { stroke: faintInk, width: 1.2 }),
        ]
    }).pin()
    const lowLabel = tex(`-${RANGE}`, { size: 20, color: 'dim', display: false }).pin()
    lowLabel.alignTo([BAR_X, 0], 'left').alignTo([0, BAR_BASE + 12], 'top')
    const highLabel = tex(`+${RANGE}`, { size: 20, color: 'dim', display: false }).pin()
    highLabel.alignTo([BAR_X + BAR_WIDTH, 0], 'right').alignTo([0, BAR_BASE + 12], 'top')
    const nLabel = tex('n', { size: 22, color: 'dim', display: false }).pin()
    nLabel.moveTo([BAR_X + BAR_WIDTH / 2, BAR_BASE + 24])

    // ── Timeline ────────────────────────────────────────────────────────────

    s.chapter('The target')
    s.add(backing, rule)
    s.play(write(title), draw(target), { duration: 2.2 })
    s.play(write(eqTerm), fadeIn(eqNote, { shift: [0, 10] }), { duration: 1.8 })
    s.wait(0.6)
    s.play(fadeIn([termLabel, termRead, energyLabel, energyRead, errorLabel, errorRead, spectrumLabel, spectrum, lowLabel, highLabel, nLabel]), { duration: 1 })

    s.chapter('One arrow')
    s.add(curve)
    s.play(fadeIn(chain), { duration: 0.7 })
    backing.zIndex(2)
    rule.zIndex(2)
    for (const pinned of [eqTerm, eqNote, termLabel, termRead, energyLabel, energyRead, errorLabel, errorRead, spectrumLabel, spectrum, lowLabel, highLabel, nLabel]) pinned.zIndex(3)
    title.zIndex(3)
    s.play(reveal.to(1, { ease: linear }), phase.to(1, { ease: linear }), { duration: 4 })
    s.wait(0.4)

    s.chapter('Add arrows')
    for (const [next, seconds] of [[3, 3.2], [8, 3.2], [24, 3.6]] as const) {
        s.play(count.to(next, { ease: smoother }), phase.to(phase.value + 1, { ease: linear }), { duration: seconds })
        s.wait(0.25)
    }

    s.chapter('Two hundred')
    s.play(count.to(200, { ease: smoother }), phase.to(phase.value + 2, { ease: linear }), { duration: 8 })
    s.play(flash(tip(), { color: 'yellow', radius: 50 }))

    s.chapter('Up close')
    s.update(s.camera, (camera) => {
        const [tx, ty] = tip()
        const a = follow.value, z = zoom.value
        // Keep the tip left of center, in the open part of the frame.
        camera.at((tx + 240 / z) * a, (ty) * a)
        camera.set('sx', z)
    })
    // The title leaves before the zoom carries the curve through it, and returns when the curve is back in place.
    s.at(s.time, () => s.play(fade(title, 0), { duration: 0.3 }))
    s.play(fade(target, 0), follow.to(1, { ease: smoother }), zoom.to(9, { ease: smoother }), phase.to(phase.value + 0.06, { ease: linear }), { duration: 3 })
    s.play(phase.to(phase.value + 0.14, { ease: linear }), { duration: 6 })
    s.at(s.time + 2.6, () => s.play(fade(title, 1), { duration: 0.4 }))
    s.play(follow.to(0, { ease: smoother }), zoom.to(1, { ease: smoother }), phase.to(phase.value + 0.08, { ease: linear }), { duration: 3 })

    s.chapter('The whole curve')
    s.play(phase.to(phase.value + 1, { ease: linear }), { duration: 4.6 })
    s.wait(1.4)
})
