/**
 * A proof by rearrangement. The same four triangles sit inside the same square
 * twice, and only slide between the two pictures. Whatever they leave uncovered
 * must have the same area both times, so c^2 = a^2 + b^2. Legs are 3 and 4 units.
 */
import {
    Node, delay, draw, fade, fadeIn, fadeOut, film, morph, polygon, polyPath, rect, shape, smoother, text, tex, to, write,
    type Vec,
} from 'vizmatic/stage'

const A = 3, B = 4
const SIDE = A + B
const UNIT = 74
const HALF = (SIDE * UNIT) / 2
const LEFT_X = -470, RIGHT_X = 470, CY = 40

/** Grid coordinates inside a square, to stage coordinates. */
const at = (cx: number, x: number, y: number): Vec => [cx - HALF + x * UNIT, CY - HALF + y * UNIT]

export default film({
    title: 'Pythagoras by rearrangement',
    description: 'Four triangles slide inside a square, and the leftover area shows why a squared plus b squared equals c squared.',
    fps: 60,
}, (s) => {
    // A single right triangle, introduced at the center.
    const triangle: Vec[] = [[0, 0], [A, 0], [0, B]]
    const fills = ['blue', 'teal', 'purple', 'pink']

    const makeTriangle = (color: string, opacity: number) => {
        const shapeNode = polygon(triangle.map(([x, y]) => [x * UNIT, y * UNIT] as Vec), { fill: color, stroke: color, width: 2.5 })
        shapeNode.set('fillOpacity', opacity)
        return shapeNode
    }

    const hero = makeTriangle('blue', 0.5)
    hero.moveTo([0, 40])
    const heroBounds = hero.bounds()
    const heroAt = (x: number, y: number): Vec => [heroBounds.x + x * UNIT, heroBounds.y + y * UNIT]
    const labelA = tex('a', { size: 44, color: 'yellow', display: false }).moveTo([heroAt(A / 2, 0)[0], heroAt(0, 0)[1] - 30])
    const labelB = tex('b', { size: 44, color: 'teal', display: false }).moveTo([heroAt(0, 0)[0] - 30, heroAt(0, B / 2)[1]])
    const labelC = tex('c', { size: 44, color: 'pink', display: false }).moveTo([heroAt(A / 2, B / 2)[0] + 28, heroAt(A / 2, B / 2)[1] + 22])
    const corner = shape(polyPath([heroAt(0.3, 0), heroAt(0.3, 0.3), heroAt(0, 0.3)]), { stroke: 'ink', width: 2 })

    const title = text('Move the pieces. Keep the square.', { font: 'text-serif', size: 66 })
    title.moveTo([0, -462])

    // Each triangle is rigid: placed by its own origin and rotation, moved only by translation.
    // Corners below are the four positions inside the first big square.
    const placements: { right: Vec; rotation: number; slide: Vec; color: string }[] = [
        { right: [0, 0], rotation: 0, slide: [B, 0], color: fills[0]! },
        { right: [SIDE, 0], rotation: Math.PI / 2, slide: [-A, B], color: fills[1]! },
        { right: [SIDE, SIDE], rotation: Math.PI, slide: [0, -A], color: fills[2]! },
        { right: [0, SIDE], rotation: (3 * Math.PI) / 2, slide: [0, 0], color: fills[3]! },
    ]

    const triangleAt = (cx: number, placement: (typeof placements)[number]) => {
        const node = makeTriangle(placement.color, 0.5)
        node.set('rotation', placement.rotation)
        node.set('px', 0)
        node.set('py', 0)
        node.at(at(cx, placement.right[0], placement.right[1]))
        return node
    }

    // The second picture starts as a copy of the first.
    const frameRight = rect(SIDE * UNIT, SIDE * UNIT, { stroke: 'ink', width: 3 }).at(RIGHT_X, CY)
    const rightTriangles = placements.map((placement) => triangleAt(RIGHT_X, placement))

    const sideMark = (cx: number, from: Vec, to: Vec, label: string, color: string, offset: Vec): Node => {
        const a = at(cx, from[0], from[1]), b = at(cx, to[0], to[1])
        const mid: Vec = [(a[0] + b[0]) / 2 + offset[0], (a[1] + b[1]) / 2 + offset[1]]
        return tex(label, { size: 34, color, display: false }).moveTo(mid)
    }
    const edgeLabels = new Node().add(
        sideMark(LEFT_X, [0, 0], [A, 0], 'a', 'yellow', [0, -30]),
        sideMark(LEFT_X, [A, 0], [SIDE, 0], 'b', 'teal', [0, -30]),
        sideMark(LEFT_X, [0, 0], [0, B], 'b', 'teal', [-28, 0]),
        sideMark(LEFT_X, [0, B], [0, SIDE], 'a', 'yellow', [-28, 0]),
    )

    // Squares the moved triangles reveal.
    const squareB = polygon([at(RIGHT_X, 0, 0), at(RIGHT_X, B, 0), at(RIGHT_X, B, B), at(RIGHT_X, 0, B)], { fill: 'teal', stroke: 'teal', width: 2.5 })
    squareB.set('fillOpacity', 0.3)
    const squareA = polygon([at(RIGHT_X, B, B), at(RIGHT_X, SIDE, B), at(RIGHT_X, SIDE, SIDE), at(RIGHT_X, B, SIDE)], { fill: 'orange', stroke: 'orange', width: 2.5 })
    squareA.set('fillOpacity', 0.3)
    const bSquared = tex('b^2', { size: 64, color: 'teal' }).moveTo(at(RIGHT_X, B / 2, B / 2))
    const aSquared = tex('a^2', { size: 52, color: 'orange' }).moveTo(at(RIGHT_X, B + A / 2, B + A / 2))

    const sameLeft = text('Same square', { font: 'text-serif', italic: true, size: 38, color: 'dim' }).moveTo([0, CY - 28])
    const sameRight = text('Same four triangles', { font: 'text-serif', italic: true, size: 38, color: 'dim' }).moveTo([0, CY + 28])

    const equation = tex('c^2 = a^2 + b^2', { size: 96 }).moveTo([0, 448])
    for (const glyph of equation.part('c^2')) glyph.fill('yellow')
    for (const glyph of equation.part('a^2')) glyph.fill('orange')
    for (const glyph of equation.part('b^2')) glyph.fill('teal')

    // A unit-grid check for the 3-4-5 case.
    const check = tex('25 = 9 + 16', { size: 64, color: 'dim' })
    const tilesA = new Node(), tilesB = new Node()
    for (let x = 0; x < A; x++) for (let y = 0; y < A; y++) tilesA.add(rect(UNIT - 5, UNIT - 5, { stroke: 'orange', width: 1.5 }).at(at(RIGHT_X, B + x + 0.5, B + y + 0.5)))
    for (let x = 0; x < B; x++) for (let y = 0; y < B; y++) tilesB.add(rect(UNIT - 5, UNIT - 5, { stroke: 'teal', width: 1.5 }).at(at(RIGHT_X, x + 0.5, y + 0.5)))

    // ── Timeline ────────────────────────────────────────────────────────────

    s.chapter('A right triangle')
    s.play(write(title), draw(hero), { duration: 1.8 })
    s.play(draw(corner), write(labelA), write(labelB), write(labelC), { duration: 1.2 })
    s.wait(0.8)

    s.chapter('Four copies')
    s.play(fadeOut([labelA, labelB, labelC, corner]), to(hero, (node) => {
        node.set('px', 0)
        node.set('py', 0)
        node.at(at(0, 0, 0))
    }), { duration: 0.9 })
    const center = placements.map((placement) => triangleAt(0, placement))
    const frameCenter = rect(SIDE * UNIT, SIDE * UNIT, { stroke: 'ink', width: 3 }).at(0, CY)
    s.add(center[0]!)
    s.remove(hero)
    for (let i = 1; i < 4; i++) {
        const placement = placements[i]!
        const copy = center[i]!
        const finalRotation = placement.rotation
        copy.set('rotation', finalRotation - Math.PI / 2)
        copy.at(at(0, placement.right[0] * 0.5 - 0.2, placement.right[1] * 0.5 - 0.2))
        s.add(copy)
        copy.opacity(0)
        s.play(to(copy, (node) => {
            node.opacity(1)
            node.set('rotation', finalRotation)
            node.at(at(0, placement.right[0], placement.right[1]))
        }, { ease: smoother }), { duration: 0.9 })
    }
    s.play(draw(frameCenter), { duration: 0.8 })
    s.wait(0.5)

    s.chapter('The tilted square')
    const centerTilt = polygon([at(0, A, 0), at(0, SIDE, A), at(0, B, SIDE), at(0, 0, B)], { fill: 'yellow', stroke: 'yellow', width: 2.5 })
    centerTilt.set('fillOpacity', 0.34)
    const centerCSquared = tex('c^2', { size: 72, color: 'yellow' }).moveTo([0, CY])
    s.play(fadeIn(centerTilt), write(centerCSquared), { duration: 1.2 })
    s.wait(0.6)

    s.chapter('Two pictures')
    // Split into a left copy that stays and a right copy that will move.
    const everything = [frameCenter, centerTilt, centerCSquared, ...center]
    s.play(
        ...everything.map((node) => to(node, (n) => n.shift(LEFT_X, 0))),
        fadeIn([frameRight, ...rightTriangles], { shift: [-200, 0] }),
        { duration: 1.5, ease: smoother },
    )
    s.add(edgeLabels)
    s.play(fadeIn(edgeLabels), fadeIn([sameLeft, sameRight]), { duration: 0.8 })
    s.wait(0.8)

    s.chapter('Slide')
    for (let i = 0; i < 3; i++) {
        const placement = placements[i]!
        const node = rightTriangles[i]!
        s.play(to(node, (n) => n.shift(placement.slide[0] * UNIT, placement.slide[1] * UNIT), { ease: smoother }), { duration: 1.25 })
        s.wait(0.2)
    }
    s.add(squareB, squareA)
    squareB.zIndex(-1)
    squareA.zIndex(-1)
    s.play(fadeIn([squareB, squareA]), write(bSquared), write(aSquared), { duration: 1.1 })
    s.wait(0.8)

    s.chapter('The theorem')
    // Copies of each square's label fly into the equation, so its terms come from the pictures.
    s.add(equation)
    for (const glyph of equation.glyphs) glyph.hide()
    s.play(
        morph(centerCSquared.clone(), equation.part('c^2')),
        morph(aSquared.clone(), equation.part('a^2')),
        morph(bSquared.clone(), equation.part('b^2')),
        fade(sameLeft, 0), fade(sameRight, 0),
        { duration: 1.6, ease: smoother },
    )
    s.play(fadeIn([...equation.part('='), ...equation.part('+')]), { duration: 0.6 })
    s.wait(1)
    check.moveTo([430, 448])
    s.play(to(equation, (eq) => eq.shift(-300, 0)), fadeIn([tilesA, tilesB], { lag: 0.02 }), delay(fadeIn(check, { shift: [-30, 0] }), 0.5), fade(aSquared, 0), fade(bSquared, 0), { duration: 1.4 })
    s.wait(3)
})
