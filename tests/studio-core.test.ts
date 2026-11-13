import { transform } from 'sucrase'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as stage from '../src/stage/index'
import { compileFilm, film, frameToSvg, isFilm, rect, type CompiledFilm, type FilmDefinition } from '../src/stage/index'
import { defaultProps } from '../src/studio/catalog'
import { projectToSource } from '../src/studio/codegen'
import { compileProject } from '../src/studio/compile'
import { evenSize, FramePainter, type ExportProgress, type ExportSettings } from '../src/studio/export'
import { ExprError, exprProblem, parseExpr } from '../src/studio/expr'
import { emptyProject, type StudioObject, type StudioProject } from '../src/studio/model'
import { SandboxHost, type SandboxCallbacks } from '../src/studio/sandbox-host'
import { Store } from '../src/studio/store'
import { TEMPLATES } from '../src/studio/templates'
import { Transport } from '../src/studio/transport'

class StubPath2D {
    moveTo(): void {}
    lineTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
}

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

async function runGeneratedSource(source: string): Promise<CompiledFilm> {
    const { code } = transform(source, { transforms: ['typescript', 'imports'], production: true })
    const module = { exports: {} as { default?: FilmDefinition } }
    const require = (name: string) => {
        if (name === 'vizmatic/stage') return stage
        throw new Error(`Unexpected import: ${name}`)
    }
    new Function('require', 'exports', 'module', code)(require, module.exports, module)
    if (!isFilm(module.exports.default)) throw new Error('Expected default film export')
    return compileFilm(module.exports.default)
}

describe('Studio expression engine edge cases', () => {
    it('tracks allowed variables separately from built-in constants and supports custom JS variable renaming', () => {
        const expr = parseExpr('a * cos(2pi * x) + e', ['x', 'a'])
        expect([...expr.variables]).toEqual(['a', 'x'])
        const renamed = new Map([['a', 'v_a.get()'], ['x', 'v_x.get()']])
        expect(expr.js((v) => renamed.get(v) ?? v)).toBe('v_a.get() * Math.cos(2 * Math.PI * v_x.get()) + Math.E')
    })

    it('enforces arity, nesting depth, and expression length limits with ExprError positions', () => {
        expect(() => parseExpr('atan2(1)', [])).toThrowError(ExprError)
        expect(exprProblem('min(1)', [])).toMatch(/2 to 8/)
        expect(exprProblem('max(1,2,3,4,5,6,7,8,9)', [])).toMatch(/2 to 8/)
        expect(exprProblem('('.repeat(70) + '1' + ')'.repeat(70), [])).toMatch(/nests too deeply/)
        expect(exprProblem('1+'.repeat(1001) + '1', [])).toMatch(/too long/)
    })
})

describe('Studio Store notifications, selection pruning, and history limits', () => {
    it('notifies subscribers with exact change kinds and unsubscribes cleanly', () => {
        const store = new Store()
        const events: string[][] = []
        const unsubscribe = store.subscribe((kinds) => events.push([...kinds].sort()))

        store.commit((draft) => {
            draft.objects.push({
                id: 'obj-1', kind: 'rect', name: 'Box', x: 0, y: 0,
                rotation: 0, scale: 1, opacity: 1, hidden: false, locked: false, props: defaultProps('rect'),
            })
            draft.beats.push({ id: 'beat-1', target: 'obj-1', kind: 'fadeIn', start: 0, duration: 1, ease: 'smooth', params: {} })
        })
        store.select(['obj-1'], 'beat-1')
        store.select(['obj-1'], 'beat-1') // duplicate selection is a no-op
        expect(events).toEqual([['history', 'project'], ['selection']])

        // Removing the beat prunes selectedBeat automatically.
        store.commit((draft) => {
            draft.beats = []
        })
        expect(store.selectedBeat).toBeNull()
        expect(store.selection).toEqual(['obj-1'])

        unsubscribe()
        store.commit((draft) => { draft.name = 'After unsubscribe' })
        expect(events).toHaveLength(3)
    })

    it('caps undo history at 200 snapshots', () => {
        const store = new Store()
        store.load(emptyProject('step-0'))
        for (let i = 1; i <= 210; i++) {
            store.commit((draft) => { draft.name = `step-${i}` })
        }
        let undoCount = 0
        while (store.canUndo) {
            store.undo()
            undoCount++
        }
        expect(undoCount).toBe(200)
        expect(store.project.name).toBe('step-10')
    })
})

