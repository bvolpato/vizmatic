import {
  Box, column, curve3d, dynamic, fadeIn, fadeOut, film, label3d,
  line3d, parametricSurface, place, point3d, row, scene3d, sceneKit, tex,
  text, vector3d, type Vec3,
} from 'vizmatic/stage'
import { cross, polarizationAt, verifyPlaneWaves, wave } from './_maxwell/model'

verifyPlaneWaves()

const DURATION = 42
const FIELD_SCALE = 1.6
const X_RANGE = [-5, 5] as const

// Separate monochromatic examples are cut at zero visibility. Interpolating
// their amplitudes in physical time would not obey the displayed vacuum model.
function cutOpacity(t: number): number {
  let opacity = 1
  for (const cut of [16, 25]) opacity = Math.min(opacity, Math.min(1, Math.abs(t - cut) / 0.28))
  return opacity
}

function tip(x: number, field: Vec3): Vec3 {
  return [x, FIELD_SCALE * field[1], FIELD_SCALE * field[2]]
}

export default film({
  title: 'Maxwell: the shape of light',
  description: 'A vacuum plane wave travels along +x. A fixed observer links its electric and magnetic fields to linear, elliptical, and circular polarization, then to the Poynting vector. Normalized c = 1; cuts compare distinct solutions.',
  look: 'midnight',
  font: 'text-serif',
  fps: 60,
  poster: 29,
}, (s) => {
  const kit = sceneKit({
    size: 42,
    heading: { size: 64, y: -468 },
    area: { left: -875, right: 875, top: -355, bottom: 295 },
  })
  s.add(kit.heading('Maxwell: the shape of light'))
  s.add(place(text('Vacuum · normalized c = 1, E₀ = 1 · field-tip curves · cuts compare distinct waves', {
    size: 30, color: 'dim',
  }), new Box(-875, -422, 875, -380), 'left'))
  const [chapterBox, pictureBox, mathBox] = kit.area.rows([0.085, 0.70, 0.215], 18)
  const [waveBox, observerBox] = pictureBox.columns([2.22, 1], 55)
  const [waveMath, observerMath] = mathBox.columns([2.22, 1], 55)
  const [legendBox, geometryBox] = waveBox.rows([0.13, 0.87], 12)
  const [observerTitle, observerGeometry] = observerBox.rows([0.13, 0.87], 12)

  s.add(place(row([
    tex('\\mathbf E', { size: 38, color: 'blue' }),
    text('electric', { size: 30, color: 'blue' }),
    tex('c\\mathbf B', { size: 38, color: 'teal' }),
    text('magnetic', { size: 30, color: 'teal' }),
    text('propagation +x', { size: 30, color: 'yellow' }),
  ], { gap: 24 }), legendBox, 'left'))
  s.add(place(text('x = 0  /  view toward −x', { size: 30, weight: 600, color: 'yellow' }), observerTitle))
  s.add(place(column([
    text('Tong · Cambridge', { size: 26, color: 'dim' }),
    text('Electrodynamics §§4.3–4.4', { size: 26, color: 'dim' }),
  ], { gap: 4 }), new Box(410, -505, 875, -425), 'right'))

  // One clock drives the spatial curves, every field vector and the observer.
  s.add(dynamic((t) => {
    const alpha = cutOpacity(t)
    if (alpha <= 0.001) return []
    const ratio = polarizationAt(t)
    const view = scene3d({
      theta: -1.27, phi: 1.16, unit: 92, perspective: false,
      fog: 0.15, shine: 0.15,
    }).at(geometryBox.cx - 15, geometryBox.cy + 9).opacity(alpha)

    view.add(line3d([-5.4, 0, 0], [5.6, 0, 0], { color: 'dim', width: 1.6 }))
    view.add(vector3d([5, 0, 0], [5.65, 0, 0], { color: 'yellow', width: 3.5, tip: 15, halo: false }))
    // A transverse observer plane, shared with the face-on view on the right.
    view.add(parametricSurface((angle, radius) => [0, radius * Math.cos(angle), radius * Math.sin(angle)],
      [0, 2 * Math.PI], [0, 1.9], {
        resolution: [48, 1], color: 'yellow', opacity: 0.065, shaded: false,
      }))
    view.add(curve3d((angle) => [0, 1.9 * Math.cos(angle), 1.9 * Math.sin(angle)], 0, 2 * Math.PI,
      { color: 'yellow', width: 1.5, opacity: 0.5, samples: 80 }))

    for (const [key, color] of [['e', 'blue'], ['cb', 'teal']] as const) {
      view.add(parametricSurface((x, fraction) => {
        const p = tip(x, wave(x, t, ratio)[key])
        return [x, fraction * p[1], fraction * p[2]]
      }, X_RANGE, [0, 1], {
        resolution: [100, 1], color, opacity: 0.12, shaded: false,
      }))
      view.add(curve3d((x) => tip(x, wave(x, t, ratio)[key]), ...X_RANGE,
        { color, width: 4.4, glow: 3, samples: 180 }))
      for (let i = 0; i <= 20; i++) {
        const x = -5 + i / 2
        const field = wave(x, t, ratio)[key]
        if (Math.hypot(...field) < 0.07) continue
        view.add(vector3d([x, 0, 0], tip(x, field), {
          color, width: x === 0 ? 4.5 : 1.7, tip: x === 0 ? 17 : 8,
          halo: false,
        }).opacity(x === 0 ? 1 : 0.52))
      }
      view.add(point3d(tip(0, wave(0, t, ratio)[key]), { color, radius: 6, halo: 1.5, onTop: true }))
    }
    if (t >= 34) {
      for (const x of [-3.6, -1.2, 1.2, 3.6]) {
        const { e, cb } = wave(x, t, ratio)
        const energy = cross(e, cb)[0]
        view.add(vector3d([x, 0, 0], [x + energy, 0, 0], {
          color: 'yellow', width: 5, tip: 17, onTop: true, halo: false,
        }).opacity(Math.min(1, (t - 34) / 0.5)))
      }
    }
    return view
  }))

  s.add(dynamic((t) => {
    const alpha = cutOpacity(t)
    if (alpha <= 0.001) return []
    const ratio = polarizationAt(t)
    const { e, cb } = wave(0, t, ratio)
    // Camera on +x: +y is screen-right, +z is up, and +x points at the viewer.
    const view = scene3d({ theta: 0, phi: Math.PI / 2, unit: 91, perspective: false, fog: 0 })
      .at(observerGeometry.cx, observerGeometry.cy).opacity(alpha)
    view.add(line3d([0, -1.85, 0], [0, 1.85, 0], { color: 'faint', width: 1.5 }))
    view.add(line3d([0, 0, -1.85], [0, 0, 1.85], { color: 'faint', width: 1.5 }))
    view.add(label3d('+y', [0, 2.15, 0], { size: 28, color: 'dim' }))
    view.add(label3d('+z', [0, 0, 2.1], { size: 28, color: 'dim' }))
    view.add(curve3d((phase) => [0, FIELD_SCALE * ratio * Math.sin(phase), FIELD_SCALE * Math.cos(phase)],
      0, 2 * Math.PI, { color: 'blue', width: 2, opacity: 0.45, samples: 100 }))
    if (ratio > 0) view.add(curve3d((past) => tip(0, wave(0, t - past, ratio).e), 0, 0.65,
      { color: 'blue', width: 4, glow: 3, opacity: 0.8, samples: 32 }))
    for (const [field, color] of [[e, 'blue'], [cb, 'teal']] as const) {
      if (Math.hypot(...field) > 0.04) view.add(vector3d([0, 0, 0], tip(0, field), {
        color, width: 5, tip: 18, halo: false,
      }))
      view.add(point3d(tip(0, field), { color, radius: 6, halo: 1.2 }))
    }
    view.add(point3d([0, 0, 0], { color: 'yellow', radius: 4, onTop: true }))
    return view
  }))

  const chapters = [
    {
      start: 0, end: 8, title: '01  /  One wave, two fields',
      equations: ['\\nabla\\times\\mathbf E=-\\partial_t\\mathbf B', '\\nabla\\times\\mathbf B=\\partial_t\\mathbf E'],
      note: 'Maxwell’s curl equations, together.  c = 1',
      observer: ['Same place.', 'Same instant.'],
      captions: ['Two fields travel together.', 'Maxwell links their curls.'],
    },
    {
      start: 8, end: 16, title: '02  /  Linear polarization',
      equations: ['E_z=\\cos\\psi,\\quad E_y=0', '\\psi=kx-\\omega t,\\quad\\omega=ck'],
      note: 'One phase carries both fields along +x.',
      observer: ['A line of electric tips.', 'The field reverses.'],
      captions: ['Linear: a fixed direction.', 'E and B reverse together.'],
    },
    {
      start: 16, end: 25, title: '03  /  Elliptical polarization',
      equations: ['E_z=\\cos\\psi,\\quad E_y=\\tfrac12\\sin\\psi', 'c\\mathbf B=\\hat{\\mathbf x}\\times\\mathbf E'],
      note: 'Electric components: 2:1 amplitudes, 90° phase offset.',
      observer: ['An ellipse of tips.', 'The direction turns.'],
      captions: ['A new wave: elliptical.', 'Electric components 90° apart.'],
    },
    {
      start: 25, end: 34, title: '04  /  Circular polarization',
      equations: ['E_z=\\cos\\psi,\\quad E_y=\\sin\\psi', 'c\\mathbf B=\\hat{\\mathbf x}\\times\\mathbf E'],
      note: 'Equal electric amplitudes, the same 90° phase offset.',
      observer: ['A circle of tips.', 'Constant magnitude.'],
      captions: ['Equal electric amplitudes.', 'Circular: constant magnitude.'],
    },
    {
      start: 34, end: DURATION, title: '05  /  Energy moves forward',
      equations: ['\\mathbf S=\\tfrac{1}{\\mu_0}\\mathbf E\\times\\mathbf B', '\\mathbf S=\\tfrac{|\\mathbf E|^2}{\\mu_0c}\\,\\hat{\\mathbf x}'],
      note: 'The Poynting vector follows +x. Circular: constant flux.',
      observer: ['E × B points at you.', 'Along +x.'],
      captions: ['E × B gives the energy flow.', 'Energy travels along +x.'],
    },
  ]

  for (const chapter of chapters) {
    const title = place(text(chapter.title, { size: 38, weight: 600 }), chapterBox, 'left')
    const formula = place(column([
      row(chapter.equations.map((equation) => tex(equation, { size: 36 })), { gap: 48 }),
      text(chapter.note, { size: 29, color: 'dim' }),
    ], { gap: 20 }), waveMath, 'left')
    const observation = place(column(chapter.observer.map((line) => text(line, { size: 32 })), { gap: 10 }), observerMath)
    const sceneText = [title, ...formula.nodes, ...observation.nodes]
    s.at(chapter.start, () => {
      s.chapter(chapter.title.slice(6).trim())
      s.play(fadeIn(sceneText, { duration: 0.25 }))
    })
    chapter.captions.forEach((caption, i) => {
      const duration = (chapter.end - chapter.start) / chapter.captions.length
      s.at(chapter.start + i * duration, () => s.caption(caption, duration))
    })
    if (chapter.end < DURATION) s.at(chapter.end - 0.22, () => s.play(fadeOut(sceneText, { duration: 0.18 })))
  }
  s.wait(Math.max(0, DURATION - s.time))
})
