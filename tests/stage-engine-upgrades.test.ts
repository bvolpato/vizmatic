import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
    GraphDiagram,
    createTeachingAllocation,
    createTeachingGrid,
    createTeachingRasterWipe,
    createTeachingTimeline,
    createTeachingTransfer,
    getThemeColors,
} from '../src/index'
import {
    Box,
    axes3d,
    beside,
    boxOf,
    card,
    checkFilm,
    chip,
    chipRow,
    combineSoftmaxMass,
    compileFilm,
    connector,
    curve3d,
    dotProduct,
    entropy,
    film,
    focusOn,
    frameToSvg,
    fromSvg,
    gaussian,
    lerpArray,
    line,
    multiplyMatrices,
    namedBox,
    normalizeVector,
    paintFrame,
    pathBounds,
    pictogram,
    place,
    pointAt,
    rect,
    resetCamera,
    row,
    sampleGaussian,
    scene3d,
    seededRandom,
    softmaxTileMass,
    sphere,
    stableSoftmax,
    vector3d,
    zone,
    type Node,
    type PathOp,
    type Rgba,
} from '../src/stage/index'
import { FILM_OBJECTS } from '../src/stage/catalog'
import { fromComponent } from '../src/stage/export'
import { KINDS, PALETTE } from '../src/studio/catalog'

class StubPath2D {
    readonly d: string
    constructor(d = '') {
        this.d = d
    }
    moveTo(): void {}
    lineTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
}

