/** A few small helpers for building DOM by hand. Strings always become text nodes. */
export type Child = Node | string | number | null | undefined | false | readonly Child[]

export interface Attrs {
    class?: string
    style?: Partial<CSSStyleDeclaration> | Record<string, string>
    title?: string
    [key: string]: unknown
}

function append(parent: globalThis.Node, child: Child): void {
    if (child === null || child === undefined || child === false) return
    if (Array.isArray(child)) {
        for (const entry of child) append(parent, entry as Child)
        return
    }
    if (child instanceof globalThis.Node) parent.appendChild(child)
    else parent.appendChild(document.createTextNode(String(child)))
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag)
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === null || value === false) continue
        if (key === 'class') {
            element.className = String(value)
        } else if (key === 'style') {
            for (const [name, entry] of Object.entries(value as Record<string, string>)) {
                if (name.startsWith('--')) element.style.setProperty(name, entry)
                else (element.style as unknown as Record<string, string>)[name] = entry
            }
        } else if (key.startsWith('on') && typeof value === 'function') {
            element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
        } else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'readOnly' || key === 'selected') {
            ;(element as unknown as Record<string, unknown>)[key] = value
        } else {
            element.setAttribute(key, value === true ? '' : String(value))
        }
    }
    for (const child of children) append(element, child)
    return element
}

export function clear(element: Element): void {
    while (element.firstChild) element.removeChild(element.firstChild)
}

const ICONS: Record<string, string> = {
    play: '<path d="M5 3.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" fill="currentColor" stroke="none"/>',
    start: '<path d="M4 3.5v9M12.5 3.5v9L6 8z"/>',
    end: '<path d="M12 3.5v9M3.5 3.5v9L10 8z"/>',
    back: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
    forward: '<path d="M6 3.5L10.5 8 6 12.5"/>',
    loop: '<path d="M4 6.5A3 3 0 0 1 7 3.5h3.5M12 9.5a3 3 0 0 1-3 3H5.5M9 1.75l1.75 1.75L9 5.25M7 10.75L5.25 12.5 7 14.25"/>',
    undo: '<path d="M5 3L2.5 5.5 5 8M3 5.5h6.5a3.5 3.5 0 0 1 0 7H6"/>',
    redo: '<path d="M11 3l2.5 2.5L11 8M13 5.5H6.5a3.5 3.5 0 0 0 0 7H10"/>',
    eye: '<path d="M1.75 8S4 3.75 8 3.75 14.25 8 14.25 8 12 12.25 8 12.25 1.75 8 1.75 8z"/><circle cx="8" cy="8" r="1.75"/>',
    eyeOff: '<path d="M2.5 2.5l11 11M6.5 3.95A6 6 0 0 1 8 3.75C12 3.75 14.25 8 14.25 8a11 11 0 0 1-2 2.5M9.5 12.05a6 6 0 0 1-1.5.2C4 12.25 1.75 8 1.75 8a11 11 0 0 1 2-2.5"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    unlock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
    plus: '<path d="M8 3.25v9.5M3.25 8h9.5"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5"/>',
    copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M10.5 5.5V3a.5.5 0 0 0-.5-.5H3a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h2.5"/>',
    code: '<path d="M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4"/>',
    export: '<path d="M8 10V2.5M5 5.25L8 2.25l3 3M3 9.5V13h10V9.5"/>',
    share: '<circle cx="4" cy="8" r="1.75"/><circle cx="11.75" cy="3.75" r="1.75"/><circle cx="11.75" cy="12.25" r="1.75"/><path d="M5.5 7.1l4.75-2.5M5.5 8.9l4.75 2.5"/>',
    present: '<rect x="2" y="3" width="12" height="8" rx=".5"/><path d="M8 11v2.5M5.5 13.5h5M7 5.5v3l2.5-1.5z"/>',
    search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13.5 13.5"/>',
    marker: '<path d="M4 2.5v11M4 3h8l-2 2.5 2 2.5H4"/>',
    magnet: '<path d="M3.5 3v5a4.5 4.5 0 0 0 9 0V3h-2.75v5a1.75 1.75 0 0 1-3.5 0V3zM3.5 5.5h2.75M9.75 5.5h2.75"/>',
    alignLeft: '<path d="M2.5 2v12M5 4.5h8v2.5H5zM5 9h5v2.5H5z"/>',
    alignCenterH: '<path d="M8 2v12M3.5 4.5h9v2.5h-9zM5.5 9h5v2.5h-5z"/>',
    alignRight: '<path d="M13.5 2v12M3 4.5h8v2.5H3zM6 9h5v2.5H6z"/>',
    alignTop: '<path d="M2 2.5h12M4.5 5v8h2.5V5zM9 5v5h2.5V5z"/>',
    alignCenterV: '<path d="M2 8h12M4.5 3.5v9h2.5v-9zM9 5.5v5h2.5v-5z"/>',
    alignBottom: '<path d="M2 13.5h12M4.5 3v8h2.5V3zM9 6v5h2.5V6z"/>',
    distributeH: '<path d="M2.5 2v12M13.5 2v12M6.5 4.5h3v7h-3z"/>',
    distributeV: '<path d="M2 2.5h12M2 13.5h12M4.5 6.5h7v3h-7z"/>',
    layers: '<path d="M8 2l6 3.25-6 3.25-6-3.25zM2 8.25L8 11.5l6-3.25M2 11L8 14.25 14 11"/>',
    add: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M8 5.25v5.5M5.25 8h5.5"/>',
    chevron: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
    text: '<path d="M3.5 4.5V3h9v1.5M8 3v10M6.25 13h3.5"/>',
    fit: '<path d="M2.5 5.5v-3h3M13.5 5.5v-3h-3M2.5 10.5v3h3M13.5 10.5v3h-3"/>',
}

