import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

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