describe('light-look glow halo scaling', () => {
    it('attenuates glow understrokes by 0.22 on light looks in both SVG and Canvas while keeping dark looks luminous', async () => {
        const spec = film({ bloom: 0 }, (s) => {
            s.add(line([-120, 0], [120, 0], { stroke: 'blue', width: 4 }).glow(14))
            s.wait(0.2)
        })
        const darkFilm = await compileFilm(spec, { look: 'midnight' })
        const lightFilm = await compileFilm(spec, { look: 'paper' })
        const darkFrame = darkFilm.frame(0)
        const lightFrame = lightFilm.frame(0)

        expect(darkFrame.dark).toBe(true)
        expect(lightFrame.dark).toBe(false)

        const darkSvg = frameToSvg(darkFrame)
        const lightSvg = frameToSvg(lightFrame)

        const extractGlowOpacities = (svg: string): number[] => {
            const match = /<g[^>]*>([\s\S]*?)<\/g>/.exec(svg)
            expect(match).not.toBeNull()
            const groupBody = match![1]!
            const paths = [...groupBody.matchAll(/<path[^>]*>/g)].map((m) => m[0])
            // 7 glow understrokes inside <g>, with the crisp core stroke right after </g>
            expect(paths).toHaveLength(7)
            return paths.map((tag) => {
                const op = /stroke-opacity="([^"]+)"/.exec(tag)
                return op ? Number(op[1]) : 1
            })
        }

        const darkAlphas = extractGlowOpacities(darkSvg)
        const lightAlphas = extractGlowOpacities(lightSvg)
        darkAlphas.forEach((alpha, i) => {
            expect(lightAlphas[i]!).toBeCloseTo(alpha * 0.22, 2)
        })

        // Verify paintFrame also scales glow alphas by 0.22 on light looks and uses source-over vs screen
        vi.stubGlobal('Path2D', StubPath2D)
        const recordPaint = (frame: typeof darkFrame) => {
            const strokes: Array<{ alpha: number; composite: string }> = []
            const ctx = {
                globalAlpha: 1,
                globalCompositeOperation: 'source-over',
                fillStyle: '#000',
                strokeStyle: '#000',
                lineCap: 'round',
                lineJoin: 'round',
                lineWidth: 1,
                setTransform: vi.fn(),
                transform: vi.fn(),
                clearRect: vi.fn(),
                fillRect: vi.fn(),
                fill: vi.fn(),
                stroke: vi.fn(() => {
                    strokes.push({ alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation })
                }),
                setLineDash: vi.fn(),
                save: vi.fn(),
                restore: vi.fn(),
            }
            paintFrame(ctx as unknown as CanvasRenderingContext2D, frame)
            return strokes
        }

        try {
            const darkStrokes = recordPaint(darkFrame)
            const lightStrokes = recordPaint(lightFrame)
            expect(darkStrokes).toHaveLength(8)
            expect(lightStrokes).toHaveLength(8)
            for (let i = 0; i < 7; i++) {
                expect(darkStrokes[i]!.composite).toBe('screen')
                expect(lightStrokes[i]!.composite).toBe('source-over')
                expect(lightStrokes[i]!.alpha).toBeCloseTo(darkStrokes[i]!.alpha * 0.22, 5)
            }
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

describe('camera choreography verbs: focusOn and resetCamera', () => {
    it('centers Nodes, Blocks, Boxes, and points at screen midpoint and resets cleanly', async () => {
        let targetNode!: ReturnType<typeof rect>
        const compiled = await compileFilm(film({ fps: 30 }, (s) => {
            targetNode = s.add(rect(240, 120, { fill: 'blue' }).at(420, -210))
            const other = s.add(rect(160, 100, { fill: 'teal' }).at(-500, 180))
            const pair = row([
                rect(100, 80, { fill: 'yellow' }),
                rect(100, 80, { fill: 'red' }),
            ], { gap: 40 })
            s.add(place(pair, new Box(-700, 120, -360, 260)))

            s.play(focusOn(s, targetNode, { padding: 120, duration: 1 }))
            s.play(focusOn(s, pair, { margin: 100, duration: 1 }))
            s.play(focusOn(s, new Box(100, 50, 500, 250), { zoom: 1.5, duration: 1 }))
            s.play(focusOn(s, [other.bounds().x, other.bounds().y], { duration: 1 }))
            s.play(resetCamera(s, { duration: 1 }))
        }))

        // At t = 1, targetNode at (420, -210) of size 240x120 should sit centered at (960, 540) in screen space
        const frame1 = compiled.frame(1)
        const expectedZoom = Math.min((1920 - 240) / 240, (1080 - 240) / 120)
        expect(frame1.ops.length).toBeGreaterThan(0)
        const targetOp = frame1.ops[0] as PathOp
        const b1 = pathBounds(targetOp.path)!
        expect(b1.x + b1.width / 2).toBeCloseTo(960, 3)
        expect(b1.y + b1.height / 2).toBeCloseTo(540, 3)
        expect(b1.width).toBeCloseTo(240 * expectedZoom, 2)

        // At t = 3, explicit Box(100, 50, 500, 250) with zoom = 1.5 centers (300, 150) at (960, 540)
        // At t = 4, point focus defaults to zoom = 2
        const frame4 = compiled.frame(4)
        const b4 = pathBounds((frame4.ops[0] as PathOp).path)!
        expect(b4.width).toBeCloseTo(240 * 2, 2)

        // At t = 5, resetCamera restores full-frame view (targetNode back at 960 + 420 = 1380, 540 - 210 = 330)
        const frame5 = compiled.frame(5)
        const b5 = pathBounds((frame5.ops[0] as PathOp).path)!
        expect(b5.x + b5.width / 2).toBeCloseTo(960 + 420, 3)
        expect(b5.y + b5.height / 2).toBeCloseTo(540 - 210, 3)
        expect(b5.width).toBeCloseTo(240, 3)
    })

    it('validates camera targets and documents focusOn and resetCamera in FILM_OBJECTS', async () => {
        await expect(compileFilm(film((s) => {
            s.play(focusOn(s, s.camera))
        }))).rejects.toThrow(/stage\.camera/)

        await expect(compileFilm(film((s) => {
            const box = s.add(rect(100, 100))
            s.play(focusOn(s, box, { zoom: -1 }))
        }))).rejects.toThrow(/zoom/)

        const names = new Set(FILM_OBJECTS.map((entry) => entry.name))
        expect(names.has('focusOn')).toBe(true)
        expect(names.has('resetCamera')).toBe(true)
    })
})

describe('3D engine upgrades: Scene3D.bounds, sculptural two-light shading, and occlusion halos', () => {
    it('projects 2D bounds for Scene3D so boxOf, place, and beside position 3D views accurately', async () => {
        await compileFilm(film((s) => {
            const left3d = scene3d({ unit: 80 })
            left3d.add(sphere(1.5, { color: 'blue' }), axes3d({ x: [-2, 2], y: [-2, 2], z: [-2, 2], labels: false }))

            const rawBounds = left3d.bounds()
            expect(rawBounds.width).toBeGreaterThan(200)
            expect(rawBounds.height).toBeGreaterThan(200)
            expect(boxOf(left3d).width).toBeCloseTo(rawBounds.width, 4)

            const region = new Box(-800, -300, -200, 300)
            s.add(place(left3d, region))
            expect(boxOf(left3d).cx).toBeCloseTo(region.cx, 1)
            expect(boxOf(left3d).cy).toBeCloseTo(region.cy, 1)

            const right3d = scene3d({ unit: 70 })
            right3d.add(sphere(1.2, { color: 'teal' }))
            s.add(beside(right3d, left3d, 'right', 48))
            expect(boxOf(right3d).left).toBeGreaterThan(boxOf(left3d).right + 40)
        }))
    })

    it('separates back-hemisphere surface faces with secondary cool fill and rim shading', async () => {
        const compiled = await compileFilm(film((s) => {
            // Put keyLight behind the camera's opposite hemisphere so visible front faces sit in key shadow
            const view = s.add(scene3d({ phi: Math.PI / 2, theta: 0, perspective: false, fog: 0, light: [-1, 0, 0], unit: 100 }))
            view.add(sphere(1.5, { resolution: [24, 16], color: '#4488ff', mesh: false }))
        }))
        const faceColors = new Set(
            compiled.frame(0).ops
                .filter((op): op is PathOp => op.kind === 'path' && Array.isArray(op.fill))
                .map((op) => (op.fill as Rgba).slice(0, 3).map((c) => c.toFixed(3)).join(',')),
        )
        // With only clamped single-light ambient, every shadow-hemisphere face collapsed to 1 identical color.
        // With two-light fill + rim shading, shadow-hemisphere faces retain smooth sculptural variation.
        expect(faceColors.size).toBeGreaterThan(8)
    })

    it('draws occlusion halos under vector3d by default and on curve3d when enabled', async () => {
        const withHalo = await compileFilm(film((s) => {
            const view = s.add(scene3d({ perspective: false, fog: 0 }))
            view.add(vector3d([0, 0, 0], [1.5, 1.2, 1], { color: 'yellow', width: 3 }))
            view.add(curve3d((t) => [Math.cos(t), Math.sin(t), 0], 0, Math.PI, { color: 'teal', width: 3, halo: 6 }))
        }))
        const withoutHalo = await compileFilm(film((s) => {
            const view = s.add(scene3d({ perspective: false, fog: 0 }))
            view.add(vector3d([0, 0, 0], [1.5, 1.2, 1], { color: 'yellow', width: 3, halo: false }))
            view.add(curve3d((t) => [Math.cos(t), Math.sin(t), 0], 0, Math.PI, { color: 'teal', width: 3 }))
        }))
        const haloOps = withHalo.frame(0).ops.filter((op): op is PathOp => op.kind === 'path')
        const plainOps = withoutHalo.frame(0).ops.filter((op): op is PathOp => op.kind === 'path')
        // Each depth-sorted curve segment plus the vector shaft gets an occlusion understroke
        expect(haloOps.length).toBeGreaterThan(plainOps.length + 1)
        const widths = haloOps.filter((op) => op.stroke !== null).map((op) => op.strokeWidth)
        expect(widths).toContain(7) // vector width 3 + default halo 4
        expect(widths).toContain(9) // curve width 3 + explicit halo 6
    })
})

describe('teaching runtime exports, stage math helpers, and connector obstacle routing + trails', () => {
    it('exports the 5 teaching runtime builders from root index and pure math helpers from stage', () => {
        expect(typeof createTeachingAllocation).toBe('function')
        expect(typeof createTeachingGrid).toBe('function')
        expect(typeof createTeachingRasterWipe).toBe('function')
        expect(typeof createTeachingTimeline).toBe('function')
        expect(typeof createTeachingTransfer).toBe('function')

        // Each teaching builder binds a TeachingPainter and returns a component drawing function
        expect(typeof createTeachingTimeline({} as never)).toBe('function')
        expect(typeof createTeachingAllocation({} as never)).toBe('function')

        const probs = stableSoftmax([1, 2, 3])
        expect(probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
        expect(entropy(probs)).toBeGreaterThan(0)
        expect(dotProduct([2, 3, 4], [1, 0, -1])).toBe(-2)
        expect(normalizeVector([3, 4])).toEqual([0.6, 0.8])
        expect(lerpArray([0, 10], [10, 20], 0.25)).toEqual([2.5, 12.5])
        expect(gaussian(0, 1, 0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 6)
        expect(typeof sampleGaussian(seededRandom(7))).toBe('number')
        expect(multiplyMatrices([[1, 2], [3, 4]], [[2, 0], [1, 2]])).toEqual([[4, 4], [10, 8]])

        const tileA = softmaxTileMass([1, 2], [10, 20])
        const tileB = softmaxTileMass([2, 1], [30, 40])
        const combined = combineSoftmaxMass([tileA, tileB])
        expect(combined.mass).toBeGreaterThan(0)
        expect(Number.isFinite(combined.weightedSum)).toBe(true)
    })

    it('detours connectors around intermediate obstacles with avoid and supports orient + trail on send', async () => {
        let obstacleBounds!: { x: number; y: number; width: number; height: number }
        let directPath!: ReturnType<typeof rect>['base']['path']
        let routedPath!: ReturnType<typeof rect>['base']['path']

        const compiled = await compileFilm(film({ fps: 30 }, (s) => {
            const a = s.add(rect(120, 80, { fill: 'blue' }).at(-420, 0))
            const blocker = s.add(rect(160, 160, { fill: 'red' }).at(0, 0))
            const b = s.add(rect(120, 80, { fill: 'teal' }).at(420, 0))
            obstacleBounds = blocker.bounds()

            const direct = s.add(connector(a, b, { route: 'straight' }))
            const detour = s.add(connector(a, b, { avoid: [blocker], color: 'yellow', width: 3 }))

            const packet = rect(22, 10, { fill: 'yellow', stroke: null })
            s.play(detour.send(packet, { orient: true, trail: true, duration: 1 }))

            directPath = (direct.draw!(0) as readonly Node[])[0]!.get('path')
            routedPath = (detour.draw!(0) as readonly Node[])[0]!.get('path')
        }))

        const hitsBlocker = (path: NonNullable<typeof directPath>) => {
            for (let i = 1; i < 40; i++) {
                const [x, y] = pointAt(path, i / 40)
                if (
                    x > obstacleBounds.x + 2
                    && x < obstacleBounds.x + obstacleBounds.width - 2
                    && y > obstacleBounds.y + 2
                    && y < obstacleBounds.y + obstacleBounds.height - 2
                ) {
                    return true
                }
            }
            return false
        }

        expect(hitsBlocker(directPath!)).toBe(true)
        expect(hitsBlocker(routedPath!)).toBe(false)

        // Mid-flight at t = 0.5, comet trail slices + packet are present; at compiled.duration they have left
        const midOps = compiled.frame(0.5).ops
        const doneOps = compiled.frame(compiled.duration).ops
        expect(midOps.length).toBeGreaterThan(doneOps.length + 3)
    })
})

describe('fromSvg and fromComponent markers, radial gradients, and data-* node lookup', () => {
    it('emits positioned and tangent-rotated marker arrowheads, radial gradients, and data-* ids', () => {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 120" width="240" height="120">
            <defs>
                <radialGradient id="orb" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stop-color="#ffdd00"/>
                    <stop offset="100%" stop-color="#ff3300"/>
                </radialGradient>
                <marker id="head" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/>
                </marker>
            </defs>
            <circle data-node-id="sun" cx="50" cy="60" r="24" fill="url(#orb)"/>
            <line data-vizmatic-graph-edge-id="beam" x1="80" y1="60" x2="200" y2="60" stroke="#22ccff" stroke-width="2" marker-start="url(#head)" marker-end="url(#head)"/>
        </svg>`

        const imported = fromSvg(svg)
        const sun = imported.find('sun')
        const fill = sun.get('fill') as { type: string; stops: unknown[] }
        expect(fill.type).toBe('radial')
        expect(fill.stops).toHaveLength(2)

        const beam = imported.find('beam')
        // Group wrapping [shaft, startMarker, endMarker]
        expect(beam.children).toHaveLength(3)
        const [shaft, startMarker, endMarker] = beam.children
        // Start marker with auto-start-reverse points left (PI radians); end marker points right (0 radians)
        expect(Math.abs(startMarker!.get('rotation'))).toBeCloseTo(Math.PI, 4)
        expect(endMarker!.get('rotation')).toBeCloseTo(0, 4)
        const tipLeaf = endMarker!.leaves()[0]!
        expect(tipLeaf.get('fill')).toEqual(shaft!.get('stroke'))
    })

    it('preserves GraphDiagram marker arrowheads and data-vizmatic-graph-node-id via fromComponent', async () => {
        const c = getThemeColors('dark')
        const diagram = createElement(GraphDiagram, {
            c,
            direction: 'LR',
            nodes: [
                { id: 'api', label: 'API' },
                { id: 'db', label: 'Database' },
            ],
            edges: [{ from: 'api', to: 'db', label: 'query' }],
        })
        const svgNode = await fromComponent(diagram, { width: 640, height: 220 })
        const apiNode = svgNode.find('api')
        const dbNode = svgNode.find('db')
        expect(apiNode.bounds().width).toBeGreaterThan(20)
        expect(dbNode.bounds().width).toBeGreaterThan(20)
        const edge = svgNode.find('route-api-to-db-0')
        expect(edge.children.some((child) => child.data['marker'] === 'end')).toBe(true)
    })
})

describe('consistent .enter() verbs and expanded Studio catalog', () => {
    it('animates card, chip, chipRow, namedBox, zone, and pictogram cleanly with .enter()', async () => {
        const compiled = await compileFilm(film({ fps: 20 }, (s) => {
            const icon = pictogram('database', { size: 72, accent: 'teal' }).at(-650, -180)
            const concept = card({
                title: 'Storage',
                figure: pictogram('logs', { size: 72, accent: 'blue' }),
                caption: 'Durable WAL segments',
                width: 340,
            }).at(-220, -120)
            const pill = chip('virtio', { stroke: 'teal' }).at(220, -240)
            const pills = chipRow(['KVM', 'seccomp', 'cgroup']).at(220, -140)
            const guest = namedBox('guest VM', { width: 260, height: 100, color: 'yellow' }).at(350, 80)
            const inner = rect(200, 90, { fill: 'surface', stroke: 'blue' }).at(-520, 160)
            const boundaryZone = zone(inner, { title: 'Sandbox', padding: 24, dash: true })

            s.wait(0.3)
            s.play(icon.enter())
            s.play(concept.enter())
            s.play(pill.enter(), pills.enter())
            s.play(guest.enter())
            s.play(boundaryZone.enter())
            s.wait(0.5)
        }))

        // Nothing should show at t = 0 before the 0.3s wait
        expect(compiled.frame(0).ops).toHaveLength(0)
        expect(compiled.frame(compiled.duration).ops.length).toBeGreaterThan(20)
        const report = await checkFilm(compiled)
        expect(report.diagnostics).toEqual([])
    })

    it('exposes all 24 new high-value Stage objects in Studio KINDS and PALETTE', () => {
        const expected = [
            'passage', 'histogram', 'scatter', 'dotChart', 'unitChart', 'segmentedBar', 'table',
            'card', 'pictogram', 'zone', 'connector', 'steps', 'tree', 'lanes', 'pipeline',
            'requestQueue', 'ringBuffer', 'bitField', 'stateGrid', 'eventLog', 'terminal',
            'layerStack', 'sphere3d', 'curve3d',
        ]
        const paletteKinds = new Set(PALETTE.map((entry) => entry.kind))
        for (const kind of expected) {
            expect(KINDS[kind], `KINDS[${kind}]`).toBeDefined()
            expect(paletteKinds.has(kind), `PALETTE kind ${kind}`).toBe(true)
        }
    })
})
