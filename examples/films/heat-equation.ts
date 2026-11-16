import {
  Box, axes, colorBar, column, dot, dynamic, fadeIn, fadeOut, film, line, linear,
  place, rect, row, scalarField, sceneKit, tex, text,
} from 'vizmatic/stage'
import { MODES, modelTime, remaining, temperature, verifyHeatSolution } from './_heat-equation/model'

verifyHeatSolution()

const TEMPERATURE_DOMAIN = [0, 1] as const
const THERMAL_COLORS = ['faint', 'yellow', 'orange'] as const

export default film({
  title: 'Heat: why the ripples disappear',
  description: 'An exact three-mode solution of the dimensionless heat equation on [0, pi], with both endpoints held at zero. A fixed-scale heat strip, temperature curve and Fourier modes share one model clock. High frequencies decay at rates n squared.',
  look: 'midnight', font: 'text-serif', fps: 60, poster: 17,
}, (s) => {
  const kit = sceneKit({ size: 42, heading: { size: 62, y: -468 }, area: { left: -875, right: 875, top: -355, bottom: 300 } })
  s.add(kit.heading('Heat: why the ripples disappear'))
  s.add(place(text('Analytic solution · dimensionless x, τ, u · ends held at 0 · time rescaled', { size: 30, color: 'dim' }),
    new Box(-875, -422, 875, -380), 'left'))
  s.add(place(column([
    text('Poonen · MIT 18.03', { size: 26, color: 'dim' }),
    text('§29 · Heat equation', { size: 26, color: 'dim' }),
  ], { gap: 4 }), new Box(490, -505, 875, -425), 'right'))
  const [chapterBox, contentBox, equationBox] = kit.area.rows([0.08, 0.7, 0.22], 18)
  const [profileBox, modesBox] = contentBox.columns([2.15, 1], 70)
  const [plotTitle, curveBox, stripBox] = profileBox.rows([0.11, 0.66, 0.23], 15)
  const [modesTitle, modePlots] = modesBox.rows([0.11, 0.89], 15)
  const [equationLeft, equationRight] = equationBox.columns([2.15, 1], 70)
  const clock = s.value(0)
  const tau = () => modelTime(clock.value)
  s.at(0, () => s.play(clock.to(40, { duration: 40, ease: linear })))

  s.add(place(text('TEMPERATURE  /  u(x, τ)', { size: 30, weight: 600, color: 'orange' }), plotTitle, 'left'))
  s.add(place(text('MODES  /  fraction remaining', { size: 28, weight: 600 }), modesTitle, 'left'))
  const plot = place(axes({
    x: [0, Math.PI], y: [0, 1], width: curveBox.width - 90, height: curveBox.height - 55,
    xTicks: [0, Math.PI / 2, Math.PI], yTicks: [0, 0.5, 1],
    xFormat: (x) => x === 0 ? '0' : x === Math.PI ? '\\pi' : '\\pi/2',
    labelSize: 28, grid: true, tips: false,
  }), curveBox)
  plot.plot((x) => temperature(x, 0), { stroke: 'dim', width: 1.8, dash: [5, 8] }).opacity(0.35)
  plot.plot((x) => temperature(x, tau()), { to: () => Math.PI, stroke: 'orange', width: 5, glow: 4 })
  s.add(plot)

  const left = plot.world(0, 0)[0], right = plot.world(Math.PI, 0)[0]
  const heatY = stripBox.cy - 3
  const strip = scalarField((x) => temperature(x, tau()), {
    x: [0, Math.PI], y: [0, 1], domain: TEMPERATURE_DOMAIN, colors: THERMAL_COLORS,
    width: right - left, height: 48, resolution: [384, 2],
  }).at((left + right) / 2, heatY)
  s.add(strip)
  s.add(rect(right - left, 48, { stroke: 'dim', width: 1.2, fill: null }).at((left + right) / 2, heatY))
  for (const x of [left, right]) s.add(rect(9, 68, { fill: 'dim', stroke: null }).at(x, heatY))
  // The same x and u locate the profile dot and its column in the heat strip.
  s.add(dynamic(() => {
    const [x, y] = plot.world(Math.PI / 3, temperature(Math.PI / 3, tau()))
    return [line([x, y], [x, heatY + 24], { stroke: 'ink', width: 1.4, dash: [4, 6], opacity: 0.55 }),
      dot(7, 'orange').at(x, y), rect(7, 48, { fill: null, stroke: 'ink', width: 2 }).at(x, heatY)]
  }))

  const colors = ['blue', 'teal', 'purple'] as const
  for (const [i, box] of modePlots.rows(3, 14).entries()) {
    const { n } = MODES[i]
    const color = colors[i]
    const [labelBox, modeBox] = box.rows([0.39, 0.61], 4)
    s.add(place(row([
      tex(`n=${n}`, { size: 30, color }),
      text(`rate ${n * n}`, { size: 28, color: 'dim' }),
    ], { gap: 24 }), labelBox, 'left'))
    s.add(dynamic(() => {
      const percentage = 100 * remaining(n, tau())
      return place(text(percentage < 0.1 ? '<0.1%' : `${percentage.toFixed(1)}%`, { size: 28, color }), labelBox, 'right')
    }))
    const mode = place(axes({ x: [0, Math.PI], y: [-1.1, 1.1], width: modeBox.width - 8, height: modeBox.height - 4,
      xTicks: [0, Math.PI / 2, Math.PI], yTicks: [], labels: false, tips: false, color: 'faint' }), modeBox)
    mode.plot((x) => Math.sin(n * x), { stroke: 'faint', width: 1.4 })
    mode.plot((x) => remaining(n, tau()) * Math.sin(n * x), { to: () => Math.PI, stroke: color, width: 3.5 })
    s.add(mode)
  }

  const [readoutBox, legendBox] = equationRight.columns([0.25, 0.75], 20)
  s.add(dynamic(() => place(column([
    tex('\\tau=', { size: 33 }),
    text(tau().toFixed(2), { size: 37, font: 'mono' }),
  ], { gap: 8 }), readoutBox, 'left').nodes))
  s.add(place(colorBar({ domain: TEMPERATURE_DOMAIN, colors: THERMAL_COLORS,
    width: 285, height: 16, labelSize: 26, ticks: [0, 0.5, 1], label: 'Temperature u (fixed)',
  }), legendBox))

  const chapters = [
    { start: 0, end: 8, title: '01  /  A temperature profile',
      equation: 'u(x,0)=0.5\\sin x+0.3\\sin 3x+0.2\\sin 5x',
      note: 'The curve and strip show the same temperature.',
      captions: ['One rod. Three Fourier modes.', 'Both ends stay at zero.'] },
    { start: 8, end: 20, title: '02  /  Curvature smooths the profile',
      equation: '\\partial_\\tau u=\\partial_x^2u,\\qquad u(0,\\tau)=u(\\pi,\\tau)=0',
      note: 'A cool spot can warm while the hottest regions cool.',
      captions: ['Curvature changes temperature.', 'A cool spot can warm.', 'The strip follows the curve.'] },
    { start: 20, end: 30, title: '03  /  Fine structure fades first',
      equation: 'u(x,\\tau)=\\textstyle\\sum_{n\\in\\{1,3,5\\}}a_n e^{-n^2\\tau}\\sin(nx)',
      note: 'Decay rates: 1, 9, 25. Fine structure disappears first.',
      captions: ['Each amplitude decays as e⁻ⁿ²τ.', 'Higher modes fade faster.'] },
    { start: 30, end: 40, title: '04  /  The broad mode lasts longest',
      equation: 'u(x,\\tau)\\sim0.5e^{-\\tau}\\sin x\\quad(\\tau\\to\\infty)',
      note: 'Heat escapes through the ends. The whole profile tends to zero.',
      captions: ['The broad mode lasts longest.', 'Heat leaves through the ends.'] },
  ]
  for (const chapter of chapters) {
    const title = place(text(chapter.title, { size: 38, weight: 600 }), chapterBox, 'left')
    const equation = place(column([
      tex(chapter.equation, { size: 38 }),
      text(chapter.note, { size: 28, color: 'dim' }),
    ], { gap: 18 }), equationLeft, 'left')
    const content = [title, ...equation.nodes]
    s.at(chapter.start, () => { s.chapter(chapter.title.slice(6).trim()); s.play(fadeIn(content, { duration: 0.25 })) })
    if (chapter.end < 40) s.at(chapter.end - 0.22, () => s.play(fadeOut(content, { duration: 0.18 })))
    chapter.captions.forEach((caption, i) => {
      const duration = (chapter.end - chapter.start) / chapter.captions.length
      s.at(chapter.start + i * duration, () => s.caption(caption, duration))
    })
  }
  s.wait(Math.max(0, 40 - s.time))
})
