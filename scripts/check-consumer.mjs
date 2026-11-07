import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Films from the installed package: both module formats, the bundled fonts, the worker, and the CLI. */
async function checkFilms(consumer) {
    const body = `(s) => { s.add(stage.text('Installed', { font: 'serif', size: 80 })); s.add(stage.tex('e^{i\\\\pi} = -1').at(0, 160)); s.wait(0.2) }`
    await writeFile(join(consumer, 'film-esm.mjs'), `import * as stage from 'vizmatic/stage'
import { renderFilmFrame } from 'vizmatic/stage/export'
const output = await renderFilmFrame(stage.film(${body}), 0.1, 'film-esm.png', { width: 320 })
console.log('ESM film rendered', output.width)
`)
    await writeFile(join(consumer, 'film-cjs.cjs'), `const stage = require('vizmatic/stage')
const { renderFilmFrame } = require('vizmatic/stage/export')
renderFilmFrame(stage.film(${body}), 0.1, 'film-cjs.png', { width: 320 }).then((output) => console.log('CJS film rendered', output.width), (error) => { console.error(error); process.exit(1) })
`)
    for (const script of ['film-esm.mjs', 'film-cjs.cjs']) {
        const { stdout } = await run(process.execPath, [script], { cwd: consumer, encoding: 'utf8', timeout: 90_000 })
        process.stdout.write(stdout)
    }
    const cli = join(consumer, 'node_modules/vizmatic/dist/cli.js')
    await writeFile(join(consumer, 'transparent-image.mjs'), `import { film, image, resolveImageAsset } from 'vizmatic/stage'
const asset = await resolveImageAsset('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4XgEFAPr/AAAAAAAABQABvmmylwAAAABJRU5ErkJggg==')
export default film({ width: 64, height: 64, fps: 10, bloom: 0 }, s => { s.add(image(asset)); s.wait(2) })
`)
    await writeFile(join(consumer, 'image-bundles.mjs'), `import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import definition from './transparent-image.mjs'
const other = createRequire(import.meta.url)('vizmatic/stage')
const compiled = await definition.compile()
assert.equal(other.frameInkBounds(compiled.frame(1)), null)
assert.ok((await other.checkFilm(compiled, { motion: true })).diagnostics.some(d => d.code === 'film.blank'))
`)
    await run(process.execPath, ['image-bundles.mjs'], { cwd: consumer, encoding: 'utf8', timeout: 60_000 })
    const imageCheck = await run(process.execPath, [cli, 'check', 'transparent-image.mjs', '--motion', '--json'], { cwd: consumer, encoding: 'utf8', timeout: 60_000 })
    assert.ok(JSON.parse(imageCheck.stdout).files[0].diagnostics.some(d => d.code === 'film.blank'), 'Packaged CLI must retain image alpha across its engine bundles')
    console.log('Installed image alpha survives ESM, CJS and CLI bundle boundaries')
    await run(process.execPath, [cli, 'new', 'intro', '--template', 'explainer'], { cwd: consumer, encoding: 'utf8', timeout: 60_000 })
    const check = await run(process.execPath, [cli, 'check', 'intro.ts', '--json'], { cwd: consumer, encoding: 'utf8', timeout: 90_000 })
    assert.equal(JSON.parse(check.stdout).ok, true, 'A new film must pass its own check')
    await run(process.execPath, [cli, 'film', 'intro.ts', '--frame', '3', '--width', '320', '--out', 'stills'], { cwd: consumer, encoding: 'utf8', timeout: 90_000 })
    assert.equal((await readFile(join(consumer, 'stills/intro_t003.000.png'))).subarray(1, 4).toString('ascii'), 'PNG')
    console.log('Film CLI passed from the installed package')
}
const repository = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'vizmatic-consumer-'))
const registry = 'https://registry.npmjs.org/'

try {
    let tarball = process.argv[2] ? resolve(process.argv[2]) : undefined
    if (!tarball) {
        // Older npm 10 ignores script-shell during prepare. CI packs on Node 22 before switching runtimes.
        const packed = await run('npm', ['pack', '--ignore-scripts', '--script-shell=true', '--json', '--pack-destination', directory], {
            cwd: repository, encoding: 'utf8', timeout: 60_000,
        })
        const metadataStart = packed.stdout.search(/^\[/m)
        assert.ok(metadataStart >= 0, 'npm pack must return JSON metadata')
        const metadata = JSON.parse(packed.stdout.slice(metadataStart))
        assert.equal(metadata.length, 1, 'npm pack must produce one package')
        tarball = join(directory, metadata[0].filename)
    }
    const consumer = join(directory, 'consumer')
    await mkdir(consumer)
    await writeFile(join(consumer, 'package.json'), JSON.stringify({
        private: true,
        type: 'module',
        devDependencies: {
            '@types/node': JSON.parse(await readFile(join(repository, 'node_modules/@types/node/package.json'), 'utf8')).version,
            '@types/react': JSON.parse(await readFile(join(repository, 'node_modules/@types/react/package.json'), 'utf8')).version,
        },
    }))
    const npmrc = join(directory, 'npmrc')
    await writeFile(npmrc, '')
    await run('npm', ['install', tarball,
        '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-online',
        '--registry', registry, '--userconfig', npmrc], {
        cwd: consumer, encoding: 'utf8', timeout: 120_000,
    })
    const audit = await run('npm', ['audit', '--audit-level=low', '--registry', registry, '--userconfig', npmrc], {
        cwd: consumer, encoding: 'utf8', timeout: 60_000,
    })
    process.stdout.write(audit.stdout)
    await writeFile(join(consumer, 'consumer.ts'), `import React from 'react'
import { renderToSvg, type SatoriNode } from 'vizmatic'
void renderToSvg(React.createElement('div', null, 'Typed consumer'), 240, 80, {
    onNodeDetected: (node: SatoriNode) => { void node.width },
})
`)
    await copyFile(join(consumer, 'consumer.ts'), join(consumer, 'consumer.cts'))
    await run(process.execPath, [join(repository, 'node_modules/typescript/bin/tsc'),
        '--strict', '--noEmit', '--module', 'NodeNext', '--target', 'ES2022',
        '--types', 'node,react', 'consumer.ts', 'consumer.cts',
    ], { cwd: consumer, encoding: 'utf8', timeout: 60_000 })
    console.log('Installed package TypeScript declarations passed')
    await copyFile(join(repository, 'scripts/check-runtime.mjs'), join(consumer, 'check-runtime.mjs'))
    const runtimeLog = join(directory, 'runtime.log')
    const output = await open(runtimeLog, 'w')
    let code
    try {
        const child = spawn(process.execPath, ['check-runtime.mjs', '--installed'], {
            cwd: consumer, stdio: ['ignore', output.fd, output.fd], timeout: 90_000,
        })
        const result = await once(child, 'close')
        code = result[0]
    } finally {
        await output.close()
    }
    const log = await readFile(runtimeLog, 'utf8')
    assert.equal(code, 0, log.slice(-4_000))
    process.stdout.write(log)
    await checkFilms(consumer)
    console.log(`Packed npm consumer passed on ${process.version}`)
} catch (error) {
    const details = error.stderr || error.stdout || error.message
    throw new Error(`Packed npm consumer failed (${error.code ?? 'unknown'}):\n${details.slice(-4_000)}`)
} finally {
    await rm(directory, { recursive: true, force: true })
}
