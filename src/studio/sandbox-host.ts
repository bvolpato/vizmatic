import type { LookName } from '../stage/index'
import type { Caption, Chapter, Clip } from '../stage/index'
import type { ExportProgress, ExportResult, ExportSettings } from './export'

export interface SandboxInfo {
    title: string
    duration: number
    fps: number
    width: number
    height: number
    look: string
    chapters: Chapter[]
    clips: Clip[]
    captions: Caption[]
}

export interface SandboxCallbacks {
    onCompiled: (info: SandboxInfo) => void
    onError: (error: { message: string; line?: number; column?: number }) => void
    onTime: (time: number) => void
    onState: (playing: boolean) => void
    onLog: (level: string, text: string) => void
}

/**
 * The page inside the sandbox. It has no network access: scripts are inline, and
 * the content security policy blocks every fetch, image, and connection.
 */
const FRAME_DOCUMENT = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:">
<style>html,body{margin:0;height:100%;background:#0b0c10;overflow:hidden}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id="film"></canvas><script>
window.addEventListener('message', function boot(event) {
  if (event.source !== window.parent || !event.data || event.data.t !== 'boot') return;
  window.removeEventListener('message', boot);
  (0, eval)(event.data.runtime);
});
window.parent.postMessage({ t: 'boot-ready' }, '*');
</script></body></html>`

const FONT_PATH = /^fonts\/[A-Za-z0-9-]+\.ttf$/

let runtimeSource: Promise<string> | null = null

function loadRuntime(baseUrl: string): Promise<string> {
    runtimeSource ??= fetch(new URL('sandbox-runtime.js', baseUrl)).then((response) => {
        if (!response.ok) throw new Error(`Could not load the sandbox runtime: HTTP ${response.status}`)
        return response.text()
    })
    return runtimeSource
}

interface PendingExport {
    resolve: (result: ExportResult) => void
    reject: (error: Error) => void
    onProgress?: (progress: ExportProgress) => void
}

/** Runs and controls a hand-written film inside a sandboxed iframe. */
export class SandboxHost {
    readonly frame: HTMLIFrameElement
    time = 0
    playing = false
    duration = 0
    chapters: Chapter[] = []
    private ready = false
    private runId = 0
    private queued: (() => void) | null = null
    private exportId = 0
    private readonly exports = new Map<number, PendingExport>()
    private readonly listener: (event: MessageEvent) => void

    constructor(container: HTMLElement, private readonly baseUrl: string, private readonly fontBase: string, private readonly callbacks: SandboxCallbacks) {
        this.frame = document.createElement('iframe')
        // allow-scripts without allow-same-origin gives an opaque origin: no cookies,
        // no storage, and no access to this page. Nothing else is granted.
        this.frame.setAttribute('sandbox', 'allow-scripts')
        this.frame.setAttribute('title', 'Film preview, running in a sandbox')
        this.frame.className = 'sandbox-frame'
        this.frame.srcdoc = FRAME_DOCUMENT
        this.listener = (event) => this.onMessage(event)
        window.addEventListener('message', this.listener)
        container.appendChild(this.frame)
    }

    private send(message: Record<string, unknown>, transfer: Transferable[] = []): void {
        this.frame.contentWindow?.postMessage(message, '*', transfer)
    }

    private onMessage(event: MessageEvent): void {
        // Messages from the frame are untrusted input, the same as anything it computes.
        if (event.source !== this.frame.contentWindow) return
        const data = event.data as { t?: unknown } & Record<string, unknown>
        if (!data || typeof data !== 'object') return
        switch (data.t) {
            case 'boot-ready':
                void loadRuntime(this.baseUrl).then((runtime) => this.send({ t: 'boot', runtime }))
                break
            case 'ready':
                this.ready = true
                this.queued?.()
                this.queued = null
                break
            case 'compiled':
                if (data['runId'] === this.runId) {
                    const info = data['info'] as SandboxInfo
                    this.duration = Number(info.duration) || 0
                    this.chapters = Array.isArray(info.chapters) ? info.chapters : []
                    this.callbacks.onCompiled(info)
                }
                break
            case 'error':
                if (data['runId'] === this.runId) {
                    this.callbacks.onError({
                        message: String(data['message']).slice(0, 2000),
                        line: typeof data['line'] === 'number' ? data['line'] : undefined,
                        column: typeof data['column'] === 'number' ? data['column'] : undefined,
                    })
                }
                break
            case 'time':
                this.time = Number(data['time']) || 0
                this.callbacks.onTime(this.time)
                break
            case 'state':
                this.playing = data['playing'] === true
                this.callbacks.onState(this.playing)
                break
            case 'log':
                this.callbacks.onLog(String(data['level']), String(data['text']).slice(0, 4000))
                break
            case 'asset-request':
                void this.sendAsset(Number(data['id']), String(data['path']))
                break
            case 'progress': {
                const pending = this.exports.get(Number(data['id']))
                pending?.onProgress?.({ done: Number(data['done']), total: Number(data['total']), stage: String(data['stage']) })
                break
            }
            case 'exported': {
                const pending = this.exports.get(Number(data['id']))
                this.exports.delete(Number(data['id']))
                if (pending && data['bytes'] instanceof ArrayBuffer) {
                    pending.resolve({
                        bytes: new Uint8Array(data['bytes']),
                        type: String(data['type']), extension: String(data['extension']).replace(/[^a-z0-9]/g, ''), note: String(data['note']).slice(0, 400),
                    })
                }
                break
            }
            case 'export-error': {
                const pending = this.exports.get(Number(data['id']))
                this.exports.delete(Number(data['id']))
                if (pending) {
                    const error = new Error(String(data['message']).slice(0, 1000))
                    if (data['cancelled'] === true) error.name = 'ExportCancelled'
                    pending.reject(error)
                }
                break
            }
        }
    }

    private async sendAsset(id: number, path: string): Promise<void> {
        // Only fonts cross the boundary, whatever the film asks for.
        if (!FONT_PATH.test(path)) {
            this.send({ t: 'asset', id, bytes: null })
            return
        }
        try {
            const response = await fetch(new URL(path, this.fontBase))
            const type = response.headers.get('content-type') ?? ''
            if (!response.ok || type.includes('text/html')) throw new Error(`HTTP ${response.status}`)
            const bytes = await response.arrayBuffer()
            this.send({ t: 'asset', id, bytes }, [bytes])
        } catch {
            this.send({ t: 'asset', id, bytes: null })
        }
    }

    run(code: string, look: LookName | null): void {
        this.runId += 1
        const message = { t: 'run', code, runId: this.runId, look }
        if (this.ready) this.send(message)
        else this.queued = () => this.send(message)
    }

    seek(time: number): void {
        this.time = time
        this.send({ t: 'seek', time })
    }
    play(): void {
        this.send({ t: 'play' })
    }
    pause(): void {
        this.send({ t: 'pause' })
    }
    toggle(): void {
        this.send({ t: 'toggle' })
    }
    setSpeed(value: number): void {
        this.send({ t: 'speed', value })
    }
    setLoop(region: { from: number; to: number } | null): void {
        this.send({ t: 'loop', region })
    }
    setLoopAll(value: boolean): void {
        this.send({ t: 'loop-all', value })
    }
    previewRange(from: number, to: number): void {
        this.send({ t: 'preview', from, to })
    }

    exportFilm(settings: ExportSettings, control: { signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void }): Promise<ExportResult> {
        const id = ++this.exportId
        control.signal?.addEventListener('abort', () => this.send({ t: 'cancel', id }), { once: true })
        return new Promise((resolve, reject) => {
            this.exports.set(id, { resolve, reject, onProgress: control.onProgress })
            this.send({ t: 'export', id, settings })
        })
    }

    destroy(): void {
        window.removeEventListener('message', this.listener)
        for (const pending of this.exports.values()) pending.reject(new Error('The film preview closed.'))
        this.exports.clear()
        this.frame.remove()
    }
}
