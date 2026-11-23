import {
    Box, Node, circle, circlePath, column, curve3d, dot, dynamic, fadeIn, fadeOut, film,
    place, point3d, radialGradient, rectPath, scene3d, sceneKit, tex, text, parseColor, mixColor,
    type Ring, type Vec3,
} from 'vizmatic/stage'
import { PLANETS, orbitalState } from './_planetary-orbits/model'
import { COLORS, RADII, SPACING, planetSurface, saturnRings } from './_planetary-orbits/appearance'
import { saturnPortrait } from './_planetary-orbits/saturn'

const DURATION = 50
const smooth = (x: number) => { const p = Math.max(0, Math.min(1, x)); return p * p * (3 - 2 * p) }
const saturnIn = (t: number) => smooth((t - 26) / 1.2) * (1 - smooth((t - 38) / 1.2))
const outerOnly = (t: number) => smooth((t - 13) / 1.5) * (1 - smooth((t - 39) / 1.5))

// Integrate a smooth change in the common clock. Every visible planet always
// uses the same model time; rapid inner orbits fade before the clock speeds up.
function years(t: number): number {
    const rampIntegral = (start: number, width: number) => {
        const x = Math.max(0, (t - start) / width)
        return width * (x < 1 ? x ** 3 - x ** 4 / 2 : x - 0.5)
    }
    return 0.07 * t + 2.33 * (rampIntegral(14.5, 2) - rampIntegral(37, 2))
}

function position(index: number, at: number): Vec3 {
    const planet = PLANETS[index]
    const scale = SPACING[index] / planet.a
    const p = orbitalState(planet, at).position
    return [p[0] * scale, p[1] * scale, p[2] * scale]
}

