import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import React from 'react'
import * as esm from '../dist/index.js'

const cjs = createRequire(import.meta.url)('../dist/index.cjs')
const element = React.createElement('div', {
    style: { display: 'flex', backgroundColor: '#ffffff', color: '#000000' },
}, 'Runtime check')

for (const [format, api] of [['ESM', esm], ['CJS', cjs]]) {
    const svg = await api.renderToSvg(element, 240, 80)
    assert.match(svg, /^<svg\b/)
    assert.ok(svg.includes('<path'), `${format} must render text outlines`)
    const png = await api.renderToBuffer(element, 240, 80, { scale: 1 })
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), 240)
    assert.equal(png.readUInt32BE(20), 80)
    console.log(`${format} SVG and PNG render passed`)
}

const output = await mkdtemp(join(tmpdir(), 'vizmatic-runtime-'))
try {
    const result = spawnSync(process.execPath, [
        'dist/cli.js', 'examples/transparent-badge.tsx',
        '--out', output, '--theme', 'dark,light', '--no-crop',
    ], { encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout)
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest[0].width, 760)
    assert.equal(manifest[0].height, 420)
    for (const theme of ['dark', 'light']) {
        const png = await readFile(join(output, `transparent-badge_${theme}.png`))
        assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        assert.equal(png.readUInt32BE(16), 1520)
        assert.equal(png.readUInt32BE(20), 840)
    }
    console.log(`CLI dark/light rendering passed on ${process.version}`)
} finally {
    await rm(output, { recursive: true, force: true })
}