describe('Studio codegen for all templates and tricky identifiers', () => {
    it.each(TEMPLATES.map((t) => [t.id, t] as const))('generates executable TSX matching live frames for template %s', async (_, template) => {
        const project = template.project()
        const live = await compileProject(project)
        const source = projectToSource(project)
        const fromCode = await runGeneratedSource(source)

        expect(fromCode.duration).toBeCloseTo(live.film.duration, 5)
        expect(fromCode.chapters).toEqual(live.film.chapters)
        expect(frameToSvg(fromCode.frame(template.thumb))).toBe(frameToSvg(live.film.frame(template.thumb)))
    })

    it('deduplicates reserved words, stage imports, and leading digits in variable and object names', async () => {
        const obj = (id: string, name: string): StudioObject => ({
            id, kind: 'rect', name, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
            hidden: false, locked: false, props: defaultProps('rect'),
        })
        const project: StudioProject = {
            ...emptyProject('Identifiers'),
            variables: [{ name: 'class', value: 2 }, { name: '123rate', value: 4 }],
            objects: [obj('a', 'film'), obj('b', 'film'), obj('c', '99 bottles'), obj('d', '   ')],
        }
        const source = projectToSource(project)
        const compiled = await runGeneratedSource(source)
        expect(compiled.frame(0).ops.length).toBeGreaterThan(0)
    })
})

describe('Studio Transport playback, loop regions, and previewRange', () => {
    it('clamps seeks, loops regions, and returns to returnTo after previewRange completes', async () => {
        const rafCallbacks: Array<(now: number) => void> = []
        let nowMs = 1000
        vi.stubGlobal('window', { devicePixelRatio: 1 })
        vi.stubGlobal('Path2D', StubPath2D)
        vi.stubGlobal('performance', { now: () => nowMs })
        vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
            rafCallbacks.push(cb)
            return rafCallbacks.length
        })
        vi.stubGlobal('cancelAnimationFrame', vi.fn())

        const ctxStub = {
            globalAlpha: 1,
            globalCompositeOperation: 'source-over',
            fillStyle: '#000',
            strokeStyle: '#000',
            setTransform: vi.fn(),
            transform: vi.fn(),
            clearRect: vi.fn(),
            fillRect: vi.fn(),
            fill: vi.fn(),
            stroke: vi.fn(),
            setLineDash: vi.fn(),
            save: vi.fn(),
            restore: vi.fn(),
        }
        const canvasStub = {
            width: 320,
            height: 180,
            clientWidth: 320,
            clientHeight: 180,
            getBoundingClientRect: () => ({ width: 320, height: 180 }),
            getContext: () => ctxStub,
        }

        const compiled = await compileFilm(film({ bloom: 0 }, (s) => {
            s.add(rect(40, 40, { fill: 'blue' }))
            s.wait(4)
        }))
        const times: number[] = []
        const states: boolean[] = []
        const transport = new Transport(canvasStub as unknown as HTMLCanvasElement, {
            onTime: (t) => times.push(t),
            onState: (playing) => states.push(playing),
        })

        try {
            transport.setFilm(compiled)
            transport.seek(99)
            expect(transport.time).toBe(4)
            transport.seek(-5)
            expect(transport.time).toBe(0)

            // Preview range [1.0, 1.05] returning to 1.0
            transport.previewRange(1.0, 1.05, 1.0)
            expect(transport.playing).toBe(true)
            nowMs += 80
            rafCallbacks.pop()!(nowMs)
            expect(transport.playing).toBe(false)
            expect(transport.time).toBe(1.0)

            // Loop region [0.5, 0.6] wraps around instead of stopping
            transport.loop = { from: 0.5, to: 0.6 }
            transport.seek(0.55)
            transport.play()
            nowMs += 80
            rafCallbacks.pop()!(nowMs)
            expect(transport.playing).toBe(true)
            expect(transport.time).toBeGreaterThanOrEqual(0.5)
            expect(transport.time).toBeLessThan(0.6)
            expect(states).toContain(true)
            expect(times.length).toBeGreaterThan(0)
        } finally {
            transport.destroy()
        }
    })
})

