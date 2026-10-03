import type { PlaygroundTextTarget } from './playground-text-types'

interface TextBounds {
    x: number
    y: number
    width: number
    height: number
}

interface TextEditorApi {
    getSource(): string
    saveSource(source: string): void
    onError(message: string): void
}

interface Rect {
    left: number
    top: number
    width: number
    height: number
}

interface MountedTarget {
    target: PlaygroundTextTarget
    button: HTMLButtonElement
    rect?: Rect
}

interface ActiveEditor {
    target: PlaygroundTextTarget
    button: HTMLButtonElement
    textarea: HTMLTextAreaElement
    finishing: boolean
}

const MIN_HIT_SIZE = 8
const MAX_HIT_EXPANSION = 12
const MIN_EDITOR_WIDTH = 100
const MIN_EDITOR_HEIGHT = 34

function finite(value: number): boolean {
    return Number.isFinite(value)
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

function cssNumber(value: string): number {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
}

function imageContentRect(image: HTMLImageElement, bounds: TextBounds): Rect {
    const box = image.getBoundingClientRect()
    const style = getComputedStyle(image)
    const borderLeft = cssNumber(style.borderLeftWidth)
    const borderRight = cssNumber(style.borderRightWidth)
    const borderTop = cssNumber(style.borderTopWidth)
    const borderBottom = cssNumber(style.borderBottomWidth)
    const paddingLeft = cssNumber(style.paddingLeft)
    const paddingRight = cssNumber(style.paddingRight)
    const paddingTop = cssNumber(style.paddingTop)
    const paddingBottom = cssNumber(style.paddingBottom)
    const left = box.left + borderLeft + paddingLeft
    const top = box.top + borderTop + paddingTop
    const width = Math.max(0, box.width - borderLeft - borderRight - paddingLeft - paddingRight)
    const height = Math.max(0, box.height - borderTop - borderBottom - paddingTop - paddingBottom)
    if (!width || !height || bounds.width <= 0 || bounds.height <= 0) return { left, top, width, height }
    const scale = Math.min(width / bounds.width, height / bounds.height)
    const objectWidth = bounds.width * scale
    const objectHeight = bounds.height * scale
    return {
        left: left + (width - objectWidth) / 2,
        top: top + (height - objectHeight) / 2,
        width: objectWidth,
        height: objectHeight,
    }
}

function replacementFor(kind: PlaygroundTextTarget['kind'], value: string): string {
    const literal = JSON.stringify(value)
    return kind === 'string' ? literal : `{${literal}}`
}

function sourceMatches(source: string, target: PlaygroundTextTarget): boolean {
    return Number.isInteger(target.start)
        && Number.isInteger(target.end)
        && target.start >= 0
        && target.end >= target.start
        && target.end <= source.length
        && source.slice(target.start, target.end) === target.original
}

function setCssRect(element: HTMLElement, rect: Rect): void {
    element.style.left = `${rect.left}px`
    element.style.top = `${rect.top}px`
    element.style.width = `${rect.width}px`
    element.style.height = `${rect.height}px`
}

/**
 * Mount transparent, keyboard-accessible text hit areas over a rendered SVG image.
 * The returned disposer is safe to call more than once.
 */
export function mountPreviewTextEditor(
    preview: HTMLElement,
    image: HTMLImageElement,
    targets: PlaygroundTextTarget[],
    bounds: TextBounds,
    api: TextEditorApi,
): () => void {
    const mountedSource = api.getSource()
    const overlay = document.createElement('div')
    overlay.className = 'playground-text-overlay'
    overlay.setAttribute('role', 'group')
    overlay.setAttribute('aria-label', 'Editable text in the preview')

    const mountedTargets: MountedTarget[] = targets.map((target) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'playground-text-target'
        button.setAttribute('aria-label', `Edit text: ${target.value}`)
        button.title = 'Double-click to edit'
        const screenReaderText = document.createElement('span')
        screenReaderText.className = 'sr-only'
        screenReaderText.textContent = target.value
        button.append(screenReaderText)
        overlay.append(button)
        return { target, button }
    })

    let disposed = false
    let activeEditor: ActiveEditor | undefined

    function finishEditor(editor: ActiveEditor, save: boolean, restoreFocus: boolean): void {
        if (editor.finishing || activeEditor !== editor) return
        editor.finishing = true
        activeEditor = undefined
        editor.textarea.remove()

        if (save) {
            const value = editor.textarea.value
            if (value !== editor.target.value) {
                const source = api.getSource()
                if (source !== mountedSource || !sourceMatches(source, editor.target)) {
                    api.onError('This text no longer matches the preview source. Run the preview again before editing it.')
                    if (restoreFocus && !disposed) editor.button.focus()
                    return
                }

                const updated = source.slice(0, editor.target.start)
                    + replacementFor(editor.target.kind, value)
                    + source.slice(editor.target.end)
                try {
                    api.saveSource(updated)
                    dispose()
                } catch (error) {
                    api.onError(error instanceof Error ? error.message : 'Could not update the text source.')
                    if (restoreFocus && !disposed) editor.button.focus()
                    return
                }
            } else if (restoreFocus && !disposed) {
                editor.button.focus()
            }
        } else if (restoreFocus && !disposed) {
            editor.button.focus()
        }
    }

    function editorRect(anchor: Rect): Rect {
        const leftLimit = preview.scrollLeft
        const topLimit = preview.scrollTop
        const rightLimit = leftLimit + preview.clientWidth
        const bottomLimit = topLimit + preview.clientHeight
        const width = Math.min(Math.max(MIN_EDITOR_WIDTH, anchor.width), Math.max(0, rightLimit - leftLimit))
        const height = Math.min(Math.max(MIN_EDITOR_HEIGHT, anchor.height), Math.max(0, bottomLimit - topLimit))
        return {
            left: clamp(anchor.left, leftLimit, Math.max(leftLimit, rightLimit - width)),
            top: clamp(anchor.top, topLimit, Math.max(topLimit, bottomLimit - height)),
            width,
            height,
        }
    }

    function openEditor(entry: MountedTarget): void {
        if (disposed || activeEditor || !entry.rect) return
        const source = api.getSource()
        if (source !== mountedSource || !sourceMatches(source, entry.target)) {
            api.onError('This text no longer matches the preview source. Run the preview again before editing it.')
            return
        }

        const textarea = document.createElement('textarea')
        textarea.className = 'playground-text-input'
        textarea.setAttribute('aria-label', `Edit text: ${entry.target.value}`)
        textarea.rows = 1
        textarea.value = entry.target.value
        setCssRect(textarea, editorRect(entry.rect))
        const computed = imageContentRect(image, bounds)
        const scale = bounds.height > 0 ? computed.height / bounds.height : 1
        const fontSize = finite(entry.target.fontSize) && entry.target.fontSize > 0
            ? clamp(entry.target.fontSize * scale, 12, 28)
            : 14
        textarea.style.fontSize = `${fontSize}px`
        if (entry.target.color && CSS.supports('color', entry.target.color)) textarea.style.color = entry.target.color
        overlay.append(textarea)

        const editor: ActiveEditor = { target: entry.target, button: entry.button, textarea, finishing: false }
        activeEditor = editor
        textarea.addEventListener('keydown', (event) => {
            if (event.isComposing) return
            if (event.key === 'Escape') {
                event.preventDefault()
                finishEditor(editor, false, true)
            } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                finishEditor(editor, true, true)
            }
        })
        textarea.addEventListener('blur', () => finishEditor(editor, true, false))
        textarea.focus()
        textarea.select()
    }

    for (const entry of mountedTargets) {
        entry.button.addEventListener('dblclick', (event) => {
            event.preventDefault()
            openEditor(entry)
        })
        entry.button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === 'F2') {
                event.preventDefault()
                openEditor(entry)
            }
        })
    }

    function reposition(): void {
        if (disposed) return
        const previewRect = preview.getBoundingClientRect()
        const imageRect = imageContentRect(image, bounds)
        const boundsRight = bounds.x + bounds.width
        const boundsBottom = bounds.y + bounds.height
        const scaleX = bounds.width > 0 ? imageRect.width / bounds.width : 0
        const scaleY = bounds.height > 0 ? imageRect.height / bounds.height : 0
        const localOriginX = previewRect.left + preview.clientLeft
        const localOriginY = previewRect.top + preview.clientTop
        const visibleLeft = preview.scrollLeft
        const visibleTop = preview.scrollTop
        const visibleRight = visibleLeft + preview.clientWidth
        const visibleBottom = visibleTop + preview.clientHeight

        for (const entry of mountedTargets) {
            const target = entry.target
            if (![bounds.x, bounds.y, bounds.width, bounds.height, target.left, target.top, target.width, target.height].every(finite)
                || bounds.width <= 0 || bounds.height <= 0 || target.width < 0 || target.height < 0) {
                entry.rect = undefined
                entry.button.hidden = true
                continue
            }
            const sourceLeft = Math.max(target.left, bounds.x)
            const sourceTop = Math.max(target.top, bounds.y)
            const sourceRight = Math.min(target.left + target.width, boundsRight)
            const sourceBottom = Math.min(target.top + target.height, boundsBottom)
            if (!scaleX || !scaleY || sourceRight < sourceLeft || sourceBottom < sourceTop) {
                entry.rect = undefined
                entry.button.hidden = true
                continue
            }

            const rawLeft = imageRect.left + (sourceLeft - bounds.x) * scaleX - localOriginX + preview.scrollLeft
            const rawTop = imageRect.top + (sourceTop - bounds.y) * scaleY - localOriginY + preview.scrollTop
            const rawRight = imageRect.left + (sourceRight - bounds.x) * scaleX - localOriginX + preview.scrollLeft
            const rawBottom = imageRect.top + (sourceBottom - bounds.y) * scaleY - localOriginY + preview.scrollTop
            const canvasLeft = imageRect.left - localOriginX + preview.scrollLeft
            const canvasTop = imageRect.top - localOriginY + preview.scrollTop
            const canvasRight = canvasLeft + imageRect.width
            const canvasBottom = canvasTop + imageRect.height
            const clipLeft = Math.max(visibleLeft, canvasLeft)
            const clipTop = Math.max(visibleTop, canvasTop)
            const clipRight = Math.min(visibleRight, canvasRight)
            const clipBottom = Math.min(visibleBottom, canvasBottom)
            const clippedLeft = Math.max(rawLeft, clipLeft)
            const clippedTop = Math.max(rawTop, clipTop)
            const clippedRight = Math.min(rawRight, clipRight)
            const clippedBottom = Math.min(rawBottom, clipBottom)
            if (clippedRight < clippedLeft || clippedBottom < clippedTop) {
                entry.rect = undefined
                entry.button.hidden = true
                continue
            }

            const width = Math.min(clippedRight - clippedLeft + MAX_HIT_EXPANSION, Math.max(0, clipRight - clipLeft))
            const height = Math.min(clippedBottom - clippedTop + MAX_HIT_EXPANSION, Math.max(0, clipBottom - clipTop))
            const desiredWidth = Math.max(clippedRight - clippedLeft, Math.min(MIN_HIT_SIZE, width))
            const desiredHeight = Math.max(clippedBottom - clippedTop, Math.min(MIN_HIT_SIZE, height))
            const hitLeft = clamp((clippedLeft + clippedRight - desiredWidth) / 2, clipLeft, Math.max(clipLeft, clipRight - desiredWidth))
            const hitTop = clamp((clippedTop + clippedBottom - desiredHeight) / 2, clipTop, Math.max(clipTop, clipBottom - desiredHeight))
            entry.rect = { left: hitLeft, top: hitTop, width: desiredWidth, height: desiredHeight }
            entry.button.hidden = false
            setCssRect(entry.button, entry.rect)
        }

        if (activeEditor) {
            const entry = mountedTargets.find(({ target }) => target === activeEditor?.target)
            if (entry?.rect) setCssRect(activeEditor.textarea, editorRect(entry.rect))
        }
    }

    function dispose(): void {
        if (disposed) return
        disposed = true
        if (activeEditor) {
            activeEditor.finishing = true
            activeEditor.textarea.remove()
            activeEditor = undefined
        }
        observer?.disconnect()
        image.removeEventListener('load', reposition)
        preview.removeEventListener('scroll', reposition)
        window.removeEventListener('resize', reposition)
        window.removeEventListener('pagehide', onPageHide)
        overlay.remove()
    }

    function onPageHide(): void {
        dispose()
    }

    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(reposition)
    observer?.observe(preview)
    observer?.observe(image)
    image.addEventListener('load', reposition)
    preview.addEventListener('scroll', reposition, { passive: true })
    window.addEventListener('resize', reposition)
    window.addEventListener('pagehide', onPageHide)
    preview.append(overlay)
    reposition()

    return dispose
}
