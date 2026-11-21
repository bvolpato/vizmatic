import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Readable, Writable } from 'node:stream'

/** Control only browser lifetime and GPU discovery. Network tracing would copy every raw frame into CDP. */
export class GpuBrowser {
    private serial = 0
    private readonly calls = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
    private readonly input: Writable
    private readonly exited: Promise<void>
    private closed = false
    private failure: Error | undefined
    private closing: Promise<void> | undefined
    private stderr = ''

    private constructor(private readonly child: ChildProcess, private readonly directory: string, private readonly onFailure: (error: Error) => void) {
        this.input = child.stdio[3] as Writable
        const output = child.stdio[4] as Readable
        const decoder = new StringDecoder('utf8')
        let buffered = ''
        output.on('data', chunk => {
            buffered += decoder.write(chunk)
            if (buffered.length > 4 * 1024 * 1024) { this.fail(new Error('GPU browser control message is too large')); return }
            for (let end = buffered.indexOf('\0'); end >= 0; end = buffered.indexOf('\0')) {
                const message = buffered.slice(0, end)
                buffered = buffered.slice(end + 1)
                try {
                    const reply = JSON.parse(message) as { id?: number; result?: unknown; error?: { message: string }; method?: string }
                    const call = reply.id === undefined ? undefined : this.calls.get(reply.id)
                    if (call) {
                        this.calls.delete(reply.id!); clearTimeout(call.timer)
                        if (reply.error) call.reject(new Error(reply.error.message))
                        else call.resolve(reply.result)
                    } else if (reply.method === 'Target.targetCrashed') this.fail(new Error('The GPU rendering page crashed'))
                } catch { this.fail(new Error('Invalid GPU browser control message')) }
            }
        })
        this.input.on('error', error => this.fail(error))
        output.on('error', error => this.fail(error))
        child.stderr?.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4096) })
        this.exited = new Promise(resolve => {
            child.once('error', error => { this.fail(error); resolve() })
            child.once('close', code => {
                if (!this.closed) this.fail(new Error(`GPU browser exited (${code}): ${this.stderr.replace(/[\x00-\x1f\x7f]/g, ' ')}`))
                resolve()
            })
        })
    }

    static async launch(onFailure: (error: Error) => void, signal?: AbortSignal): Promise<GpuBrowser> {
        const executable = await findBrowser()
        if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
        const directory = await mkdtemp(join(tmpdir(), 'vizmatic-gpu-'))
        let browser: GpuBrowser | undefined
        try {
            if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
            const child = spawn(executable, [
                '--headless', '--enable-gpu', '--remote-debugging-pipe', `--user-data-dir=${directory}`,
                '--no-first-run', '--no-default-browser-check', '--no-startup-window', '--disable-extensions',
                '--disable-background-networking', '--disable-component-update', '--disable-dev-shm-usage',
                '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
            ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true })
            browser = new GpuBrowser(child, directory, onFailure)
            const abort = () => { void browser!.close() }
            signal?.addEventListener('abort', abort, { once: true })
            try {
                await browser.send('Browser.getVersion')
                if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
            } finally { signal?.removeEventListener('abort', abort) }
            return browser
        } catch (error) {
            if (browser) await browser.close()
            else await rm(directory, { recursive: true, force: true })
            if (signal?.aborted) throw new DOMException('The export was aborted', 'AbortError')
            throw error
        }
    }

    send<T = unknown>(method: string, params: object = {}): Promise<T> {
        if (this.failure) return Promise.reject(this.failure)
        if (this.closed) return Promise.reject(new Error('The GPU browser is closed'))
        const id = ++this.serial
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => { this.calls.delete(id); reject(new Error(`GPU browser command timed out: ${method}`)) }, 10_000)
            this.calls.set(id, { resolve: value => resolve(value as T), reject, timer })
            this.input.write(`${JSON.stringify({ id, method, params })}\0`, error => {
                if (error) { clearTimeout(timer); this.calls.delete(id); reject(error) }
            })
        })
    }

    private fail(error: Error): void {
        this.failure ??= error
        for (const call of this.calls.values()) { clearTimeout(call.timer); call.reject(error) }
        this.calls.clear()
        if (!this.closed) this.onFailure(error)
    }

    close(): Promise<void> {
        if (this.closing) return this.closing
        // Closing the pipe terminates a browser launched with --remote-debugging-pipe.
        this.closed = true
        this.fail(new Error('The GPU browser is closed'))
        this.input.end()
        const timer = setTimeout(() => this.child.kill('SIGKILL'), 3000)
        this.closing = this.exited.finally(async () => {
            clearTimeout(timer)
            await rm(this.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
        })
        return this.closing
    }
}

export async function findBrowser(): Promise<string> {
    const configured = process.env.VIZMATIC_BROWSER_EXECUTABLE_PATH
    const names = process.platform === 'win32' ? ['chrome.exe', 'msedge.exe', 'chromium.exe']
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
    const candidates = configured ? [configured] : [
        ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(directory => names.map(name => join(directory, name))),
        ...(process.platform === 'darwin' ? ['/Applications', join(homedir(), 'Applications')].flatMap(directory => [
            join(directory, 'Google Chrome.app/Contents/MacOS/Google Chrome'),
            join(directory, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
            join(directory, 'Chromium.app/Contents/MacOS/Chromium'),
        ]) : []),
        ...(process.platform === 'win32' ? [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
            .filter((directory): directory is string => !!directory).flatMap(directory => [
                join(directory, 'Google/Chrome/Application/chrome.exe'), join(directory, 'Microsoft/Edge/Application/msedge.exe'),
            ]) : []),
    ]
    for (const file of candidates) if (await access(file, constants.X_OK).then(() => true, () => false)) return file
    throw new Error('No Chrome, Edge, or Chromium executable was found. Set VIZMATIC_BROWSER_EXECUTABLE_PATH or use the CPU backend.')
}
