import { colorAlong, draw, film, parametric, text, write } from 'vizmatic/stage'

/** The social preview card. It renders to a single PNG during the site build. */
export default film({ title: 'Vizmatic', width: 1200, height: 630, bloom: 0.16 }, (s) => {
    const wave = parametric((u) => [-600 + u * 1200, 150 + Math.sin(u * 9) * 70 * (1 - u * 0.4) + Math.sin(u * 23) * 18], 0, 1, { samples: 220, stroke: colorAlong('blue', 'teal', 'yellow', 'orange'), width: 4, glow: 8 })
    const head = text('Moving pictures of ideas,\nwritten as code.', { font: 'serif', size: 92, leading: 1.04 }).at(-30, -110)
    s.add(wave)
    s.add(head)
    s.play(draw(wave), write(head), { duration: 0.1 })
})
