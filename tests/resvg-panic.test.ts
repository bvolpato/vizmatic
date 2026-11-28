import { spawnSync } from 'node:child_process'
import { Resvg } from '@resvg/resvg-js'
import { expect, it } from 'vitest'
import { circle, compileFilm, film, frameToSvg, line } from '../src/stage'

it('contains clipped offscreen opacity panics and renders again in the same process', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><g clip-path="url(#c)"><path d="M15 -5L16 8" stroke="black" opacity=".5"/><path d="M-5 18L16 19" stroke="black" opacity=".5"/></g></svg>'
    const result = spawnSync(process.execPath, ['--eval', `
        const { Resvg } = require('@resvg/resvg-js')
        let caught = null
        try {
            new Resvg(${JSON.stringify(svg)}).render()
        } catch (error) {
            caught = { isError: error instanceof Error, message: error.message }
        }
        const image = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>').render()
        console.log(JSON.stringify({ caught, width: image.width, height: image.height, pixels: [...image.pixels] }))
    `], { encoding: 'utf8', timeout: 10_000 })

    expect(result.error).toBeUndefined()
    expect(result.signal, result.stderr).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    const rendered = JSON.parse(result.stdout)
    expect(rendered.caught).toMatchObject({ isError: true, message: expect.stringMatching(/resvg panic/i) })
    expect(rendered).toMatchObject({ width: 2, height: 2, pixels: Array(4).fill([255, 0, 0, 255]).flat() })
})

it('draws a frame with blended marks far outside it, and leaves them out of the SVG', async () => {
    const compiled = await compileFilm(film({ width: 200, height: 100, fps: 10, background: '#000000', bloom: 0 }, (s) => {
        s.add(circle(20, { fill: '#0000ff', stroke: null }).at(0, 0))
        s.add(circle(20, { fill: '#ff0000', stroke: null }).at(9000, 0).set('blend', 'screen'))
        s.add(line([-5000, -400], [5000, -400], { stroke: '#00ff00', width: 10 }).set('blend', 'screen'))
        // A glow and a wide stroke that start outside the frame still reach into it.
        s.add(circle(4, { fill: '#ffffff', stroke: null, glow: 30 }).at(110, 0))
        s.add(line([-100, 55], [100, 55], { stroke: '#ffffff', width: 20 }))
        s.wait(1)
    }))
    const svg = frameToSvg(compiled.frame(0.5))
    expect(svg).not.toContain('255,0,0')
    expect(svg).not.toContain('0,255,0')
    const image = new Resvg(svg).render(), pixel = (x: number, y: number) => [...image.pixels.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)]
    expect(pixel(100, 50)).toEqual([0, 0, 255])
    expect(pixel(100, 98)).toEqual([255, 255, 255])
    expect(pixel(198, 50)[0]).toBeGreaterThan(20)
})

it('tests each part of a mark by itself: a stroke that is drawn in part, and a fill whose glow reaches the frame', async () => {
    const compiled = await compileFilm(film({ width: 200, height: 100, fps: 10, background: '#000000', bloom: 0 }, (s) => {
        // The drawn part of this line is far at the left of the frame, and its whole path crosses the frame.
        s.add(line([-200, 0], [200, 0], { stroke: '#ff0000', width: 1 }).set('trimTo', 0.3).set('blend', 'screen'))
        // The fill is far under the frame, and the glow reaches into it.
        s.add(circle(1, { fill: '#00ff00', stroke: null, glow: 10 }).at(0, 8).set('blend', 'screen'))
        s.camera.set('sx', 60)
        s.camera.set('sy', 60)
        s.wait(1)
    }))
    const svg = frameToSvg(compiled.frame(0.5))
    expect(svg).not.toContain('255,0,0')
    // The glow stays, and the fill that it belongs to does not.
    expect(svg).toContain('stroke="rgb(0,255,0)"')
    expect(svg).not.toContain('fill="rgb(0,255,0)"')
    expect(new Resvg(svg).render().width).toBe(200)
})
