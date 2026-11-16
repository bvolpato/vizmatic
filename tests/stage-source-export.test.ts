import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode } from 'fast-png'
import { expect, it } from 'vitest'

it('exports from tsx source without leaking bundler helpers into the raster worker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-source-export-'))
    const output = join(directory, 'frame.png')
    try {
        execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
            import { circle, film } from './src/stage/index.ts';
            import { renderFilmFrame } from './src/stage/export.ts';
            const definition = film({ width: 32, height: 32, bloom: 0.5 }, s => { s.add(circle(6, { fill: '#ffffff' })); s.wait(1); });
            await renderFilmFrame(definition, 0, process.argv[1], { workers: 1 });
        `, output], { timeout: 15_000, stdio: 'pipe' })
        const image = decode(await readFile(output))
        expect([image.width, image.height]).toEqual([32, 32])
        expect(image.data[(16 * 32 + 16) * 4]).toBeGreaterThan(200)
    } finally { await rm(directory, { recursive: true, force: true }) }
})
