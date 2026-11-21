import { colorAlong, dot, draw, film, line, parametric, text, write } from 'vizmatic/stage'

/** The social preview card. It renders to a single PNG during the site build. */
export default film({ title: 'Vizmatic', width: 1200, height: 630, bloom: 0.22 }, (s) => {
    // Subtle architectural rule lines behind the curves.
    for (let x = -480; x <= 480; x += 120) {
        s.add(line([x, -315], [x, 315], { stroke: 'grid', width: 1, opacity: 0.28 }))
    }
    for (let y = -200; y <= 200; y += 100) {
        s.add(line([-600, y], [600, y], { stroke: 'grid', width: 1, opacity: 0.28 }))
    }

    // Layered harmonic ribbon suggesting vector motion and math.
    for (let k = 0; k < 5; k++) {
        const phase = k * 0.42
        const amp = 68 - k * 9
        const yBase = 152 + (k - 2) * 14
        const ribbon = parametric(
            (u) => [-600 + u * 1200, yBase + Math.sin(u * 8.5 + phase) * amp * (1 - u * 0.35) + Math.sin(u * 21 - phase) * 14],
            0, 1,
            {
                samples: 220,
                stroke: colorAlong('blue', 'teal', 'yellow', 'orange', 'pink'),
                width: k === 2 ? 4.5 : 1.6,
                opacity: k === 2 ? 1 : 0.32,
                ...(k === 2 ? { glow: 10 } : {}),
            },
        )
        s.add(ribbon)
        if (k === 2) s.play(draw(ribbon), { duration: 0.1 })
    }

    const brand = text('VIZMATIC', { font: 'mono', size: 22, color: 'teal', weight: 600, anchor: 'left' }).at(-500, -214)
    const head = text('Moving pictures of ideas,\nwritten as code.', { font: 'text-serif', size: 84, leading: 1.04, anchor: 'left' }).at(-500, -104)
    const sub = text('Deterministic vector animation and dense diagrams for TypeScript.', { size: 26, color: 'dim', anchor: 'left' }).at(-500, 32)
    const accentDot = dot(7, 'yellow').glow(12).at(468, 134)

    s.add(brand, head, sub, accentDot)
    s.play(write(head), { duration: 0.1 })
})
