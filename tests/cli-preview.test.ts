import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { request } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { startPreview, type PreviewHandle } from '../src/stage/preview/server'

const handles: PreviewHandle[] = []
const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()))
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const source = (title: string) => `import { film, text, write } from 'vizmatic/stage'
export default film({ title: ${JSON.stringify(title)} }, (s) => {
    s.play(write(s.add(text('Hello', { size: 64 }))))
})
`

function nextEvent(url: string, name: string, timeout = 20_000): Promise<{ data: unknown; close: () => void }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), timeout)
        const req = request(`${url}events`, (response) => {
            let buffer = ''
            response.on('data', (chunk) => {
                buffer += chunk
                const match = new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`).exec(buffer)
                if (match) {
                    clearTimeout(timer)
                    resolve({ data: JSON.parse(match[1]!), close: () => req.destroy() })
                }
            })
        })
        req.on('error', () => {})
        req.end()
    })
}

describe('vizmatic preview', () => {
    it('serves the page, engine, and film, and pushes rebuilds and build errors', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'vizmatic-preview-'))
        tempDirs.push(directory)
        const file = join(directory, 'intro.ts')
        await writeFile(file, source('First'))
        const preview = await startPreview({ file, port: 0 })
        handles.push(preview)
        expect(preview.port).not.toBe(4173)

        const page = await fetch(preview.url)
        expect(page.status).toBe(200)
        expect(await page.text()).toContain('intro.ts')
        const engine = await fetch(`${preview.url}stage/stage.js`)
        expect(engine.headers.get('content-type')).toContain('text/javascript')
        const font = await fetch(`${preview.url}stage/assets/fonts/Inter-Regular.ttf`)
        expect(font.status).toBe(200)
        const film = await (await fetch(`${preview.url}film.js`)).text()
        expect(film).toContain('First')
        // Films import the page's engine, because the engine's clock is module state.
        expect(film).toContain('/stage/stage.js')

        const first = await nextEvent(preview.url, 'build')
        const version = (first.data as { version: number }).version
        first.close()

        const rebuilt = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('The film did not rebuild.')), 20_000)
            const poll = async () => {
                const body = await (await fetch(`${preview.url}film.js`)).text()
                if (body.includes('Second')) {
                    clearTimeout(timer)
                    resolve()
                } else setTimeout(() => void poll(), 50)
            }
            void poll()
        })
        await writeFile(file, source('Second'))
        await rebuilt
        expect(version).toBeGreaterThan(0)

        await writeFile(file, 'export default film((')
        const failure = await new Promise<{ message: string }>((resolve, reject) => {
            const started = Date.now()
            const poll = async () => {
                try {
                    const event = await nextEvent(preview.url, 'build-error', 1_000)
                    event.close()
                    resolve(event.data as { message: string })
                } catch {
                    if (Date.now() - started > 20_000) reject(new Error('No build error arrived.'))
                    else void poll()
                }
            }
            void poll()
        })
        expect(failure.message).toContain('intro.ts')
    }, 60_000)

    it('serves the fonts beside the film, and no other file', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'vizmatic-preview-'))
        tempDirs.push(directory)
        await mkdir(join(directory, 'film', 'fonts'), { recursive: true })
        await copyFile(join(__dirname, 'fixtures', 'fonts', 'square.ttf'), join(directory, 'film', 'fonts', 'square.ttf'))
        await copyFile(join(__dirname, 'fixtures', 'fonts', 'square.ttf'), join(directory, 'outside.ttf'))
        await writeFile(join(directory, 'film', 'secret.txt'), 'secret')
        const file = join(directory, 'film', 'intro.ts')
        await writeFile(file, `import { film, registerFont, text } from 'vizmatic/stage'
registerFont('square', new URL('./fonts/square.ttf', import.meta.url))
export default film((s) => { s.add(text('A', { font: 'square' })); s.wait(1) })
`)
        const preview = await startPreview({ file, port: 0 })
        handles.push(preview)
        const film = await (await fetch(`${preview.url}film.js`)).text()
        // The page makes the address of the font from this expression.
        const address = /new URL\("\.\/fonts\/square\.ttf", (location\.origin \+ "([^"]+)")\)/.exec(film)![2]!
        const base = new URL(address, preview.url)
        const get = async (path: string) => fetch(new URL(path, base))
        const font = await get('./fonts/square.ttf')
        expect(font.status).toBe(200)
        expect(font.headers.get('content-type')).toBe('font/ttf')
        expect(new Uint8Array(await font.arrayBuffer())).toEqual(new Uint8Array(await readFile(join(directory, 'film', 'fonts', 'square.ttf'))))
        for (const path of ['./secret.txt', './intro.ts', '../outside.ttf', './fonts/none.ttf', './fonts/%2e%2e/%2e%2e/outside.ttf', './fonts/..%2f..%2foutside.ttf']) expect((await get(path)).status, path).toBe(404)
        // An edit of the font builds the film again, at an address that the page has not read.
        const next = nextEvent(preview.url, 'build')
        const first = await next
        first.close()
        await copyFile(join(__dirname, 'fixtures', 'fonts', 'square.ttf'), join(directory, 'film', 'fonts', 'square.ttf'))
        await expect.poll(async () => (await (await fetch(`${preview.url}film.js`)).text()).includes(address), { timeout: 10_000 }).toBe(false)
    }, 30_000)

    it('rejects requests that do not address this machine', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'vizmatic-preview-'))
        tempDirs.push(directory)
        const file = join(directory, 'intro.ts')
        await writeFile(file, source('Host'))
        const preview = await startPreview({ file, port: 0 })
        handles.push(preview)
        const status = await new Promise<number>((resolve, reject) => {
            const req = request({ host: '127.0.0.1', port: preview.port, path: '/', headers: { Host: 'attacker.example' } }, (response) => {
                response.resume()
                resolve(response.statusCode ?? 0)
            })
            req.on('error', reject)
            req.end()
        })
        expect(status).toBe(403)
    }, 30_000)

    it('explains a missing file', async () => {
        await expect(startPreview({ file: join(tmpdir(), 'no-such-film.ts') })).rejects.toThrow('Film file not found')
    })
})
