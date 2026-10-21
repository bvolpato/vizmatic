import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
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
        overrides: { '@xmldom/xmldom': '0.9.12', fflate: '0.7.5' },
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
    console.log(`Packed npm consumer passed on ${process.version}`)
} catch (error) {
    const details = error.stderr || error.stdout || error.message
    throw new Error(`Packed npm consumer failed (${error.code ?? 'unknown'}):\n${details.slice(-4_000)}`)
} finally {
    await rm(directory, { recursive: true, force: true })
}