/** One of the built-in icons. These strings are static, so they are safe as markup. */
export function icon(name: keyof typeof ICONS | string, size = 16): SVGSVGElement {
    const template = document.createElement('template')
    template.innerHTML = `<svg class="icon" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`
    return template.content.firstElementChild as SVGSVGElement
}

/** Static SVG markup from the app's own tables, such as palette icons. */
export function rawSvg(markup: string): Element {
    const template = document.createElement('template')
    template.innerHTML = markup
    return template.content.firstElementChild as Element
}

export interface IconButtonOptions {
    title: string
    onClick?: (event: MouseEvent) => void
    active?: boolean
    label?: string
    testId?: string
    class?: string
}

export function iconButton(name: string, options: IconButtonOptions): HTMLButtonElement {
    return h('button', {
        type: 'button',
        class: `icon-button${options.active ? ' is-active' : ''}${options.class ? ` ${options.class}` : ''}`,
        title: options.title,
        'aria-label': options.title,
        'data-test': options.testId,
        onClick: options.onClick,
    }, icon(name), options.label ? h('span', {}, options.label) : null)
}

let activePopover: { element: HTMLElement; close: () => void } | null = null

export function closePopover(): void {
    activePopover?.close()
}

export interface PopoverOptions {
    /** Which side of the anchor to prefer. */
    side?: 'below' | 'above' | 'right'
    onClose?: () => void
    class?: string
}

