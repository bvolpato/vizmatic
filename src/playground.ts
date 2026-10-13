import {
    getPlaygroundHashSource,
    setPlaygroundHashSource,
    type PlaygroundTheme,
} from './playground-source'
import { highlightPlaygroundSource } from './playground-highlight'
import { findPlaygroundTemplate, playgroundTemplates } from './playground-templates'
import { mountComponentExplorer, type ComponentExplorerController } from './component-explorer'
import { mountPreviewTextEditor } from './playground-text-editor'
import type { PlaygroundTextTarget } from './playground-text-types'
import type { CropRegion } from './autocrop'
import type { PlaygroundRenderRequest } from './playground-worker'
import { PlaygroundHistory, readPlaygroundDraft, savePlaygroundDraft } from './playground-history'
import type { PlaygroundAnimationMetadata } from './playground-animation'
import { mountCanvasEditor } from './playground-canvas-editor'
import type { PlaygroundCanvasItemTarget } from './playground-builder-types'
import { playgroundBuilderTemplate } from './playground-builder-template'
import { readPlaygroundProject, writePlaygroundProject, projectFilename } from './playground-project'
import { mountPlaygroundSettingsEditor } from './playground-settings-editor'

interface PlaygroundRenderSuccess {
    id: number
    ok: true
    svg: string
    png: ArrayBuffer
    width: number
    height: number
    warnings: string[]
    contentBounds: CropRegion
    textTargets: PlaygroundTextTarget[]
    canvasItems: PlaygroundCanvasItemTarget[]
    animation?: PlaygroundAnimationMetadata
}

interface PlaygroundGifSuccess {
    id: number
    ok: true
    gif: ArrayBuffer
    width: number
    height: number
    frameCount: number
}

type PlaygroundWorkerSuccess = PlaygroundRenderSuccess | PlaygroundGifSuccess

interface PlaygroundRenderFailure {
    id: number
    ok: false
    error: string
}

type PlaygroundRenderResponse = PlaygroundWorkerSuccess | PlaygroundRenderFailure

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
        resolve: (value: PlaygroundWorkerSuccess) => void
        timeout: number
    } | undefined
    private nextId = 1
    private hasRendered = false

    render(input: PlaygroundRenderInput): Promise<PlaygroundRenderSuccess> {
        return this.request(input).then((output) => {
            if ('gif' in output) throw new Error('Expected a preview image.')
            return output
        })
    }

    exportGif(input: PlaygroundRenderInput): Promise<PlaygroundGifSuccess> {
        return this.request(input).then((output) => {
            if (!('gif' in output)) throw new Error('Expected an animated GIF.')
            return output
        })
    }

    private request(input: PlaygroundRenderInput): Promise<PlaygroundWorkerSuccess> {
        if (this.pending) this.restart(new SupersededRenderError())

        const worker = this.worker ?? this.createWorker()
        const id = this.nextId++
        return new Promise((resolve, reject) => {
            const timeoutMs = input.exportGif ? 60_000 : this.hasRendered ? RENDER_TIMEOUT_MS : INITIAL_RENDER_TIMEOUT_MS
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
        if (!response.ok) {
            this.restart(new Error(response.error))
            return
        }

        const pending = this.pending
        this.pending = undefined
        window.clearTimeout(pending.timeout)
        this.hasRendered = true
        pending.resolve(response)
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
    highlight?: HTMLElement
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
    copy?: HTMLElement
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
        highlight: findElement(root, '#playgroundHighlight, [data-vizmatic-playground-highlight]'),
        status: findElement(root, '#playgroundStatus, #vizmatic-playground-status, [data-vizmatic-playground-status]'),
        error: findElement(root, '#playgroundError, #vizmatic-playground-error, [data-vizmatic-playground-error]'),
        viewport: findElement(root, '#playgroundViewport, #vizmatic-playground-viewport, [data-vizmatic-playground-viewport]'),
        dimensions: findElement(root, '#playgroundDimensions, #vizmatic-playground-dimensions, [data-vizmatic-playground-dimensions]'),
        width: findElement(root, '#vizmatic-playground-width, [data-vizmatic-playground-width]'),
        height: findElement(root, '#vizmatic-playground-height, [data-vizmatic-playground-height]'),
        templateSelect: findElement<HTMLSelectElement>(root, '#playgroundTemplate, select[data-vizmatic-playground-template]'),
        run: findElement(root, '#playgroundRunButton, #vizmatic-playground-run, [data-vizmatic-playground-run]'),
        copy: findElement(root, '#playgroundCopyButton, [data-vizmatic-playground-copy]'),
        share: findElement(root, '#playgroundShareButton, #vizmatic-playground-share, [data-vizmatic-playground-share]'),
        pngDownload: findElement(root, '#playgroundPngButton, #vizmatic-playground-download-png, [data-vizmatic-playground-download="png"]'),
        svgDownload: findElement(root, '#playgroundSvgButton, #vizmatic-playground-download-svg, [data-vizmatic-playground-download="svg"]'),
    }
}

function syncSourceHighlightScroll(elements: PlaygroundElements): void {
    if (!elements.highlight) return
    elements.highlight.scrollLeft = elements.source.scrollLeft
    elements.highlight.scrollTop = elements.source.scrollTop
}

function updateSourceHighlight(elements: PlaygroundElements): void {
    if (!elements.highlight) return
    elements.highlight.innerHTML = `${highlightPlaygroundSource(elements.source.value)}\n`
    syncSourceHighlightScroll(elements)
}

function getTheme(root: HTMLElement): PlaygroundTheme {
    if (root.dataset.vizmaticPlaygroundTheme === 'light' || root.dataset.vizmaticPlaygroundTheme === 'dark') {
        return root.dataset.vizmaticPlaygroundTheme
    }
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

async function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return } catch { /* Try the browser's selection clipboard. */ }
    }

    const focused = document.activeElement
    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    let copied = false
    try { copied = document.execCommand('copy') }
    finally { input.remove(); if (focused instanceof HTMLElement) focused.focus({ preventScroll: true }) }
    if (!copied) throw new Error('Clipboard access is unavailable.')
}