describe('Studio export evenSize and FramePainter motionBlur', () => {
    it('computes even pixel dimensions preserving aspect ratio', () => {
        expect(evenSize({ width: 1920, height: 1080 }, 1280)).toEqual({ width: 1280, height: 720 })
        const odd = evenSize({ width: 1000, height: 777 }, 301)
        expect(odd.width % 2).toBe(0)
        expect(odd.height % 2).toBe(0)
        expect(evenSize({ width: 1920, height: 1080 }, 4).width).toBeGreaterThanOrEqual(16)
    })

    it('clears accumulate canvas, attenuates transparent subframes, and applies bloom once after averaging', async () => {
        const recordOps = (label: string) => {
            const log: string[] = []
            const ctx = {
                globalAlpha: 1,
                globalCompositeOperation: 'source-over',
                filter: 'none',
                fillStyle: '#000',
                strokeStyle: '#000',
                lineWidth: 1,
                setTransform: vi.fn(),
                save: vi.fn(),
                restore: vi.fn(),
                transform: vi.fn(),
                beginPath: vi.fn(),
                moveTo: vi.fn(),
                lineTo: vi.fn(),
                bezierCurveTo: vi.fn(),
                closePath: vi.fn(),
                fill: vi.fn(),
                stroke: vi.fn(),
                setLineDash: vi.fn(),
                clearRect: vi.fn(() => log.push(`${label}:clearRect`)),
                fillRect: vi.fn(() => log.push(`${label}:fillRect:${ctx.globalCompositeOperation}:${ctx.globalAlpha.toFixed(2)}`)),
                drawImage: vi.fn(() => log.push(`${label}:drawImage:${ctx.globalCompositeOperation}:${ctx.globalAlpha.toFixed(2)}`)),
            }
            return {
                canvas: {
                    width: 320,
                    height: 180,
                    clientWidth: 320,
                    clientHeight: 180,
                    getBoundingClientRect: () => ({ width: 320, height: 180 }),
                    getContext: () => ctx,
                },
                log,
            }
        }

        const canvases: ReturnType<typeof recordOps>[] = []
        vi.stubGlobal('window', { devicePixelRatio: 1 })
        vi.stubGlobal('Path2D', StubPath2D)
        vi.stubGlobal('document', {
            createElement: () => {
                const entry = recordOps(`c${canvases.length}`)
                canvases.push(entry)
                return entry.canvas
            },
        })

        const transparentFilm = await compileFilm(film({ width: 320, height: 180, background: 'transparent', bloom: 0.8 }, (s) => {
            s.add(rect(40, 40, { fill: '#ffffff' }))
            s.wait(1)
        }))

        const painter = new FramePainter(transparentFilm, 320, 180, 3)
        try {
            const playerCanvas = canvases[0]!
            const accumulate = canvases[1]!
            await painter.paint(0, 30)
            await painter.paint(0.5, 30)

            // Player canvas should NOT run per-subframe bloom when blur > 1 (only c0 clearRect + path draws).
            expect(playerCanvas.log.some((entry) => entry.includes('screen'))).toBe(false)

            // Accumulate canvas clears before EVERY frame, averages 3 subframes via destination-in + lighter, then runs post-average screen bloom once per frame.
            const clears = accumulate.log.filter((entry) => entry === 'c1:clearRect')
            expect(clears).toHaveLength(2)
            expect(accumulate.log).toContain('c1:drawImage:source-over:1.00')
            expect(accumulate.log).toContain('c1:fillRect:destination-in:0.50')
            expect(accumulate.log).toContain('c1:drawImage:lighter:0.50')
            expect(accumulate.log).toContain('c1:fillRect:destination-in:0.67')
            expect(accumulate.log).toContain('c1:drawImage:lighter:0.33')
            // 3 bloom layers * 2 frames = 6 screen composites on accumulate
            expect(accumulate.log.filter((entry) => entry.startsWith('c1:drawImage:screen:'))).toHaveLength(6)
        } finally {
            painter.destroy()
        }
    })
})

