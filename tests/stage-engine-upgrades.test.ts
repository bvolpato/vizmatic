import { createElement } from 'react'
import { Resvg } from '@resvg/resvg-js'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { describe, expect, it } from 'vitest'
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
    frameInkBounds,
    frameToSvg,
    fromSvg,
    gaussian,
    group,
    lerpArray,
    multiplyMatrices,
    namedBox,
    normalizeVector,
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
    type Frame,
} from '../src/stage/index'
import { linePath, rectPath } from '../src/stage/geometry'
import { FILM_OBJECTS } from '../src/stage/catalog'
import { fromComponent } from '../src/stage/export'
import { KINDS, PALETTE } from '../src/studio/catalog'

function glowFrame(dark = true, changes: Partial<PathOp> = {}): Frame {
    const path = linePath([80, 120], [240, 120])
    return { width: 320, height: 240, background: null, bloom: 0, dark, ops: [{
        kind: 'path', path, strokePath: path, fill: null, fillAlpha: 0,
        stroke: [255, 255, 255, 1], strokeAlpha: 1, strokeWidth: 4,
        cap: 'round', join: 'round', dash: null, dashOffset: 0,
        glow: 40, glowColor: null, blend: 'normal', ...changes,
    }] }
}

function glowPixels(frame: Frame, scale = 1): Uint8Array {
    return new Resvg(frameToSvg(frame, { scale }), { font: { loadSystemFonts: false } }).render().pixels
}