function download(filename: string, content: BlobPart, type: string): void {
    const url = URL.createObjectURL(new Blob([content], { type }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const previewEditors = new WeakMap<HTMLElement, () => void>()

function clearTextEditor(preview: HTMLElement): void {
    previewEditors.get(preview)?.()
    previewEditors.delete(preview)
}

function clearPreview(preview: HTMLElement): void {
    clearTextEditor(preview)
    const url = preview.dataset.vizmaticPreviewUrl
    if (url) {
        URL.revokeObjectURL(url)
        delete preview.dataset.vizmaticPreviewUrl
    }
    preview.replaceChildren()
}

function renderPreview(preview: HTMLElement, svg: string, width: number, height: number, bounds?: CropRegion, textTargets: PlaygroundTextTarget[] = [], textApi?: Parameters<typeof mountPreviewTextEditor>[4], canvasItems: PlaygroundCanvasItemTarget[] = [], canvasApi?: Parameters<typeof mountCanvasEditor>[5]): void {
    clearPreview(preview)
    const canvasSize = { width, height }
    const displayBounds = bounds ?? { x: 0, y: 0, width, height }
    const textSource = textApi?.getSource()
    if (bounds) {
        svg = svg.replace(/^<svg\b[^>]*>/, (tag) => tag
            .replace(/\bviewBox="[^"]*"/, `viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"`)
            .replace(/\bwidth="[^"]*"/, `width="${bounds.width}"`)
            .replace(/\bheight="[^"]*"/, `height="${bounds.height}"`))
        width = bounds.width
        height = bounds.height
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    preview.dataset.vizmaticPreviewUrl = url
    const image = document.createElement('img')
    image.src = url
    image.alt = `Vizmatic preview, ${width} by ${height}`
    image.width = width
    image.height = height
    image.addEventListener('load', () => {
        URL.revokeObjectURL(url)
        if (preview.dataset.vizmaticPreviewUrl === url) delete preview.dataset.vizmaticPreviewUrl
        const viewport = preview.parentElement
        if (viewport && preview.closest<HTMLElement>('[data-vizmatic-playground]')?.dataset.previewZoom === 'actual') {
            viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2
            viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2
        }
        if (textApi && textApi.getSource() === textSource && preview.contains(image)) {
            const disposeText = mountPreviewTextEditor(preview, image, textTargets, displayBounds, textApi)
            const disposeCanvas = canvasApi && canvasItems.length ? mountCanvasEditor(preview, image, canvasItems, displayBounds, canvasSize, canvasApi) : undefined
            previewEditors.set(preview, () => { disposeText(); disposeCanvas?.() })
        }
    }, { once: true })
    preview.append(image)
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
    const custom = document.createElement('option')
    custom.value = 'custom'
    custom.textContent = 'Custom source'
    custom.disabled = true
    select.append(custom)
    select.value = findPlaygroundTemplate(selected)?.id ?? playgroundTemplates[0]?.id ?? ''
}

function syncTemplateSelection(elements: PlaygroundElements): void {
    if (!elements.templateSelect) return
    elements.templateSelect.value = playgroundTemplates.find((template) => template.source === elements.source.value)?.id ?? 'custom'
}

export function mountPlayground(root: HTMLElement): void {
    if (root.dataset.vizmaticPlaygroundMounted === 'true') return
    const found = requiredElements(root)
    if (!found) return
    const elements = found
    root.dataset.vizmaticPlaygroundMounted = 'true'
    const renderer = new PlaygroundRenderer()
    const hashSource = getPlaygroundHashSource()
    const explicitExample = new URLSearchParams(location.search).has('example')
    const draftKey = `vizmatic-playground-draft:${location.pathname}`
    let storage: Storage | undefined
    try { storage = window.localStorage } catch { /* Editing works without storage. */ }
    const savedDraft = storage ? readPlaygroundDraft(storage, draftKey) : undefined
    const componentHash = location.hash.startsWith('#component-') ? location.hash.slice(11) : undefined
    const draft = !hashSource && !explicitExample && !componentHash ? savedDraft : undefined
    const startWithBuilder = !hashSource && !draft && !explicitExample && !componentHash && Boolean(root.closest('.playground-page'))
    if (elements.templateSelect) populateTemplateSelect(elements.templateSelect)
    if (hashSource || draft) elements.source.value = hashSource ?? draft!.source
    else if (startWithBuilder) elements.source.value = playgroundBuilderTemplate.source
    if (!elements.source.value.trim()) elements.source.value = findPlaygroundTemplate(elements.templateSelect?.value)?.source ?? playgroundTemplates[0]?.source ?? ''
    if (draft) root.dataset.vizmaticPlaygroundBackground = draft.background
    const sharedBackground = new URLSearchParams(location.search).get('background')
    if (hashSource && (sharedBackground === 'theme' || sharedBackground === 'transparent')) root.dataset.vizmaticPlaygroundBackground = sharedBackground
    const history = new PlaygroundHistory(elements.source.value)
    const undo = root.querySelector<HTMLButtonElement>('#playgroundUndoButton')
    const redo = root.querySelector<HTMLButtonElement>('#playgroundRedoButton')
    const draftStatus = root.querySelector<HTMLElement>('#playgroundDraftStatus')
    const animationPanel = root.querySelector<HTMLElement>('#playgroundAnimation')
    const playButton = root.querySelector<HTMLButtonElement>('#playgroundPlayButton')
    const gifButton = root.querySelector<HTMLButtonElement>('#playgroundGifButton')
    const timeSlider = root.querySelector<HTMLInputElement>('#playgroundTime')
    const timeLabel = root.querySelector<HTMLOutputElement>('#playgroundTimeLabel')
    const projectName = root.querySelector<HTMLInputElement>('#playgroundProjectName')
    const projectFile = root.querySelector<HTMLInputElement>('#playgroundProjectFile')
    const snap = root.querySelector<HTMLInputElement>('#playgroundSnap')
    let dirty = Boolean(draft)
    let draftTimer: number | undefined
    let renderTimer: number | undefined
    let playbackTimer: number | undefined
    let playing = false
    let playbackVersion = 0
    let playbackStartedAt = 0
    let playbackOffset = 0
    let exportingGif = false
    let animation: PlaygroundAnimationMetadata | undefined
    let animationTime = 0
    let png: ArrayBuffer | undefined
    let svg: string | undefined
    let previewOutput: PlaygroundRenderSuccess | undefined
    let previewSource = ''
    let renderVersion = 0
    let theme = draft?.theme ?? getTheme(root)
    const sharedTheme = new URLSearchParams(location.search).get('theme')
    if (hashSource && (sharedTheme === 'dark' || sharedTheme === 'light')) theme = sharedTheme
    let explorer: ComponentExplorerController | undefined
    let settingsEditor: ReturnType<typeof mountPlaygroundSettingsEditor> | undefined
    let exampleLoadVersion = 0
    const copyBlock = root.querySelector<HTMLButtonElement>('#explorerCopyBlock')

    function syncCopyBlock() {
        if (copyBlock) copyBlock.disabled = !explorer?.getSelectedBlockSource()
    }

    function syncHistory() {
        if (undo) undo.disabled = !history.canUndo
        if (redo) redo.disabled = !history.canRedo
    }

    function saveDraft() {
        if (draftTimer) window.clearTimeout(draftTimer)
        draftTimer = undefined
        if (!dirty) return
        const saved = storage && savePlaygroundDraft(storage, draftKey, {
            version: 1, source: elements!.source.value, theme,
            background: root.dataset.vizmaticPlaygroundBackground === 'theme' ? 'theme' : 'transparent',
            component: location.hash.startsWith('#component-') ? location.hash.slice(11) : undefined,
            updatedAt: Date.now(),
        })
        if (draftStatus) draftStatus.textContent = saved ? 'Draft saved in this browser.' : 'Draft saving is unavailable. Copy the source or save a share link to keep your work.'
    }

    function scheduleDraft() {
        if (draftTimer) window.clearTimeout(draftTimer)
        draftTimer = window.setTimeout(saveDraft, 300)
    }

    function stopPlayback() {
        playing = false
        playbackVersion += 1
        if (playbackTimer) window.clearTimeout(playbackTimer)
        playbackTimer = undefined
        if (playButton) playButton.textContent = 'Play'
        syncAnimation()
    }

    function syncAnimation() {
        if (animationPanel) animationPanel.hidden = !animation
        if (gifButton) gifButton.disabled = !animation || exportingGif
        if (timeSlider && animation) { timeSlider.max = String(animation.duration); timeSlider.step = String(1 / animation.fps); timeSlider.value = String(animationTime) }
        if (timeLabel) timeLabel.value = `${animationTime.toFixed(2)} s`
    }

    const scheduleRender = (immediate = false) => {
        clearTextEditor(elements.preview)
        setStatus(elements, 'loading', 'Rendering locally…')
        png = undefined
        svg = undefined
        setControlEnabled(elements.pngDownload, false)
        setControlEnabled(elements.svgDownload, false)
        renderVersion += 1
        if (renderTimer) window.clearTimeout(renderTimer)
        renderTimer = window.setTimeout(() => { renderTimer = undefined; void render() }, immediate ? 0 : LIVE_PREVIEW_DELAY_MS)
    }

    function clearProjectLink() {
        const url = new URL(location.href)
        if (getPlaygroundHashSource() === undefined && !location.hash.startsWith('#component-') && !url.searchParams.has('example')) return
        url.hash = ''
        url.searchParams.delete('example')
        url.searchParams.delete('theme')
        url.searchParams.delete('background')
        window.history.replaceState(null, '', url)
    }

    function syncSourceLink(source: string) {
        const linkedSource = getPlaygroundHashSource()
        if ((linkedSource !== undefined && linkedSource !== source) || new URLSearchParams(location.search).has('example')) clearProjectLink()
    }

    const loadSharedSource = (source: string, immediate = true, options: { history?: boolean; group?: string } = {}) => {
        exampleLoadVersion += 1
        stopPlayback()
        animation = undefined
        animationTime = 0
        syncAnimation()
        elements.source.value = source
        syncSourceLink(source)
        if (options.history === false) history.reset(source)
        else { history.record(source, options.group); dirty = true; scheduleDraft() }
        syncHistory()
        syncTemplateSelection(elements)
        updateSourceHighlight(elements)
        png = undefined
        svg = undefined
        if (immediate) { clearPreview(elements.preview); previewOutput = undefined }
        setControlEnabled(elements.pngDownload, false)
        setControlEnabled(elements.svgDownload, false)
        setError(elements, undefined)
        setStatus(elements, 'loading', 'Rendering locally…')
        scheduleRender(immediate)
        explorer?.sourceChanged()
        settingsEditor?.sourceChanged()
        syncCopyBlock()
    }

    const displayPreview = () => {
        if (!previewOutput || elements.source.value !== previewSource) return
        renderPreview(elements.preview, previewOutput.svg, previewOutput.width, previewOutput.height, root.dataset.previewZoom === 'content' ? previewOutput.contentBounds : undefined, previewOutput.textTargets, {
            getSource: () => elements.source.value,
            saveSource: (source) => { loadSharedSource(source); elements.viewport?.focus({ preventScroll: true }) },
            onError: (message) => { setError(elements, message) },
            selectText: (start, end) => explorer?.selectText(start, end),
        }, previewOutput.canvasItems, {
            getSource: () => elements.source.value,
            select: (start) => explorer?.selectInstanceByStart(start),
            setProps: (start, values, group) => explorer?.setInstanceProps(start, values, group) ?? false,
            snap: () => snap?.checked ?? true,
            selectedStart: () => explorer?.getSelectedInstance()?.start,
        })
    }

    const render = async () => {
        const version = renderVersion
        const source = elements.source.value
        setControlEnabled(elements.pngDownload, false)
        setControlEnabled(elements.svgDownload, false)
        setStatus(elements, 'loading', 'Rendering locally…')
        setError(elements, undefined)
        try {
            const output = await renderer.render({ source, theme, background: getBackground(root), time: animationTime })
            if (version !== renderVersion) return
            png = output.png
            svg = output.svg
            previewOutput = output
            previewSource = source
            animation = output.animation
            if (animation) animationTime = Math.min(animationTime, animation.duration)
            else stopPlayback()
            syncAnimation()
            displayPreview()
            const textHint = root.querySelector<HTMLElement>('#playgroundTextHint')
            if (textHint) textHint.textContent = output.canvasItems.length
                ? 'Drag items to move. Use the corner handle to resize. Double-click text to edit. Arrow keys nudge focused items.'
                : output.textTargets.length
                ? 'Double-click text to edit. Enter saves. Escape cancels. You can also focus a label and press Enter.'
                : 'Open the TSX below to edit the text in this scene.'
            if (elements.dimensions) elements.dimensions.textContent = `${output.width} × ${output.height}`
            if (elements.width) elements.width.textContent = String(output.width)
            if (elements.height) elements.height.textContent = String(output.height)
            setControlEnabled(elements.pngDownload, true)
            setControlEnabled(elements.svgDownload, true)
            setStatus(elements, 'ready', output.warnings[0] ?? `Ready · ${output.width}×${output.height}`)
        } catch (error) {
            if (error instanceof SupersededRenderError || version !== renderVersion) return
            stopPlayback()
            png = undefined; svg = undefined; previewOutput = undefined; animation = undefined
            syncAnimation()
            clearPreview(elements.preview)
            setStatus(elements, 'error', 'Error')
            setError(elements, error instanceof Error ? error.message : String(error))
        }
    }

    async function advanceAnimation(version: number) {
        if (!playing || version !== playbackVersion || !animation) return
        const frameStartedAt = performance.now()
        animationTime = (playbackOffset + (frameStartedAt - playbackStartedAt) / 1000) % animation.duration
        await render()
        if (playing && version === playbackVersion && animation) playbackTimer = window.setTimeout(() => { void advanceAnimation(version) }, Math.max(0, 1000 / animation.fps - (performance.now() - frameStartedAt)))
    }

    const applyHistory = (direction: 'undo' | 'redo') => {
        const source = direction === 'undo' ? history.undo() : history.redo()
        if (source === undefined) return
        exampleLoadVersion += 1
        stopPlayback(); animation = undefined; animationTime = 0; syncAnimation()
        elements.source.value = source
        syncSourceLink(source)
        dirty = true; scheduleDraft(); syncHistory(); syncTemplateSelection(elements); updateSourceHighlight(elements)
        explorer?.sourceChanged(); settingsEditor?.sourceChanged(); syncCopyBlock(); scheduleRender(true)
    }
    undo?.addEventListener('click', () => applyHistory('undo'))
    redo?.addEventListener('click', () => applyHistory('redo'))
    root.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return
        if (event.target instanceof Element && event.target.closest('.playground-text-input')) return
        const key = event.key.toLowerCase()
        if (key === 'c' && event.target instanceof Element && event.target.closest('.playground-canvas-move, .playground-canvas-resize')) {
            event.preventDefault()
            void copySelectedBlock()
            return
        }
        if (key !== 'z' && key !== 'y') return
        event.preventDefault()
        applyHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    })
    elements.source.addEventListener('input', () => {
        exampleLoadVersion += 1
        stopPlayback(); animation = undefined; animationTime = 0; syncAnimation()
        syncSourceLink(elements.source.value)
        history.record(elements.source.value, 'typing')
        dirty = true; scheduleDraft(); syncHistory(); syncTemplateSelection(elements); updateSourceHighlight(elements)
        explorer?.sourceChanged(); settingsEditor?.sourceChanged(); syncCopyBlock(); scheduleRender()
    })
    elements.source.addEventListener('scroll', () => syncSourceHighlightScroll(elements))
    elements.run?.addEventListener('click', (event) => { event.preventDefault(); stopPlayback(); scheduleRender(true) })
    elements.pngDownload?.addEventListener('click', (event) => { event.preventDefault(); if (png) download('vizmatic.png', png, 'image/png') })
    elements.svgDownload?.addEventListener('click', (event) => { event.preventDefault(); if (svg) download('vizmatic.svg', svg, 'image/svg+xml') })
    elements.share?.addEventListener('click', (event) => {
        event.preventDefault(); setPlaygroundHashSource(elements.source.value)
        const url = new URL(location.href)
        url.searchParams.set('theme', theme)
        url.searchParams.set('background', root.dataset.vizmaticPlaygroundBackground === 'theme' ? 'theme' : 'transparent')
        window.history.replaceState(null, '', url)
        const shareUrl = window.location.href
        void copyText(shareUrl).then(() => setStatus(elements, 'ready', 'Share link copied.')).catch(() => setStatus(elements, 'ready', 'Share link ready in address bar.'))
    })
    const copyLabel = elements.copy?.textContent ?? 'Copy source'
    elements.copy?.addEventListener('click', async (event) => {
        event.preventDefault()
        try { await copyText(elements.source.value); if (elements.copy) elements.copy.textContent = 'Copied'; setStatus(elements, 'ready', 'Source copied.') }
        catch { if (elements.copy) elements.copy.textContent = 'Copy failed'; setStatus(elements, 'error', 'Could not copy source.') }
        window.setTimeout(() => { if (elements.copy) elements.copy.textContent = copyLabel }, 1600)
    })
    async function copySelectedBlock() {
        const source = explorer?.getSelectedBlockSource()
        if (!source) return
        try {
            await copyText(source)
            if (copyBlock) copyBlock.textContent = 'Copied'
            setStatus(elements, 'ready', 'Block copied as reusable TSX, including its setup and canvas settings.')
        } catch { setStatus(elements, 'error', 'Could not copy block. Copy its TSX from the source editor.') }
        window.setTimeout(() => { if (copyBlock) copyBlock.textContent = 'Copy block' }, 1600)
    }
    copyBlock?.addEventListener('click', () => { void copySelectedBlock() })
    root.addEventListener('vizmatic-builder-selection', syncCopyBlock)
    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-playground-template]')) {
        control.addEventListener('click', () => { const template = findPlaygroundTemplate(control.dataset.vizmaticPlaygroundTemplate); if (template) loadSharedSource(template.source) })
    }
    for (const control of findElements<HTMLButtonElement>(root, '[data-vizmatic-playground-example]')) {
        control.addEventListener('click', async () => {
            const name = control.dataset.vizmaticPlaygroundExample
            if (!name) return
            const version = ++exampleLoadVersion
            control.setAttribute('aria-busy', 'true')
            try {
                const response = await fetch(new URL(`assets/sources/${encodeURIComponent(name)}.json`, document.baseURI))
                if (!response.ok) throw new Error(`Example request failed (${response.status}).`)
                const example = await response.json() as { playgroundCode?: string }
                if (typeof example.playgroundCode !== 'string') throw new Error('This example has no editable source.')
                if (version !== exampleLoadVersion) return
                clearProjectLink()
                if (projectName) projectName.value = control.dataset.exampleTitle ?? 'Untitled visual'
                loadSharedSource(example.playgroundCode)
            } catch (error) {
                if (version === exampleLoadVersion) {
                    setStatus(elements, 'error', 'Could not load this starter.')
                    setError(elements, error instanceof Error ? error.message : String(error))
                }
            } finally { control.removeAttribute('aria-busy') }
        })
    }
    for (const control of findElements<HTMLSelectElement>(root, '#playgroundTemplate, select[data-vizmatic-playground-template]')) {
        control.addEventListener('change', () => { const template = findPlaygroundTemplate(control.value); if (template) loadSharedSource(template.source) })
    }
    function changeTheme(next: PlaygroundTheme) { stopPlayback(); theme = next; syncThemeControls(root, theme); settingsEditor?.sourceChanged(); clearProjectLink(); dirty = true; scheduleDraft(); scheduleRender(true) }
    for (const control of findElements<HTMLElement>(root, '[data-vizmatic-theme], [data-playground-theme]')) {
        control.addEventListener('click', () => changeTheme(control.dataset.vizmaticTheme === 'light' || control.dataset.playgroundTheme === 'light' ? 'light' : 'dark'))
    }
    for (const control of findElements<HTMLSelectElement>(root, 'select[data-vizmatic-playground-theme]')) control.addEventListener('change', () => changeTheme(control.value === 'light' ? 'light' : 'dark'))
    root.addEventListener('vizmatic-playground-theme', (event) => {
        if (!(event instanceof CustomEvent)) return
        if (event.detail?.theme === 'dark' || event.detail?.theme === 'light') changeTheme(event.detail.theme)
    })
    const backgroundSelect = root.querySelector<HTMLSelectElement>('#explorerBackground')
    root.querySelector('#playgroundNewCanvas')?.addEventListener('click', () => {
        clearProjectLink()
        if (projectName) projectName.value = 'Untitled visual'
        root.dataset.previewZoom = 'fit'
        const zoom = root.querySelector<HTMLSelectElement>('#explorerZoom')
        if (zoom) zoom.value = 'fit'
        loadSharedSource(playgroundBuilderTemplate.source)
    })
    root.querySelector('#playgroundSaveProject')?.addEventListener('click', () => {
        try {
            const name = projectName?.value.trim() || 'Untitled visual'
            download(projectFilename(name), writePlaygroundProject({ format: 'vizmatic', version: 1, name,
                source: elements.source.value, theme, background: root.dataset.vizmaticPlaygroundBackground === 'theme' ? 'theme' : 'transparent' }), 'application/json')
            setStatus(elements, 'ready', 'Project saved.')
        } catch (error) { setError(elements, error instanceof Error ? error.message : String(error)) }
    })
    root.querySelector('#playgroundOpenProject')?.addEventListener('click', () => projectFile?.click())
    projectFile?.addEventListener('change', async () => {
        const file = projectFile.files?.[0]
        if (!file) return
        try {
            if (file.size > 600_000) throw new Error('Project files must be smaller than 600 KB.')
            const project = readPlaygroundProject(await file.text())
            theme = project.theme
            syncThemeControls(root, theme)
            root.dataset.vizmaticPlaygroundBackground = project.background
            if (backgroundSelect) backgroundSelect.value = project.background
            if (projectName) projectName.value = project.name
            clearProjectLink()
            loadSharedSource(project.source)
        } catch (error) { setError(elements, error instanceof Error ? error.message : String(error)) }
        finally { projectFile.value = '' }
    })
    const fullscreen = root.querySelector<HTMLButtonElement>('#playgroundFullscreen')
    fullscreen?.addEventListener('click', async () => {
        try {
            if (document.fullscreenElement === root) await document.exitFullscreen()
            else await root.requestFullscreen()
        } catch { setError(elements, 'Fullscreen is unavailable in this browser.') }
    })
    document.addEventListener('fullscreenchange', () => {
        if (fullscreen) { fullscreen.textContent = document.fullscreenElement === root ? 'Exit fullscreen' : 'Fullscreen'; fullscreen.setAttribute('aria-pressed', String(document.fullscreenElement === root)) }
    })
    if (backgroundSelect && draft) backgroundSelect.value = draft.background
    root.querySelector<HTMLSelectElement>('#explorerZoom')?.addEventListener('change', (event) => {
        root.dataset.previewZoom = (event.target as HTMLSelectElement).value
        displayPreview()
        if (elements.viewport) {
            elements.viewport.scrollLeft = root.dataset.previewZoom === 'actual' ? (elements.viewport.scrollWidth - elements.viewport.clientWidth) / 2 : 0
            elements.viewport.scrollTop = root.dataset.previewZoom === 'actual' ? (elements.viewport.scrollHeight - elements.viewport.clientHeight) / 2 : 0
        }
    })
    playButton?.addEventListener('click', () => {
        if (playing) { stopPlayback(); return }
        if (!animation || exportingGif) return
        playing = true; playbackStartedAt = performance.now(); playbackOffset = animationTime; playButton.textContent = 'Pause'; void advanceAnimation(playbackVersion)
    })
    timeSlider?.addEventListener('input', () => { const time = timeSlider.valueAsNumber; stopPlayback(); animationTime = time; syncAnimation(); scheduleRender(true) })
    gifButton?.addEventListener('click', async () => {
        if (!animation || exportingGif) return
        stopPlayback()
        const version = renderVersion
        exportingGif = true; syncAnimation()
        setStatus(elements, 'loading', 'Encoding GIF locally…')
        setError(elements, undefined)
        try {
            const output = await renderer.exportGif({ source: elements.source.value, theme, background: getBackground(root), exportGif: animation })
            if (version === renderVersion) {
                download('vizmatic.gif', output.gif, 'image/gif')
                await render()
                if (version === renderVersion && png) setStatus(elements, 'ready', `GIF exported · ${output.frameCount} frames`)
            }
        } catch (error) {
            if (!(error instanceof SupersededRenderError) && version === renderVersion) { setStatus(elements, 'error', 'GIF export failed'); setError(elements, error instanceof Error ? error.message : String(error)) }
        } finally { exportingGif = false; syncAnimation() }
    })
    window.addEventListener('hashchange', () => { const source = getPlaygroundHashSource(); if (source && source !== elements.source.value) loadSharedSource(source) })
    window.addEventListener('pagehide', () => { saveDraft(); stopPlayback(); clearPreview(elements.preview); renderer.dispose() })
    window.addEventListener('pageshow', (event) => { if (event.persisted) scheduleRender(true) })
    syncThemeControls(root, theme); syncHistory(); syncTemplateSelection(elements); updateSourceHighlight(elements)
    if (draftStatus) draftStatus.textContent = draft ? 'Your draft was restored from this browser.' : 'Edits are saved in this browser. Shared links open their own source.'
    explorer = mountComponentExplorer(root, { getSource: () => elements.source.value, loadSource: loadSharedSource, preserveSource: Boolean(hashSource || draft || explicitExample || startWithBuilder) })
    settingsEditor = mountPlaygroundSettingsEditor(root, {
        getSource: () => elements.source.value,
        getTheme: () => theme,
        getBackground: () => root.dataset.vizmaticPlaygroundBackground ?? 'transparent',
        saveSource: (source, group) => loadSharedSource(source, false, { group }),
        onError: (message) => setError(elements, message),
    })
    syncCopyBlock()
    if (hashSource || draft || startWithBuilder) scheduleRender(true)
    else if (!explorer && !explicitExample) scheduleRender(true)
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