export default film({
    title: 'Eight worlds, one gravity',
    description: 'Keplerian orbits carry eight worlds around the Sun. A shared clock shifts from the inner planets to the giants, then a moving camera explores Saturn’s tilted rings and their shadow. Planet sizes are enlarged, orbital spacing is compressed, and surfaces are stylized.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 32, bloom: 0.13,
}, (s) => {
    const kit = sceneKit({ size: 40, heading: { size: 70, y: -460 }, area: { left: -850, right: 850, top: -330, bottom: 335 } })
    s.add(kit.heading('Eight worlds, one gravity'))
    s.add(place(text('Keplerian motion · compressed spacing · enlarged planets · stylized surfaces', { size: 27, color: 'dim' }), new Box(-850, -410, 850, -365), 'left'))
    s.add(place(text('NASA / JPL · approximate J2000 elements', { size: 25, color: 'dim' }), new Box(-850, 351, 850, 390), 'right'))

    // A fixed, sparse sky batched into one path so 130 stars cost one draw call.
    const starRings: Ring[] = []
    for (let i = 0; i < 130; i++) {
        const x = Math.sin(i * 127.1 + 3.7) * 43758.5453
        const y = Math.sin(i * 269.5 + 9.1) * 19642.349
        starRings.push(circlePath(-900 + (x - Math.floor(x)) * 1800, -325 + (y - Math.floor(y)) * 655, 0.6 + (i % 4) * 0.23)[0]!)
    }
    s.add(new Node(starRings).fill('dim', s.look.dark ? 0.3 : 0.17))

    // Fixed J2000 orbit ellipses and trail start colors never change across frames.
    const bgColor = parseColor('bg')
    const trailStartColors = COLORS.map((color) => mixColor(bgColor, parseColor(color), 0.05))
    const orbitCurves = PLANETS.map((planet, i) => curve3d((phase) => position(i, phase * planet.period), 0, 1, {
        color: COLORS[i], width: 1.2, samples: 120,
    }))

    const systemCenter = [0, 2] as const
    s.add(dynamic((t) => {
        const opacity = 1 - saturnIn(t)
        if (opacity < 0.001) return []
        const halo = circle(140, {
            fill: radialGradient([0, 0], 140, [[0, '#f5bf56'], [0.22, '#d289302b'], [1, '#d2893000']]), stroke: null,
        }).at(...systemCenter).opacity(opacity * (s.look.dark ? 0.65 : 0.18))
        const pushIn = smooth((t - 1) / 4) * (1 - smooth((t - 9) / 5))
        const theta = -1.15 + 0.014 * t, phi = 1.22 + 0.05 * Math.sin(t * 0.08)
        const camera: Vec3 = [Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi)]
        const unit = 96 + 44 * pushIn
        const view = scene3d({
            theta, phi, unit,
            perspective: false, fog: 0, ambient: 0.4, shine: 0, brightness: 1,
        }).at(...systemCenter).opacity(opacity)
        view.clipPath = rectPath(-850, -300, 1700, 580)
        view.add(point3d([0, 0, 0], { radius: 0.34 * unit, color: '#f2c46e' }))
        const at = years(t), outer = outerOnly(t)
        for (let i = 0; i < PLANETS.length; i++) {
            const planet = PLANETS[i], bodyOpacity = i < 4 ? 1 - outer : 1
            const p = position(i, at), light: Vec3 = [-p[0], -p[1], -p[2]]
            view.add(orbitCurves[i]!.opacity((s.look.dark ? 0.27 : 0.5) * (i < 4 ? 1 - 0.8 * outer : 1)))
            if (bodyOpacity < 0.005) continue
            // Each trail is a fixed fraction of this planet's orbital period.
            // Film-level WebGL bloom carries the glow without 288 per-segment Canvas2D shadow blurs.
            view.add(curve3d((past) => position(i, at - past * planet.period), 0.18, 0, {
                colors: [trailStartColors[i]!, COLORS[i]], width: 3.1, opacity: bodyOpacity, samples: 48,
            }))
            view.add(planetSurface(i, p, RADII[i], light, t * 0.17).opacity(bodyOpacity))
            if (i === 5) view.add(...saturnRings(p, RADII[i], light, camera))
        }
        return [halo, view]
    }))

    // A separate magnified camera studies ring geometry while the system clock
    // continues offscreen. Camera motion is not Saturn's physical precession.
    const portrait = saturnPortrait().at(-260, 24)
    s.at(26, () => s.play(fadeIn(portrait, { duration: 1.2 })))
    s.at(38, () => s.play(fadeOut(portrait, { duration: 1.2 })))

    const chapters = [
        { start: 0, end: 13, title: '01 / The inner worlds move first' },
        { start: 13, end: 26, title: '02 / Give the giants time' },
        { start: 26, end: 39, title: '03 / A world inside its rings' },
        { start: 39, end: 50, title: '04 / Different rhythms. The same law.' },
    ]
    for (const chapter of chapters) {
        const heading = place(text(chapter.title, { size: 36, color: 'yellow' }), new Box(-850, -350, 850, -300), 'left')
        s.at(chapter.start, () => {
            s.chapter(chapter.title.slice(5))
            s.play(fadeIn(heading, { duration: 0.3 }))
        })
        if (chapter.end < DURATION) s.at(chapter.end - 0.3, () => s.play(fadeOut(heading, { duration: 0.25 })))
    }

    const legend = PLANETS.map((planet, i) => {
        const x = -815 + i * 210
        return [dot(5, COLORS[i]).at(x, 320), text(planet.name, { size: 27, color: 'dim' }).at(x + 75, 320)]
    })
    s.add(dynamic(t => {
        const opacity = 1 - saturnIn(t)
        return opacity < 0.001 ? [] : legend.flatMap((nodes, i) => nodes.map(node => node.clone().opacity(opacity * (i < 4 ? 1 - 0.8 * outerOnly(t) : 1))))
    }))

    const [saturnTitle, saturnMath, saturnNote] = new Box(280, -190, 850, 255).rows([1.25, 1.4, 2], 28)
    const detail: Node[] = [
        place(text('Magnified geometry · illustrative lighting', { size: 27, color: 'dim' }), new Box(-850, 305, 850, 345), 'left'),
        place(text('Saturn', { size: 80 }), saturnTitle, 'left'),
        ...place(column([
            text('29.4 Earth years', { size: 40, color: 'yellow' }),
            text('for one trip around the Sun', { size: 28, color: 'dim' }),
        ], { gap: 13 }), saturnMath, 'left').nodes,
        ...place(column([
            text('Tilted rings catch the light.', { size: 31 }),
            text('The planet casts a shadow.', { size: 31 }),
            text('The dark gap is the Cassini division.', { size: 27, color: 'dim' }),
        ], { gap: 18 }), saturnNote, 'left').nodes,
    ]
    s.at(27.3, () => s.play(fadeIn(detail, { duration: 0.6 })))
    s.at(37.6, () => s.play(fadeOut(detail, { duration: 0.35 })))

    const law = place(tex('T^2\\propto a^3', { size: 52, color: 'yellow' }), new Box(480, -280, 850, -190), 'right')
    const lawNote = place(text('Farther out. Longer years.', { size: 29, color: 'dim' }), new Box(430, -190, 850, -145), 'right')
    s.at(40, () => s.play(fadeIn([law, lawNote], { duration: 0.8 })))

    const captions: [number, number, string][] = [
        [0, 6.5, 'Eight planets share one clock. Close to the Sun, the inner planets move through their years quickly.'],
        [6.5, 6.5, 'These are fixed Keplerian ellipses with approximate J2000 elements. Distances are compressed and bodies enlarged so every world is visible.'],
        [13, 6.5, 'The inner planets fade before the shared clock speeds up. Now the slower outer planets come alive.'],
        [19.5, 6.5, 'Jupiter takes about twelve Earth years to orbit the Sun. Neptune takes about one hundred sixty-five.'],
        [26, 6.5, 'Saturn’s rings contain countless particles. Here, magnified annular surfaces and illustrative lighting reveal their geometry.'],
        [32.5, 6.5, 'The camera rises above the rings. The Cassini division stays open, and the planet casts its shadow across the ring plane.'],
        [39, 5.5, 'Return to the full system and the slower clock. The planets have continued moving while the camera was away.'],
        [44.5, 5.5, 'The square of an orbital period is proportional to the cube of its semimajor axis. Farther worlds take longer to return.'],
    ]
    for (const [start, duration, caption] of captions) s.at(start, () => s.caption(caption, duration))
    s.wait(Math.max(0, DURATION - s.time))
})
