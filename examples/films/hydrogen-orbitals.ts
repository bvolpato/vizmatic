/**
 * Normalized real hydrogen eigenfunctions, not electron trajectories. See
 * hydrogen-orbitals/model.ts for primary university tables and normalization.
 * Probability interpretation: Tong, Cambridge, Quantum Mechanics §4.3:
 * https://www.damtp.cam.ac.uk/user/tong/qm/qmhtml/S4.html#S4.SS3
 * The surface is a density threshold, not a fixed enclosed probability or an
 * atomic boundary. Each orbital has a labeled view scale and density range.
 */
import {
    Box, assertEqual, colorBar, column, delay, dynamic, fade, fadeIn, fadeOut, film, isosurface, label3d,
    line, line3d, place, row, scalarField, scene3d, sceneKit, tex, text,
    type Node, type Vec3,
} from 'vizmatic/stage'
import { density, orbitals, sliceOffset } from './_hydrogen-orbitals/model'

assertEqual(orbitals[1].psi(1, 1, 0), 0, '2pz has a nodal plane')
assertEqual(orbitals[2].psi(2, 2, 1), 0, '3d has diagonal nodal planes')

export default film({
    title: 'Hydrogen: seeing a wavefunction',
    description: 'Normalized 1s, 2pz and real 3d(x²−y²) wavefunctions become signed 3D density surfaces and moving probability-density slices. Explicit Bohr-radius scales, nodal planes, and density thresholds distinguish orbitals from electron paths.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 40, bloom: 0,
}, (s) => {
    const kit = sceneKit({ size: 40, heading: { size: 64, y: -466 }, source: { size: 26, y: 490 }, area: { left: -850, right: 850, top: -339, bottom: 404 } })
    s.add(kit.heading('Hydrogen: seeing a wavefunction'))
    s.add(place(text('One electron · fixed proton · no electron orbits', { size: 28, color: 'dim' }), new Box(-850, -416, 100, -370), 'left'))
    s.add(place(column([
        text('UCSB · PHYSCS36', { size: 26, color: 'dim' }),
        text('Delaware · CHEM651', { size: 26, color: 'dim' }),
        text('Tong · Cambridge QM §4.3', { size: 26, color: 'dim' }),
    ], { gap: 2 }), new Box(440, -520, 850, -420), 'right'))
    s.add(place(text('Camera and slice move; the state stays stationary.', { size: 26, color: 'dim' }), new Box(100, -404, 850, -360), 'right'))
    const [beatBox, pictures, equationBox] = kit.area.rows([0.8, 8, 1.2], 24)
    const equationRegion = new Box(equationBox.left, equationBox.top - 28, equationBox.right, equationBox.bottom - 28)
    const [solidBox, densityBox] = pictures.columns([1.45, 1], 72)
    const [solidTitleBox, solidRoom, solidFootBox] = solidBox.rows([1, 7.8, 1], 12)
    const [sliceTitleBox, sliceRoom, rampBox] = densityBox.rows([1, 7.8, 1], 12)
    const colors = ['bg', 'teal', 'yellow'] as const
    const signKey = place(row([
        tex('\\psi>0', { size: 32, color: 'blue' }),
        tex('\\psi<0', { size: 32, color: 'orange' }),
        text('spatial sign', { size: 28, color: 'dim' }),
    ], { gap: 28 }), new Box(350, beatBox.top, 850, beatBox.bottom), 'right')
    s.add(signKey)

    let previous: Node[] = []
    orbitals.forEach((orbital, index) => {
        const start = index * 14
        const intro = [
            '1s: one sign, with probability spread through space.',
            '2pᶻ: the sign reverses across a plane of zero density.',
            '3dₓ²₋ᵧ²: four lobes, separated by two nodal planes.',
        ][index]
        s.chapter(['A probability map', 'A plane of zeros', 'Four lobes, two signs'][index])
        s.caption(index === 0
            ? 'This surface joins points of equal probability density. It is not an electron orbit or a hard edge. The right-hand slice shows density inside and outside it.'
            : index === 1
                ? 'Blue and orange mark opposite signs of the real spatial wavefunction. Squaring it makes both lobes positive. The z equals zero plane remains a node.'
                : 'This real d orbital has positive lobes along x and negative lobes along y. The planes x equals plus or minus y have zero density.', 14)
        const beat = place(text(intro, { size: 37 }), beatBox, 'left')
        const e = orbital.extent, bound = [-e, e] as const, threshold = orbital.peak * 0.08
        const thresholdLabel = place(text('Surface: |ψ|² = 8% of this state’s peak', { size: 29, color: 'dim' }), solidTitleBox)
        const view = scene3d({ theta: -0.9, phi: index === 2 ? 1 : 1.15, unit: orbital.unit, perspective: false, fog: 0.05, ambient: 0.32, shine: 0.14, brightness: 0.95 })
        const surfaces = (fraction: number) => [1, ...(index ? [-1] : [])].map((sign) => isosurface(orbital.psi, {
            x: bound, y: bound, z: bound, level: sign * Math.sqrt(orbital.peak * fraction), resolution: index === 2 ? 40 : 28,
            color: sign > 0 ? 'blue' : 'orange', normals: sign > 0 ? 'decreasing' : 'increasing', cull: true,
        }))
        const primary = surfaces(0.08)
        view.add(...primary)
        const triad = scene3d({ theta: -0.9, phi: index === 2 ? 1 : 1.15, unit: 35, perspective: false, fog: 0 })
        for (const [axis, label] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) {
            const end = [0, 0, 0] as [number, number, number]
            end[axis] = 1
            triad.add(line3d([0, 0, 0], end, { color: 'dim', width: 1.3 }))
            triad.add(label3d(label, [end[0] * 2, end[1] * 2, end[2] * 2], { size: 27, color: 'dim' }))
        }
        triad.at(solidRoom.left + 75, solidRoom.bottom - 65)
        // The moving section samples the same normalized function as the 3D mesh.
        const section = (u: number, v: number, t: number): Vec3 => orbital.slice === 'xz'
            ? [u, sliceOffset(t, start, e), v]
            : [u, v, sliceOffset(t, start, e)]
        const reachSlice = e * 0.8
        // The scene origin is model (0,0,0), fixed while the camera turns.
        view.at(solidRoom.cx, solidRoom.cy)
        const scaleLength = [1, 5, 10][index]
        const scaleLabel = place(row([
            line([0, 0], [scaleLength * orbital.unit, 0], { stroke: 'dim', width: 2 }),
            text(`${scaleLength} a₀`, { size: 28, color: 'dim' }),
            text(orbital.nodes, { size: 28, color: 'dim' }),
        ], { gap: 24 }), solidFootBox)
        const sliceLabel = place(dynamic((t) => text(
            `Density · ${orbital.slice} slice · ${orbital.slice === 'xz' ? 'y' : 'z'} = ${sliceOffset(t, start, e).toFixed(1)} a₀`, { size: 29, color: 'teal' },
        )), sliceTitleBox)
        const imageArea = new Box(sliceRoom.left + 80, sliceRoom.top, sliceRoom.right - 20, sliceRoom.bottom - 45)
        const size = Math.min(imageArea.width, imageArea.height)
        const image = place(scalarField((u, v, t) => density(orbital, ...section(u, v, t)), {
            x: [-reachSlice, reachSlice], y: [-reachSlice, reachSlice], domain: [0, orbital.peak], colors, width: size, height: size, resolution: 160,
        }), imageArea)
        const axisLabels = place(row([
            text(`−${reachSlice.toFixed(1)} a₀`, { size: 26, color: 'dim' }),
            text(`x → +${reachSlice.toFixed(1)} a₀`, { size: 26, color: 'dim' }),
        ], { gap: Math.max(24, size - 320) }), new Box(sliceRoom.left, sliceRoom.bottom - 35, sliceRoom.right, sliceRoom.bottom))
        const verticalLabel = place(text(`${orbital.slice === 'xz' ? 'z' : 'y'} ↑`, { size: 27, color: 'dim' }), new Box(sliceRoom.left, sliceRoom.top, sliceRoom.left + 65, sliceRoom.bottom), 'right')
        const ramp = place(colorBar({ domain: [0, orbital.peak], colors, ticks: [0, orbital.peak], width: size, height: 12, labelSize: 26, format: (v) => v === 0 ? '0' : v.toExponential(2).replace(/e([+-]?\d+)/, '\\times10^{$1}') }), rampBox)
        const formula = place(row([
            tex(orbital.formula, { size: index === 2 ? 33 : 36, display: false }),
            tex('\\rho=|\\psi|^2', { size: 36, color: 'teal', display: false }),
            text('ρ in a₀⁻³', { size: 28, color: 'dim' }),
        ], { gap: 50 }), equationRegion)
        // Coordinate units in the formula are a0; amplitudes carry a0^(-3/2).
        const current: Node[] = [beat, thresholdLabel, view, triad, ...scaleLabel.nodes, sliceLabel, image, ...axisLabels.nodes, verticalLabel, ramp, ...formula.nodes]
        if (!index) s.add(current)
        else s.play(fadeOut(previous, { duration: 0.18 }), delay(fadeIn(current, { duration: 0.32 }), 0.18))
        s.play(view.orbit({ theta: index === 2 ? -0.25 : -0.38 }), triad.orbit({ theta: index === 2 ? -0.25 : -0.38 }), { duration: 10.5 })
        if (index < 2) s.wait(14 - (s.time - start))
        else {
            s.wait(42 - s.time)
            s.chapter('A chosen threshold')
            s.caption('Lowering the density threshold expands the plotted lobes. The wavefunction has not changed. These surfaces do not claim a fixed enclosed probability.', 10)
            const lower = surfaces(0.02)
            view.add(...lower)
            lower.forEach((node) => node.opacity(0))
            const nextBeat = place(text('Lower the threshold. The surface grows; ψ stays the same.', { size: 37 }), beatBox, 'left')
            const lowerLabel = place(text('Surface: |ψ|² = 2% of this state’s peak', { size: 29, color: 'dim' }), solidTitleBox)
            s.play(fadeOut([beat, thresholdLabel], { duration: 0.18 }), delay(fadeIn([nextBeat, lowerLabel], { duration: 0.32 }), 0.18))
            s.play(fadeOut(primary, { duration: 0.35 }), ...lower.map((node) => delay(fade(node, 1, { duration: 0.55 }), 0.35)))
            const meaning = place(text('A density threshold, not a boundary or an enclosed percentage.', { size: 33 }), equationRegion)
            s.play(fadeOut(formula, { duration: 0.18 }), delay(fadeIn(meaning, { duration: 0.32 }), 0.18))
            s.play(view.orbit({ theta: 0.1 }), triad.orbit({ theta: 0.1 }), { duration: 4 })
            s.wait(52 - s.time)
        }
        previous = current
        assertEqual(threshold > 0, true, 'positive plotted density threshold')
    })
})
