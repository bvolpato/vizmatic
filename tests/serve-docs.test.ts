import { spawn, type ChildProcess } from 'child_process'
import { once } from 'events'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let directory: string
let server: ChildProcess
let origin: string

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vizmatic-docs-range-'))
    await writeFile(join(directory, 'film.mp4'), Buffer.from('0123456789'))
    server = spawn(process.execPath, [resolve('scripts/serve-docs.mjs'), directory, '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
    origin = await new Promise<string>((resolveOrigin, reject) => {
        let output = ''
        server.once('error', reject)
        server.once('exit', (code) => reject(new Error(`Docs server exited with code ${code}`)))
        server.stdout!.on('data', (chunk) => {
            output += String(chunk)
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
            if (match) resolveOrigin(match[0])
        })
    })
})

afterAll(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
        const closed = once(server, 'close')
        server.kill('SIGTERM')
        await closed
    }
    if (directory) await rm(directory, { recursive: true, force: true })
})

describe('docs video delivery', () => {
    it('serves bounded and suffix byte ranges for seeking', async () => {
        const bounded = await fetch(`${origin}/film.mp4`, { headers: { Range: 'bytes=2-5' } })
        expect(bounded.status).toBe(206)
        expect(bounded.headers.get('content-type')).toBe('video/mp4')
        expect(bounded.headers.get('content-range')).toBe('bytes 2-5/10')
        expect(await bounded.text()).toBe('2345')
        const suffix = await fetch(`${origin}/film.mp4`, { headers: { Range: 'bytes=-3' } })
        expect(suffix.status).toBe(206)
        expect(await suffix.text()).toBe('789')
    })

    it('returns matching HEAD metadata and rejects unsatisfiable ranges', async () => {
        const head = await fetch(`${origin}/film.mp4`, { method: 'HEAD', headers: { Range: 'bytes=4-' } })
        expect(head.status).toBe(206)
        expect(head.headers.get('content-length')).toBe('6')
        expect(await head.text()).toBe('')
        for (const range of ['bytes=10-', 'bytes=8-4', 'bytes=-0', 'bytes=0-1,4-5']) {
            const response = await fetch(`${origin}/film.mp4`, { headers: { Range: range } })
            expect(response.status).toBe(416)
            expect(response.headers.get('content-range')).toBe('bytes */10')
        }
    })
})