describe('smooth node glow', () => {
    it('fades continuously to zero with the original halo intensity and extent, and keeps a crisp core', () => {
        const pixels = glowPixels(glowFrame())
        const alpha = (x: number, y: number) => pixels[(y * 320 + x) * 4 + 3]
        const profile = Array.from({ length: 64 }, (_, i) => alpha(160, 124 + i))
        const jumps = profile.slice(1).map((value, i) => Math.abs(value - profile[i]))
        // The old seven strokes jump by 20/255 at this radius. Check actual pixels, not pass counts.
        expect(Math.max(...jumps)).toBeLessThanOrEqual(5)
        expect(new Set(profile).size).toBeGreaterThan(25)
        expect(profile.every((value, i) => i === 0 || value <= profile[i - 1])).toBe(true)
        expect(profile[0]).toBeGreaterThan(75)
        expect(profile[0]).toBeLessThan(105)
        expect(profile.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(1100)
        expect(profile.reduce((sum, value) => sum + value, 0)).toBeLessThan(1600)
        expect(alpha(160, 166)).toBeLessThanOrEqual(1)
        expect(alpha(160, 120)).toBe(255)
    })

    it('attenuates only the halo by 0.22 on light looks', () => {
        const dark = glowPixels(glowFrame()), light = glowPixels(glowFrame(false))
        for (let y = 124; y < 168; y++) {
            const index = (y * 320 + 160) * 4 + 3
            expect(Math.abs(light[index] - dark[index] * 0.22)).toBeLessThanOrEqual(1.5)
        }
        expect(light[(120 * 320 + 160) * 4 + 3]).toBe(255)
    })

    it('bounds filters to the trimmed geometry without clipping the blur tail or zero-height paths', () => {
        const frame = glowFrame(true, { strokePath: linePath([80, 120], [160, 120]) })
        const svg = frameToSvg(frame)
        const filter = /<filter\b[^>]+>/.exec(svg)?.[0]
        expect(filter).toBeDefined()
        const attr = (name: string) => Number(new RegExp(` ${name}="([^"]+)"`).exec(filter!)?.[1])
        expect(attr('width') * attr('height')).toBeLessThan(frame.width * frame.height / 2)
        expect(attr('height')).toBeGreaterThan(80)
        // Enlarging the filter must not uncover any clipped halo pixels.
        const enlarged = svg.replace(filter!, filter!.replace(/ (x|y|width|height)="[^"]+"/g, '')
            .replace('>', ' x="-320" y="-240" width="960" height="720">'))
        const pixels = glowPixels(frame), reference = new Resvg(enlarged).render().pixels
        expect(Math.max(...pixels.filter((_, i) => i % 4 === 3).map((a, i) => Math.abs(a - reference[i * 4 + 3])))).toBeLessThanOrEqual(1)
        expect(pixels[(120 * 320 + 230) * 4 + 3]).toBe(0)
        expect(pixels[(110 * 320 + 70) * 4 + 3]).toBeGreaterThan(5)
        const clipped = glowPixels(glowFrame(true, { clips: [rectPath(100, 100, 60, 40)] }))
        expect(clipped[(120 * 320 + 99) * 4 + 3]).toBe(0)
        expect(clipped[(120 * 320 + 100) * 4 + 3]).toBe(255)
        expect(clipped[(99 * 320 + 130) * 4 + 3]).toBe(0)
    })

    it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('matches browser Canvas and SVG pixels at device scales, including clips and trimmed strokes', async () => {
        const bundled = await build({ entryPoints: ['src/stage/display.ts'], bundle: true, write: false,
            format: 'iife', globalName: 'glowRenderer', platform: 'browser', target: 'es2022' })
        const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
        try {
            const page = await browser.newPage()
            await page.addScriptTag({ content: bundled.outputFiles[0].text })
            const shape = rectPath(120, 90, 80, 60, 12)
            const frames = [
                glowFrame(), glowFrame(false),
                glowFrame(true, { strokeAlpha: 0, fillAlpha: 1 }),
                glowFrame(true, { strokePath: linePath([80, 120], [160, 120]), clips: [rectPath(100, 100, 100, 40)] }),
                glowFrame(true, { path: shape, strokePath: shape, stroke: null, fill: [255, 255, 255, 1], fillAlpha: 1 }),
                glowFrame(true, { path: linePath([-10, 5], [100, 5]), strokePath: linePath([-10, 5], [100, 5]) }),
                ...[true, false].map(dark => ({ ...glowFrame(dark, { stroke: [70, 150, 210, 1], strokeAlpha: 0, fillAlpha: 1, blend: 'multiply' }), background: '#406080' })),
            ]
            for (const frame of frames) for (const scale of [0.5, 1, 2]) for (const offscreen of [false, true]) {
                const actual = await page.evaluate(async ({ serialized, svg, scale, offscreen }) => {
                    const frame = JSON.parse(serialized)
                    const canvas = offscreen ? new OffscreenCanvas(frame.width * scale, frame.height * scale) : document.createElement('canvas')
                    canvas.width = frame.width * scale; canvas.height = frame.height * scale
                    const ctx = canvas.getContext('2d', { willReadFrequently: true })! as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
                    const renderer = (globalThis as unknown as { glowRenderer: { paintFrame: typeof import('../src/stage/display').paintFrame } }).glowRenderer
                    const encode = (data: Uint8ClampedArray): string => {
                        let bytes = ''
                        for (let i = 0; i < data.length; i += 32768) bytes += String.fromCharCode(...data.subarray(i, i + 32768))
                        return btoa(bytes)
                    }
                    renderer.paintFrame(ctx, { ...frame, background: null, ops: frame.ops.map((op: PathOp) => ({ ...op, glow: 0 })) }, scale)
                    const core = encode(ctx.getImageData(0, 0, canvas.width, canvas.height).data.filter((_, i) => i % 4 === 3))
                    renderer.paintFrame(ctx, frame, scale)
                    const painted = encode(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
                    const image = new Image()
                    image.src = 'data:image/svg+xml,' + encodeURIComponent(svg)
                    await image.decode()
                    ctx.setTransform(1, 0, 0, 1, 0, 0)
                    ctx.clearRect(0, 0, canvas.width, canvas.height)
                    ctx.drawImage(image, 0, 0)
                    return { painted, core, svg: encode(ctx.getImageData(0, 0, canvas.width, canvas.height).data) }
                }, { serialized: JSON.stringify(frame, (_, value) => value instanceof Float64Array ? Array.from(value) : value), svg: frameToSvg(frame, { scale }), scale, offscreen })
                const reference = glowPixels(frame, scale)
                const referenceCore = glowPixels({ ...frame, background: null, ops: frame.ops.map(op => ({ ...op, glow: 0 })) }, scale)
                const canvasCore = Buffer.from(actual.core, 'base64')
                // Compare premultiplied channels; RGB under near-zero alpha is quantized differently by rasterizers.
                for (const encoded of [actual.painted, actual.svg]) {
                    const pixels = Buffer.from(encoded, 'base64')
                    let max = 0, total = 0, at = 0
                    for (let i = 0; i < pixels.length; i += 4) {
                        // Exclude the independently rendered crisp core, including both rasterizers' antialiased edge pixels.
                        if (referenceCore[i + 3] || canvasCore[i / 4]) continue
                        for (let c = 0; c < 4; c++) {
                            const a = pixels[i + c] * (c === 3 ? 1 : pixels[i + 3] / 255)
                            const b = reference[i + c] // Resvg.pixels already contains premultiplied RGB.
                            const delta = Math.abs(a - b)
                            if (delta > max) { max = delta; at = i / 4 }
                            total += delta
                        }
                    }
                    const context = `scale=${scale}, dark=${frame.dark}, offscreen=${offscreen}, pixel=${at % (frame.width * scale)},${Math.floor(at / (frame.width * scale))}`
                    expect(max, context).toBeLessThanOrEqual(8)
                    expect(total / pixels.length, context).toBeLessThan(0.6)
                    if (frame === frames[0] || frame === frames[1]) {
                        expect(pixels[(120 * scale * frame.width * scale + 160 * scale) * 4 + 3]).toBe(255)
                    }
                }
            }
        } finally {
            await browser.close()
        }
    }, 30_000)
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
    it('measures projected geometry through transformed parent groups', () => {
        const view = scene3d({ unit: 100 })
        view.add(sphere(1, { mesh: false }))
        const parent = group(group(view).at(40, -30)).at(200, 100).scale(1.5).rotate(0.3)
        expect(view.bounds().width).toBeGreaterThan(200)
        expect(parent.bounds()).toEqual(view.bounds())
        const region = new Box(-700, -200, -200, 200)
        place(parent, region)
        expect(boxOf(parent).cx).toBeCloseTo(region.cx, 5)
        expect(boxOf(parent).cy).toBeCloseTo(region.cy, 5)
        view.hide()
        expect(parent.bounds()).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    })

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
    it.each([
        ['horizontal', 'x1="10" y1="50" x2="90" y2="50"', { x: -40, y: 0, width: 80, height: 0 }, { x: 9, y: 49, width: 82, height: 2 }],
        ['vertical', 'x1="50" y1="10" x2="50" y2="90"', { x: 0, y: -40, width: 0, height: 80 }, { x: 49, y: 9, width: 2, height: 82 }],
        ['disjoint', 'x1="10" y1="150" x2="90" y2="150"', { x: 0, y: 0, width: 0, height: 0 }, null],
    ] as const)('measures %s embedded line bounds and stroke ink after clipping', async (_, attributes, bounds, ink) => {
        const inner = `<svg width="100" height="100"><line ${attributes} stroke="#ff0000" stroke-width="2"/></svg>`
        const uri = `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`
        const imported = fromSvg(`<svg width="100" height="100"><image width="100" height="100" href="${uri}"/></svg>`)
        expect(imported.bounds()).toEqual(bounds)
        const compiled = await compileFilm(film({ width: 100, height: 100, bloom: 0 }, (s) => {
            s.add(imported)
            s.wait(1)
        }))
        expect(frameInkBounds(compiled.frame(0))).toEqual(ink)
    })

    it('clips embedded slice images to their viewport without clipping following marks', async () => {
        const inner = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#ff0000"/></svg>'
        const uri = `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`
        const source = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140"><image x="20" y="20" width="200" height="100" preserveAspectRatio="xMidYMid slice" href="${uri}"/><rect x="5" y="5" width="10" height="10" fill="#00ff00"/></svg>`
        const compiled = await compileFilm(film({ width: 240, height: 140, bloom: 0 }, (s) => {
            s.add(fromSvg(source))
            s.wait(1)
        }))
        const actual = new Resvg(frameToSvg(compiled.frame(0), { transparent: true })).render().pixels
        const expected = new Resvg(source).render().pixels
        const at = (pixels: Uint8Array, x: number, y: number) => [...pixels.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 4)]
        for (const [x, y] of [[120, 5], [120, 25], [120, 115], [120, 125], [10, 10], [230, 70]]) {
            expect(at(actual, x!, y!)).toEqual(at(expected, x!, y!))
        }
        expect(at(actual, 120, 25)).toEqual([255, 0, 0, 255])
    })

    it('keeps invalid encoded graph IDs importable while decoding valid aliases', () => {
        const invalid = 'vizmatic-graph-index-0-node-_u110000_'
        const imported = fromSvg(`<svg width="100" height="100">
            <rect id="${invalid}" x="10" y="10" width="20" height="20" fill="red"/>
            <rect id="vizmatic-graph-index-0-node-_u1f600_" x="40" y="10" width="20" height="20" fill="blue"/>
        </svg>`)
        expect(imported.find(invalid).bounds().width).toBe(20)
        expect(imported.find('😀').bounds().width).toBe(20)
    })

    it.each([
        ['', 60, 80],
        ['xMinYMin meet', 10, 80],
        ['xMaxYMax meet', 110, 80],
        ['none', 20, 160],
    ])('preserves embedded SVG viewport proportions and alignment: %s', (aspect, x, width) => {
        const inner = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle id="orb" cx="50" cy="50" r="40" fill="#ff0000"/></svg>'
        const uri = `data:image/svg+xml;base64,${Buffer.from(inner).toString('base64')}`
        const imported = fromSvg(`<svg width="200" height="100"><image width="200" height="100" href="${uri}" ${aspect ? `preserveAspectRatio="${aspect}"` : ''}/></svg>`, { center: false })
        const bounds = imported.find('orb').bounds()
        expect(bounds.x).toBeCloseTo(x, 5)
        expect(bounds.y).toBeCloseTo(10, 5)
        expect(bounds.width).toBeCloseTo(width, 5)
        expect(bounds.height).toBeCloseTo(80, 5)
    })

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
