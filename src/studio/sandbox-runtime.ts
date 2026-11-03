/**
 * Runs inside the sandboxed iframe, on an opaque origin with no network access.
 * Hand-written film code executes here, so a shared link can never reach the
 * Studio's own origin, its storage, or anything else on the site.
 */
import * as stage from '../stage/index'
import { compileFilm, isFilm, setAssetBase, type CompiledFilm, type LookName } from '../stage/index'
import { exportFilm, ExportCancelled, type ExportSettings } from './export'
import { Transport } from './transport'

const ASSET_BASE = 'https://studio-assets.invalid/'

const post = (message: Record<string, unknown>, transfer: Transferable[] = []): void => {
    window.parent.postMessage(message, '*', transfer)
}

// The engine fetches fonts by URL. Here they arrive from the parent instead.
const assetWaiters = new Map<number, (bytes: ArrayBuffer | null) => void>()
let nextAsset = 1
const nativeFetch = window.fetch.bind(window)
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(ASSET_BASE)) return nativeFetch(input, init)
    const id = nextAsset++
    const bytes = await new Promise<ArrayBuffer | null>((resolve) => {
        assetWaiters.set(id, resolve)
        post({ t: 'asset-request', id, path: url.slice(ASSET_BASE.length) })
    })
    if (!bytes) return new Response(null, { status: 404 })
    return new Response(bytes, { status: 200, headers: { 'content-type': 'font/ttf' } })
}) as typeof window.fetch
setAssetBase(ASSET_BASE)

function describe(value: unknown): string {
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.message
    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}

for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
        original(...args)
        post({ t: 'log', level, text: args.map(describe).join(' ').slice(0, 4000) })
    }
}

const canvas = document.getElementById('film') as HTMLCanvasElement
const transport = new Transport(canvas, {
    onTime: (time) => post({ t: 'time', time }),
    onState: (playing) => post({ t: 'state', playing }),
})
let film: CompiledFilm | null = null
const exports_ = new Map<number, AbortController>()

function errorPosition(error: unknown): { line?: number; column?: number } {
    const stack = error instanceof Error ? error.stack ?? '' : ''
    const match = /film\.tsx:(\d+):(\d+)/.exec(stack)
    return match ? { line: Number(match[1]), column: Number(match[2]) } : {}
}

async function run(code: string, runId: number, look: LookName | null): Promise<void> {
    try {
        const module = { exports: {} as Record<string, unknown> }
        const require = (name: string) => {
            if (name === 'vizmatic/stage') return stage
            throw new Error(`Studio films can import from 'vizmatic/stage' only, not '${name}'.`)
        }
        // Everything stays on line 1 of the wrapper, so error lines match the editor.
        const wrapped = `(function (require, exports, module) {${code}\n})\n//# sourceURL=film.tsx`
        const factory = (0, eval)(wrapped) as (r: typeof require, e: unknown, m: unknown) => void
        factory(require, module.exports, module)
        const definition = module.exports['default']
        if (!isFilm(definition)) throw new Error("Export a film as the default export: export default film({ ... }, (s) => { ... })")
        const compiled = await compileFilm(definition, look ? { look } : {})
        film = compiled
        transport.setFilm(compiled)
        post({
            t: 'compiled', runId,
            info: {
                title: compiled.title, duration: compiled.duration, fps: compiled.fps,
                width: compiled.width, height: compiled.height, look: compiled.look.name,
                chapters: compiled.chapters, clips: compiled.clips, captions: compiled.captions,
            },
        })
    } catch (error) {
        post({ t: 'error', runId, message: describe(error), ...errorPosition(error) })
    }
}

async function runExport(id: number, settings: ExportSettings): Promise<void> {
    if (!film) {
        post({ t: 'export-error', id, message: 'Fix the errors in your film before exporting.' })
        return
    }
    const controller = new AbortController()
    exports_.set(id, controller)
    try {
        const result = await exportFilm(film, settings, {
            signal: controller.signal,
            onProgress: (progress) => post({ t: 'progress', id, ...progress }),
        })
        const bytes = result.bytes.slice().buffer as ArrayBuffer
        post({ t: 'exported', id, bytes, type: result.type, extension: result.extension, note: result.note }, [bytes])
    } catch (error) {
        post({ t: 'export-error', id, message: describe(error), cancelled: error instanceof ExportCancelled })
    } finally {
        exports_.delete(id)
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return
    const data = event.data as { t?: string } & Record<string, unknown>
    switch (data.t) {
        case 'run': void run(String(data['code']), Number(data['runId']), (data['look'] as LookName | null) ?? null); break
        case 'seek': transport.seek(Number(data['time'])); break
        case 'play': transport.play(); break
        case 'pause': transport.pause(); break
        case 'toggle': transport.toggle(); break
        case 'speed': transport.speed = Number(data['value']); break
        case 'loop': transport.loop = data['region'] as { from: number; to: number } | null; break
        case 'loop-all': transport.loopAll = Boolean(data['value']); break
        case 'preview': transport.previewRange(Number(data['from']), Number(data['to'])); break
        case 'export': void runExport(Number(data['id']), data['settings'] as ExportSettings); break
        case 'cancel': exports_.get(Number(data['id']))?.abort(); break
        case 'asset': {
            const waiter = assetWaiters.get(Number(data['id']))
            assetWaiters.delete(Number(data['id']))
            waiter?.((data['bytes'] as ArrayBuffer | null) ?? null)
            break
        }
    }
})

post({ t: 'ready' })
