import {
    getPlaygroundHashSource,
    setPlaygroundHashSource,
    type PlaygroundTheme,
} from './playground-source'
import { findPlaygroundTemplate, playgroundTemplates } from './playground-templates'
import type { PlaygroundRenderRequest } from './playground-worker'

interface PlaygroundRenderSuccess {
    id: number
    ok: true
    svg: string
    png: ArrayBuffer
    width: number
    height: number
    warnings: string[]
}

interface PlaygroundRenderFailure {
    id: number
    ok: false
    error: string
}

type PlaygroundRenderResponse = PlaygroundRenderSuccess | PlaygroundRenderFailure

interface PlaygroundRenderInput extends Omit<PlaygroundRenderRequest, 'id'> {}

const RENDER_TIMEOUT_MS = 4_000
const INITIAL_RENDER_TIMEOUT_MS = 12_000
const LIVE_PREVIEW_DELAY_MS = 350

class SupersededRenderError extends Error {
    constructor() {
        super('Preview superseded by a newer edit.')
    }
}

class PlaygroundRenderer {
    private worker: Worker | undefined
    private pending: {
        id: number
        reject: (reason: unknown) => void
        resolve: (value: PlaygroundRenderSuccess) => void
        timeout: number
    } | undefined
    private nextId = 1
    private hasRendered = false

    render(input: PlaygroundRenderInput): Promise<PlaygroundRenderSuccess> {
        if (this.pending) this.restart(new SupersededRenderError())

        const worker = this.worker ?? this.createWorker()
        const id = this.nextId++
        return new Promise((resolve, reject) => {
            const timeoutMs = this.hasRendered ? RENDER_TIMEOUT_MS : INITIAL_RENDER_TIMEOUT_MS
            const timeout = window.setTimeout(() => {
                this.restart(new Error(`Preview timed out after ${timeoutMs / 1_000} seconds. Worker restarted.`))
            }, timeoutMs)
            this.pending = { id, resolve, reject, timeout }
            worker.postMessage({ ...input, id } satisfies PlaygroundRenderRequest)
        })
    }

    dispose(): void {
        this.restart(new SupersededRenderError())
    }

    private createWorker(): Worker {
        const worker = new Worker(new URL('playground-worker.js', document.baseURI))
        worker.onmessage = (event: MessageEvent<PlaygroundRenderResponse>) => this.onMessage(event.data)
        worker.onerror = (event) => {
            event.preventDefault()
            this.restart(new Error(event.message || 'Playground worker failed.'))
        }
        this.worker = worker
        return worker
    }

    private onMessage(response: PlaygroundRenderResponse): void {
        if (!this.pending || response.id !== this.pending.id) return
        const pending = this.pending
        this.pending = undefined
        window.clearTimeout(pending.timeout)
        if (response.ok) {
            this.hasRendered = true
            pending.resolve(response)
        } else pending.reject(new Error(response.error))
    }

    private restart(reason: Error): void {
        this.worker?.terminate()
        this.worker = undefined
        this.hasRendered = false
        if (!this.pending) return

        const pending = this.pending
        this.pending = undefined
        window.clearTimeout(pending.timeout)
        pending.reject(reason)
    }
}

interface PlaygroundElements {
    source: HTMLTextAreaElement
    preview: HTMLElement
    root: HTMLElement
    status?: HTMLElement
    error?: HTMLElement
    viewport?: HTMLElement
    dimensions?: HTMLElement
    width?: HTMLElement
    height?: HTMLElement
    templateSelect?: HTMLSelectElement
    run?: HTMLElement
    share?: HTMLElement
    pngDownload?: HTMLElement
    svgDownload?: HTMLElement
}

function findElement<T extends HTMLElement>(root: HTMLElement, selector: string): T | undefined {
    return root.querySelector<T>(selector) ?? document.querySelector<T>(selector) ?? undefined
}

function findElements<T extends HTMLElement>(root: HTMLElement, selector: string): T[] {
    return [...new Set([...root.querySelectorAll<T>(selector), ...document.querySelectorAll<T>(selector)])]
}

function requiredElements(root: HTMLElement): PlaygroundElements | undefined {
    const source = findElement<HTMLTextAreaElement>(root, '#playgroundSource, #vizmatic-playground-source, [data-vizmatic-playground-source]')
    const preview = findElement<HTMLElement>(root, '#playgroundCanvas, #vizmatic-playground-preview, [data-vizmatic-playground-preview]')
    if (!source || !preview) return undefined

    return {
        root,
        source,
        preview,
        status: findElement(root, '#playgroundStatus, #vizmatic-playground-status, [data-vizmatic-playground-status]'),
        error: findElement(root, '#playgroundError, #vizmatic-playground-error, [data-vizmatic-playground-error]'),
        viewport: findElement(root, '#playgroundViewport, #vizmatic-playground-viewport, [data-vizmatic-playground-viewport]'),
        dimensions: findElement(root, '#playgroundDimensions, #vizmatic-playground-dimensions, [data-vizmatic-playground-dimensions]'),
        width: findElement(root, '#vizmatic-playground-width, [data-vizmatic-playground-width]'),
        height: findElement(root, '#vizmatic-playground-height, [data-vizmatic-playground-height]'),
        templateSelect: findElement<HTMLSelectElement>(root, '#playgroundTemplate, select[data-vizmatic-playground-template]'),
        run: findElement(root, '#playgroundRunButton, #vizmatic-playground-run, [data-vizmatic-playground-run]'),
        share: findElement(root, '#playgroundShareButton, #vizmatic-playground-share, [data-vizmatic-playground-share]'),
        pngDownload: findElement(root, '#playgroundPngButton, #vizmatic-playground-download-png, [data-vizmatic-playground-download="png"]'),
        svgDownload: findElement(root, '#playgroundSvgButton, #vizmatic-playground-download-svg, [data-vizmatic-playground-download="svg"]'),
    }
}