/** Show a floating panel by an element. Clicking elsewhere or pressing Escape closes it. */
export function openPopover(anchor: Element | { x: number; y: number }, content: HTMLElement, options: PopoverOptions = {}): () => void {
    closePopover()
    const panel = h('div', { class: `popover${options.class ? ` ${options.class}` : ''}`, role: 'dialog' }, content)
    document.body.appendChild(panel)
    const place = () => {
        const margin = 8
        const size = panel.getBoundingClientRect()
        const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 }
        const side = options.side ?? 'below'
        let left = side === 'right' ? rect.right + 6 : rect.left
        let top = side === 'above' ? rect.top - size.height - 6 : side === 'right' ? rect.top : rect.bottom + 6
        if (top + size.height > window.innerHeight - margin) top = Math.max(margin, rect.top - size.height - 6)
        if (top < margin) top = margin
        if (left + size.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - size.width - margin)
        panel.style.left = `${Math.round(left)}px`
        panel.style.top = `${Math.round(top)}px`
    }
    place()
    let closed = false
    const close = () => {
        if (closed) return
        closed = true
        panel.remove()
        document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('keydown', onKey, true)
        if (activePopover?.element === panel) activePopover = null
        options.onClose?.()
    }
    const outside = (event: PointerEvent) => {
        if (!panel.contains(event.target as globalThis.Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.stopPropagation()
            event.preventDefault()
            close()
        }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', onKey, true)
    activePopover = { element: panel, close }
    return close
}

export interface ModalOptions {
    title?: string
    class?: string
    onClose?: () => void
    /** Keeps the dialog open when Escape or the backdrop is used. */
    sticky?: () => boolean
}

/** A centered dialog above a dimmed window. */
export function openModal(content: HTMLElement, options: ModalOptions = {}): () => void {
    let closed = false
    const backdrop = h('div', { class: `modal-backdrop${options.class ? ` ${options.class}` : ''}` })
    const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': options.title },
        options.title ? h('header', { class: 'modal-header' }, h('h2', {}, options.title), iconButton('close', { title: 'Close', onClick: () => close() })) : null,
        content)
    backdrop.appendChild(dialog)
    const close = () => {
        if (closed) return
        closed = true
        backdrop.remove()
        document.removeEventListener('keydown', onKey, true)
        options.onClose?.()
    }
    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !options.sticky?.()) {
            event.stopPropagation()
            event.preventDefault()
            close()
        }
    }
    backdrop.addEventListener('pointerdown', (event) => {
        if (event.target === backdrop && !options.sticky?.()) close()
    })
    document.addEventListener('keydown', onKey, true)
    document.body.appendChild(backdrop)
    return close
}

let toastTimer = 0

/** A brief status message at the bottom of the window. */
export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
    let element = document.getElementById('studioToast')
    if (!element) {
        element = h('div', { id: 'studioToast', class: 'toast', role: 'status', 'aria-live': 'polite' })
        document.body.appendChild(element)
    }
    element.textContent = message
    element.classList.toggle('is-error', kind === 'error')
    element.classList.add('is-visible')
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => element.classList.remove('is-visible'), kind === 'error' ? 6000 : 2600)
}

/** Download bytes as a file. */
export function download(bytes: BlobPart, type: string, name: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type }))
    const anchor = h('a', { href: url, download: name, style: { display: 'none' } })
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Track a pointer until release. Capture keeps events flowing after the target is rebuilt. */
export function dragPointer(event: PointerEvent, capture: Element, handlers: { move?: (event: PointerEvent) => void; up?: (event: PointerEvent) => void; cancel?: () => void }): void {
    const id = event.pointerId
    try {
        capture.setPointerCapture(id)
    } catch {
        // Synthetic events may not have an active pointer. Window listeners still work.
    }
    const move = (next: PointerEvent) => {
        if (next.pointerId === id) handlers.move?.(next)
    }
    const end = (next: PointerEvent) => {
        if (next.pointerId !== id) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancel)
        try {
            capture.releasePointerCapture(id)
        } catch {
            // The capture may already be gone.
        }
        handlers.up?.(next)
    }
    const cancel = (next: PointerEvent) => {
        if (next.pointerId !== id) return
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancel)
        handlers.cancel?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', cancel)
}

export function formatTime(seconds: number): string {
    const total = Math.max(0, seconds)
    const m = Math.floor(total / 60)
    const s = total - m * 60
    return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl+'
