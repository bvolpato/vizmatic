import { imageContentRect } from './playground-text-editor'
import type { PlaygroundCanvasItemTarget } from './playground-builder-types'

interface CanvasBounds { x: number; y: number; width: number; height: number }
interface CanvasEditorApi {
    getSource(): string
    select(start: number): void
    setProps(start: number, values: Record<string, number>, group: string): boolean
    snap(): boolean
    selectedStart?(): number | undefined
}

const keyboardFocus = new WeakMap<HTMLElement, { source: string; start: number; resizing: boolean }>()

export function snapCanvasValue(value: number, grid: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value / grid) * grid))
}

/** Pointer edits commit once, keeping a whole drag as one undo step. */
export function mountCanvasEditor(
    preview: HTMLElement, image: HTMLImageElement, targets: PlaygroundCanvasItemTarget[],
    bounds: CanvasBounds, canvasSize: { width: number; height: number }, api: CanvasEditorApi,
): () => void {
    const mountedSource = api.getSource()
    const root = preview.closest<HTMLElement>('[data-vizmatic-playground]')!
    const overlay = document.createElement('div')
    overlay.className = 'playground-canvas-overlay'
    overlay.setAttribute('aria-label', 'Canvas items')
    const items = targets.map((target, index) => {
        const element = document.createElement('div')
        element.className = 'playground-canvas-item'
        element.dataset.builderSourceStart = String(target.sourceStart)
        const move = document.createElement('button')
        move.type = 'button'
        move.className = 'playground-canvas-move'
        move.setAttribute('aria-label', `Move canvas item ${index + 1}`)
        move.title = 'Drag to move. Arrow keys move the selected item.'
        const resize = document.createElement('button')
        resize.type = 'button'
        resize.className = 'playground-canvas-resize'
        resize.setAttribute('aria-label', `Resize canvas item ${index + 1}`)
        resize.title = 'Drag to resize. Arrow keys adjust width and height.'
        element.append(move, resize)
        overlay.append(element)
        return { target, element, move, resize }
    })
    let selectedStart = api.selectedStart?.()
    let pointerCleanup: (() => void) | undefined
    let disposed = false

    function select(start: number) {
        selectedStart = start
        for (const item of items) item.element.classList.toggle('selected', item.target.sourceStart === start
            || start > item.target.sourceStart && start < item.target.sourceEnd)
    }
    function position(item: typeof items[number], geometry = item.target) {
        const content = imageContentRect(image, bounds)
        const container = preview.getBoundingClientRect()
        const scale = content.width / bounds.width
        item.element.style.left = `${content.left - container.left + (geometry.left - bounds.x) * scale}px`
        item.element.style.top = `${content.top - container.top + (geometry.top - bounds.y) * scale}px`
        item.element.style.width = `${geometry.width * scale}px`
        item.element.style.height = `${geometry.height * scale}px`
    }
    function update() { if (!disposed) items.forEach((item) => position(item)) }
    function selected(event: Event) {
        if (event instanceof CustomEvent) select(event.detail?.start)
    }
    root.addEventListener('vizmatic-builder-selection', selected)
    preview.append(overlay)

    for (const item of items) {
        for (const [control, resizing] of [[item.move, false], [item.resize, true]] as const) {
            control.addEventListener('focus', () => { api.select(item.target.sourceStart); select(item.target.sourceStart) })
            control.addEventListener('pointerdown', (event) => {
                if (event.button !== 0 || api.getSource() !== mountedSource) return
                keyboardFocus.delete(preview)
                event.preventDefault()
                pointerCleanup?.()
                api.select(item.target.sourceStart)
                select(item.target.sourceStart)
                control.focus({ preventScroll: true })
                control.setPointerCapture(event.pointerId)
                const startX = event.clientX, startY = event.clientY
                const scale = imageContentRect(image, bounds).width / bounds.width
                if (!(scale > 0)) return
                let values: Record<string, number> | undefined
                const original = item.target
                const move = (next: PointerEvent) => {
                    if (next.pointerId !== event.pointerId) return
                    const grid = api.snap() && !next.altKey ? 8 : 1
                    const dx = (next.clientX - startX) / scale, dy = (next.clientY - startY) / scale
                    if (resizing) {
                        values = {
                            width: snapCanvasValue(original.width + dx, grid, 40, Math.max(40, canvasSize.width - original.x)),
                            height: snapCanvasValue(original.height + dy, grid, 32, Math.max(32, canvasSize.height - original.y)),
                        }
                        position(item, { ...original, ...values })
                    } else {
                        values = {
                            x: snapCanvasValue(original.x + dx, grid, 0, Math.max(0, canvasSize.width - original.width)),
                            y: snapCanvasValue(original.y + dy, grid, 0, Math.max(0, canvasSize.height - original.height)),
                        }
                        position(item, { ...original, left: original.left + values.x - original.x, top: original.top + values.y - original.y })
                    }
                }
                const finish = (next: PointerEvent) => {
                    if (next.pointerId !== event.pointerId) return
                    const commit = next.type === 'pointerup' && values && api.getSource() === mountedSource
                    cleanup()
                    if (commit && !api.setProps(original.sourceStart, values!, resizing ? 'canvas-resize' : 'canvas-move')) position(item)
                    else if (!commit) position(item)
                }
                const cleanup = () => {
                    control.removeEventListener('pointermove', move)
                    control.removeEventListener('pointerup', finish)
                    control.removeEventListener('pointercancel', finish)
                    control.removeEventListener('lostpointercapture', finish)
                    if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId)
                    pointerCleanup = undefined
                }
                control.addEventListener('pointermove', move)
                control.addEventListener('pointerup', finish)
                control.addEventListener('pointercancel', finish)
                control.addEventListener('lostpointercapture', finish)
                pointerCleanup = cleanup
            })
            control.addEventListener('keydown', (event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || api.getSource() !== mountedSource) return
                event.preventDefault()
                const grid = api.snap() && !event.altKey ? 8 : 1
                const step = grid * (event.shiftKey ? 4 : 1)
                const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                const change = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -step : step
                const target = item.target
                const prop = resizing ? horizontal ? 'width' : 'height' : horizontal ? 'x' : 'y'
                const max = resizing ? horizontal ? canvasSize.width - target.x : canvasSize.height - target.y
                    : horizontal ? canvasSize.width - target.width : canvasSize.height - target.height
                const min = resizing ? horizontal ? 40 : 32 : 0
                const focus = { source: mountedSource, start: target.sourceStart, resizing }
                keyboardFocus.set(preview, focus)
                if (api.setProps(target.sourceStart, { [prop]: snapCanvasValue(target[prop] + change, grid, min, Math.max(min, max)) }, resizing ? 'canvas-resize' : 'canvas-move')) focus.source = api.getSource()
                else keyboardFocus.delete(preview)
            })
        }
    }
    const observer = new ResizeObserver(update)
    observer.observe(image)
    update()
    if (selectedStart !== undefined) select(selectedStart)
    const restoreFocus = keyboardFocus.get(preview)
    keyboardFocus.delete(preview)
    if (restoreFocus?.source === mountedSource && (document.activeElement === document.body || !document.activeElement || preview.contains(document.activeElement))) {
        const item = items.find((entry) => entry.target.sourceStart === restoreFocus.start)
        if (item) (restoreFocus.resizing ? item.resize : item.move).focus({ preventScroll: true })
    }
    return () => {
        disposed = true
        pointerCleanup?.()
        observer.disconnect()
        root.removeEventListener('vizmatic-builder-selection', selected)
        overlay.remove()
    }
}