function getTheme(root: HTMLElement): PlaygroundTheme {
    if (root.dataset.vizmaticPlaygroundTheme === 'light') return 'light'
    const active = findElements<HTMLElement>(root, '[data-playground-theme], [data-vizmatic-theme]')
        .find((control) => control.getAttribute('aria-pressed') === 'true')
    return active?.dataset.playgroundTheme === 'light' || active?.dataset.vizmaticTheme === 'light' ? 'light' : 'dark'
}

function getBackground(root: HTMLElement): string | undefined {
    const background = root.dataset.vizmaticPlaygroundBackground
    return background && background !== 'transparent' ? background : undefined
}

function setStatus(elements: PlaygroundElements, state: 'error' | 'loading' | 'ready', message: string): void {
    elements.status?.setAttribute('data-state', state)
    if (elements.status) elements.status.textContent = message
    if (elements.viewport) elements.viewport.dataset.state = state
}

function setError(elements: PlaygroundElements, message: string | undefined): void {
    if (!elements.error) return
    elements.error.hidden = !message
    elements.error.textContent = message ?? ''
}

function setControlEnabled(control: HTMLElement | undefined, enabled: boolean): void {
    if (!control) return
    if (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) control.disabled = !enabled
    control.setAttribute('aria-disabled', String(!enabled))
}

function download(filename: string, content: BlobPart, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function renderPreview(preview: HTMLElement, svg: string, width: number, height: number): void {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const image = document.createElement('img')
    image.src = url
    image.alt = `Vizmatic preview, ${width} by ${height}`
    image.width = width
    image.height = height
    image.addEventListener('load', () => URL.revokeObjectURL(url), { once: true })
    preview.replaceChildren(image)
}

function syncThemeControls(root: HTMLElement, theme: PlaygroundTheme): void {
    root.dataset.vizmaticPlaygroundTheme = theme
    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-playground-theme]')) {
        if (control instanceof HTMLSelectElement || control instanceof HTMLInputElement) control.value = theme
    }
    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-theme], [data-playground-theme]')) {
        const controlTheme = control.dataset.vizmaticTheme ?? control.dataset.playgroundTheme
        control.setAttribute('aria-pressed', String(controlTheme === theme))
    }
}

function populateTemplateSelect(select: HTMLSelectElement): void {
    const selected = select.value
    select.replaceChildren(...playgroundTemplates.map((template) => {
        const option = document.createElement('option')
        option.value = template.id
        option.textContent = template.label
        return option
    }))
    select.value = findPlaygroundTemplate(selected)?.id ?? playgroundTemplates[0]?.id ?? ''
}