describe('Studio SandboxHost iframe isolation and message protocol', () => {
    it('mounts sandbox="allow-scripts" iframe, enforces font-only asset paths, and handles export lifecycle', async () => {
        const sentMessages: Array<Record<string, unknown>> = []
        const contentWindow = {
            postMessage: vi.fn((msg: Record<string, unknown>) => sentMessages.push(msg)),
        }
        let messageHandler: ((event: MessageEvent) => void) | null = null

        const iframeStub = {
            className: '',
            srcdoc: '',
            attributes: new Map<string, string>(),
            contentWindow,
            setAttribute(name: string, value: string) { this.attributes.set(name, value) },
            remove: vi.fn(),
        }
        const containerStub = {
            appendChild: vi.fn(),
        }

        vi.stubGlobal('window', {
            addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
                if (type === 'message') messageHandler = handler
            }),
            removeEventListener: vi.fn(),
        })
        vi.stubGlobal('document', {
            createElement: (tag: string) => {
                expect(tag).toBe('iframe')
                return iframeStub
            },
        })
        vi.stubGlobal('fetch', vi.fn(async (input: URL | string) => {
            const href = String(input)
            if (href.endsWith('sandbox-runtime.js')) {
                return { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/javascript' }), text: async () => '/*runtime*/' }
            }
            if (href.endsWith('fonts/Inter-Regular.ttf')) {
                const buf = new Uint8Array([1, 2, 3, 4]).buffer
                return { ok: true, status: 200, headers: new Headers({ 'content-type': 'font/ttf' }), arrayBuffer: async () => buf }
            }
            return { ok: false, status: 404, headers: new Headers({ 'content-type': 'text/html' }), arrayBuffer: async () => new ArrayBuffer(0) }
        }))

        const errors: string[] = []
        const callbacks: SandboxCallbacks = {
            onCompiled: vi.fn(),
            onError: (err) => errors.push(err.message),
            onTime: vi.fn(),
            onState: vi.fn(),
            onLog: vi.fn(),
        }

        const host = new SandboxHost(containerStub as unknown as HTMLElement, 'https://studio-host.invalid/app/', 'https://studio-host.invalid/assets/', callbacks)
        expect(iframeStub.attributes.get('sandbox')).toBe('allow-scripts')
        expect(iframeStub.srcdoc).toContain("default-src 'none'")

        // Queue a run before ready, then boot and mark ready
        host.run('export default film({}, () => {})', 'midnight')
        expect(sentMessages).toHaveLength(0)

        messageHandler!({ source: contentWindow, data: { t: 'boot-ready' } } as unknown as MessageEvent)
        await new Promise((r) => setTimeout(r, 10))
        expect(sentMessages[0]).toEqual({ t: 'boot', runtime: '/*runtime*/' })

        messageHandler!({ source: contentWindow, data: { t: 'ready' } } as unknown as MessageEvent)
        expect(sentMessages[1]).toMatchObject({ t: 'run', runId: 1, look: 'midnight' })

        // Disallowed path traversal asset request gets null bytes without fetching
        messageHandler!({ source: contentWindow, data: { t: 'asset-request', id: 7, path: '../secrets.json' } } as unknown as MessageEvent)
        await new Promise((r) => setTimeout(r, 5))
        expect(sentMessages.at(-1)).toEqual({ t: 'asset', id: 7, bytes: null })

        // Allowed font request transfers ArrayBuffer
        messageHandler!({ source: contentWindow, data: { t: 'asset-request', id: 8, path: 'fonts/Inter-Regular.ttf' } } as unknown as MessageEvent)
        await new Promise((r) => setTimeout(r, 5))
        expect(sentMessages.at(-1)).toMatchObject({ t: 'asset', id: 8 })
        expect((sentMessages.at(-1)?.bytes as ArrayBuffer).byteLength).toBe(4)

        // Export progress + completion
        const progresses: ExportProgress[] = []
        const abort = new AbortController()
        const settings: ExportSettings = { format: 'mp4', width: 1280, fps: 30, quality: 'standard', motionBlur: 1, from: 0, to: 1, time: 0 }
        const exportPromise = host.exportFilm(settings, { signal: abort.signal, onProgress: (p) => progresses.push(p) })
        messageHandler!({ source: contentWindow, data: { t: 'progress', id: 1, done: 15, total: 30, stage: 'Encoding' } } as unknown as MessageEvent)
        const outBuf = new Uint8Array([9, 8, 7]).buffer
        messageHandler!({ source: contentWindow, data: { t: 'exported', id: 1, bytes: outBuf, type: 'video/mp4', extension: 'mp4!', note: 'H.264' } } as unknown as MessageEvent)

        const exported = await exportPromise
        expect(progresses).toEqual([{ done: 15, total: 30, stage: 'Encoding' }])
        expect(exported.extension).toBe('mp4')
        expect([...exported.bytes]).toEqual([9, 8, 7])
        expect(errors).toEqual([])

        // Destroy rejects any still-pending export
        const pendingDestroy = host.exportFilm(settings, {})
        host.destroy()
        await expect(pendingDestroy).rejects.toThrow(/closed/)
        expect(iframeStub.remove).toHaveBeenCalled()
    })
})