export function mountPlayground(root: HTMLElement): void {
    if (root.dataset.vizmaticPlaygroundMounted === 'true') return
    const elements = requiredElements(root)
    if (!elements) return
    root.dataset.vizmaticPlaygroundMounted = 'true'

    const renderer = new PlaygroundRenderer()
    const hashSource = getPlaygroundHashSource()
    if (elements.templateSelect) populateTemplateSelect(elements.templateSelect)
    if (hashSource) elements.source.value = hashSource
    if (!elements.source.value.trim()) {
        elements.source.value = findPlaygroundTemplate(elements.templateSelect?.value)?.source ?? playgroundTemplates[0]?.source ?? ''
    }

    let renderTimer: number | undefined
    let png: ArrayBuffer | undefined
    let svg: string | undefined
    let theme = getTheme(root)
    let sharedSourcePending = false

    const loadSharedSource = (source: string) => {
        sharedSourcePending = true
        elements.source.value = source
        png = undefined
        svg = undefined
        elements.preview.replaceChildren()
        setControlEnabled(elements.pngDownload, false)
        setControlEnabled(elements.svgDownload, false)
        setError(elements, undefined)
        setStatus(elements, 'ready', 'Shared source loaded. Run to preview.')
    }

    const scheduleRender = (immediate = false) => {
        if (renderTimer) window.clearTimeout(renderTimer)
        renderTimer = window.setTimeout(() => {
            renderTimer = undefined
            void render()
        }, immediate ? 0 : LIVE_PREVIEW_DELAY_MS)
    }

    const render = async () => {
        const source = elements.source.value
        setControlEnabled(elements.pngDownload, false)
        setControlEnabled(elements.svgDownload, false)
        setStatus(elements, 'loading', 'Rendering locally…')
        setError(elements, undefined)
        try {
            const output = await renderer.render({
                source,
                theme,
                background: getBackground(root),
            })
            png = output.png
            svg = output.svg
            renderPreview(elements.preview, output.svg, output.width, output.height)
            if (elements.dimensions) elements.dimensions.textContent = `${output.width} × ${output.height}`
            if (elements.width) elements.width.textContent = String(output.width)
            if (elements.height) elements.height.textContent = String(output.height)
            setControlEnabled(elements.pngDownload, true)
            setControlEnabled(elements.svgDownload, true)
            setStatus(elements, 'ready', output.warnings[0] ?? `Ready · ${output.width}×${output.height}`)
        } catch (error) {
            if (error instanceof SupersededRenderError) return
            png = undefined
            svg = undefined
            const message = error instanceof Error ? error.message : String(error)
            setStatus(elements, 'error', 'Error')
            setError(elements, message)
        }
    }

    elements.source.addEventListener('input', () => {
        sharedSourcePending = false
        scheduleRender()
    })
    elements.run?.addEventListener('click', (event) => {
        event.preventDefault()
        sharedSourcePending = false
        scheduleRender(true)
    })
    elements.pngDownload?.addEventListener('click', (event) => {
        event.preventDefault()
        if (png) download('vizmatic.png', png, 'image/png')
    })
    elements.svgDownload?.addEventListener('click', (event) => {
        event.preventDefault()
        if (svg) download('vizmatic.svg', svg, 'image/svg+xml')
    })
    elements.share?.addEventListener('click', (event) => {
        event.preventDefault()
        setPlaygroundHashSource(elements.source.value)
        const shareUrl = window.location.href
        if (!navigator.clipboard) {
            setStatus(elements, 'ready', 'Share link ready in address bar.')
            return
        }
        void navigator.clipboard.writeText(shareUrl)
            .then(() => setStatus(elements, 'ready', 'Share link copied.'))
            .catch(() => setStatus(elements, 'ready', 'Share link ready in address bar.'))
    })

    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-playground-template]')) {
        control.addEventListener('click', () => {
            const template = findPlaygroundTemplate(control.dataset.vizmaticPlaygroundTemplate)
            if (!template) return
            sharedSourcePending = false
            elements.source.value = template.source
            scheduleRender(true)
        })
    }
    for (const control of findElements<HTMLSelectElement>(root, '#playgroundTemplate, select[data-vizmatic-playground-template]')) {
        control.addEventListener('change', () => {
            const template = findPlaygroundTemplate(control.value)
            if (!template) return
            sharedSourcePending = false
            elements.source.value = template.source
            scheduleRender(true)
        })
    }
    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-theme], [data-playground-theme]')) {
        control.addEventListener('click', () => {
            theme = control.dataset.vizmaticTheme === 'light' || control.dataset.playgroundTheme === 'light' ? 'light' : 'dark'
            syncThemeControls(root, theme)
            if (!sharedSourcePending) scheduleRender(true)
        })
    }
    for (const control of findElements<HTMLSelectElement>(root, 'select[data-vizmatic-playground-theme]')) {
        control.addEventListener('change', () => {
            theme = control.value === 'light' ? 'light' : 'dark'
            syncThemeControls(root, theme)
            if (!sharedSourcePending) scheduleRender(true)
        })
    }
    window.addEventListener('hashchange', () => {
        const source = getPlaygroundHashSource()
        if (!source || source === elements.source.value) return
        loadSharedSource(source)
    })
    window.addEventListener('pagehide', () => renderer.dispose(), { once: true })

    syncThemeControls(root, theme)
    if (hashSource) loadSharedSource(hashSource)
    else scheduleRender(true)
}

export function mountPlaygrounds(): void {
    const roots = [
        ...document.querySelectorAll<HTMLElement>('[data-vizmatic-playground]'),
        document.querySelector<HTMLElement>('#vizmatic-playground'),
        document.querySelector<HTMLElement>('#playground'),
    ].filter((root): root is HTMLElement => Boolean(root))
    for (const root of new Set(roots)) mountPlayground(root)
}

function mountPlaygroundsWhenVisible(): void {
    const roots = [
        ...document.querySelectorAll<HTMLElement>('[data-vizmatic-playground]'),
        document.querySelector<HTMLElement>('#vizmatic-playground'),
        document.querySelector<HTMLElement>('#playground'),
    ].filter((root): root is HTMLElement => Boolean(root))

    if (!('IntersectionObserver' in window)) {
        for (const root of new Set(roots)) mountPlayground(root)
        return
    }

    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue
            observer.unobserve(entry.target)
            mountPlayground(entry.target as HTMLElement)
        }
    }, { rootMargin: '600px 0px' })
    for (const root of new Set(roots)) observer.observe(root)
}

const globalPlayground = globalThis as typeof globalThis & { VizmaticPlayground?: { mountAll: () => void; mount: (root: HTMLElement) => void } }
globalPlayground.VizmaticPlayground = { mountAll: mountPlaygrounds, mount: mountPlayground }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPlaygroundsWhenVisible, { once: true })
else mountPlaygroundsWhenVisible()
