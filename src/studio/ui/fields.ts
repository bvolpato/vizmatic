import { buildOps, css, parseColor, paintFrame, Suspend, tex, type Rgba } from '../../stage/index'
import type { Field } from '../catalog'
import { exprProblem } from '../expr'
import type { PropValue } from '../model'
import { clear, closePopover, dragPointer, h, openPopover } from './dom'

export const COLOR_TOKENS = ['ink', 'dim', 'faint', 'surface', 'blue', 'teal', 'green', 'yellow', 'gold', 'orange', 'red', 'pink', 'purple'] as const

export interface FieldHost {
    read(): PropValue
    /** Save a value. A merge key folds a continuous gesture into one undo step. */
    write(value: PropValue, merge?: string): void
    /** Named colors in the project's current look. */
    tokens(): Readonly<Record<string, string>>
    /** Variables an expression may read. */
    variables(): readonly string[]
    /** Choices for a select whose options depend on the project. */
    options?(): readonly (readonly [string, string])[]
    problem?(): string | null
}

export interface FieldControl {
    element: HTMLElement
    /** Refresh from the document without disturbing a control the user is typing in. */
    sync(): void
}

let gesture = 0

function fieldRow(label: HTMLElement | string, control: HTMLElement, full = false, help?: string): HTMLElement {
    return h('div', { class: `field${full ? ' is-full' : ''}` },
        typeof label === 'string' ? h('span', { class: 'field-label' }, label) : label,
        h('div', { class: 'field-control' }, control),
        help ? h('p', { class: 'field-help' }, help) : null)
}

function formatNumber(value: number, step: number): string {
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3
    const text = value.toFixed(Math.max(decimals, Number.isInteger(value) ? 0 : Math.min(3, decimals + 1)))
    return text.includes('.') ? text.replace(/\.?0+$/, '') : text
}

/** A number box whose label scrubs the value when dragged. Arrow keys nudge it. */
export function numberControl(field: Field, host: FieldHost): FieldControl {
    const step = field.step ?? 1
    const clamp = (value: number) => Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, value))
    const round = (value: number) => Math.round(value * 1000) / 1000
    const input = h('input', { class: 'field-input num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': field.label, 'data-field': field.key })
    const sync = () => {
        if (document.activeElement !== input) input.value = formatNumber(Number(host.read()) || 0, step)
    }
    const commit = () => {
        const value = Number(input.value)
        if (Number.isFinite(value) && input.value.trim() !== '') host.write(round(clamp(value)))
        else sync()
    }
    input.addEventListener('change', commit)
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            commit()
            input.blur()
        } else if (event.key === 'Escape') {
            input.value = formatNumber(Number(host.read()) || 0, step)
            input.blur()
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const delta = (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
            const next = round(clamp((Number(input.value) || 0) + delta))
            input.value = formatNumber(next, step)
            host.write(next, `nudge:${field.key}`)
        }
    })
    const label = h('span', { class: 'field-label is-scrub', title: 'Drag to change' }, field.label)
    label.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        const start = Number(host.read()) || 0
        const startX = event.clientX
        const key = `scrub:${field.key}:${++gesture}`
        document.body.classList.add('is-scrubbing')
        dragPointer(event, label, {
            move(next) {
                const speed = next.shiftKey ? 10 : next.altKey ? 0.1 : 1
                const value = round(clamp(start + Math.round((next.clientX - startX) / 2) * step * speed))
                host.write(value, key)
                input.value = formatNumber(value, step)
            },
            up() {
                document.body.classList.remove('is-scrubbing')
            },
            cancel() {
                document.body.classList.remove('is-scrubbing')
            },
        })
    })
    sync()
    return { element: fieldRow(label, input, false, field.help), sync }
}

function textControl(field: Field, host: FieldHost, multiline: boolean): FieldControl {
    const input = multiline
        ? h('textarea', { class: 'field-input', rows: '2', spellcheck: 'false', 'aria-label': field.label, 'data-field': field.key })
        : h('input', { class: 'field-input', type: 'text', spellcheck: 'false', 'aria-label': field.label, 'data-field': field.key })
    const key = `text:${field.key}:${++gesture}`
    const sync = () => {
        if (document.activeElement !== input) input.value = String(host.read() ?? '')
    }
    input.addEventListener('input', () => host.write(input.value, key))
    sync()
    return { element: fieldRow(field.label, input, multiline), sync }
}

/** Equation input: a live preview drawn with the engine, and an inline message for bad TeX. */
function texControl(field: Field, host: FieldHost): FieldControl {
    const input = h('textarea', { class: 'field-input mono', rows: '3', spellcheck: 'false', 'aria-label': field.label, 'data-field': field.key })
    const preview = h('canvas', { class: 'tex-preview', width: '520', height: '150' })
    const problem = h('p', { class: 'field-error', role: 'alert', hidden: true })
    const key = `tex:${field.key}:${++gesture}`
    let token = 0
    const render = async (source: string) => {
        const mine = ++token
        const ctx = preview.getContext('2d')!
        for (let attempt = 0; attempt < 4; attempt++) {
            try {
                const node = tex(source || '{}', { size: 54, color: host.tokens()['ink'] ?? '#ffffff' })
                const b = node.bounds()
                const ops = buildOps(node, { x: b.x + b.width / 2, y: b.y + b.height / 2, zoom: Math.min(1, (preview.width - 40) / Math.max(1, b.width), (preview.height - 30) / Math.max(1, b.height)), rotation: 0 }, preview.width, preview.height)
                paintFrame(ctx, { width: preview.width, height: preview.height, background: null, bloom: 0, dark: true, ops }, 1)
                problem.hidden = true
                problem.textContent = ''
                return
            } catch (error) {
                if (error instanceof Suspend) {
                    await error.promise
                    if (mine !== token) return
                    continue
                }
                problem.hidden = false
                problem.textContent = error instanceof Error ? error.message : String(error)
                return
            }
        }
    }
    const sync = () => {
        if (document.activeElement !== input) {
            const value = String(host.read() ?? '')
            if (input.value !== value) {
                input.value = value
                void render(value)
            }
        }
    }
    input.addEventListener('input', () => {
        host.write(input.value, key)
        void render(input.value)
    })
    input.value = String(host.read() ?? '')
    void render(input.value)
    const body = h('div', { class: 'tex-field' }, input, preview, problem)
    return { element: fieldRow(field.label, body, true), sync }
}

/** Function input, parsed by the safe expression language with a message on each keystroke. */
function exprControl(field: Field, host: FieldHost): FieldControl {
    const input = h('input', { class: 'field-input mono', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': field.label, 'data-field': field.key })
    const problem = h('p', { class: 'field-error', role: 'alert', hidden: true })
    const key = `expr:${field.key}:${++gesture}`
    const check = () => {
        const message = input.value.trim() ? exprProblem(input.value, [...(field.scope ?? []), ...host.variables()]) : null
        problem.hidden = !message
        problem.textContent = message ?? ''
        input.classList.toggle('is-invalid', !!message)
        return !message
    }
    const sync = () => {
        if (document.activeElement !== input) {
            input.value = String(host.read() ?? '')
            check()
        }
    }
    input.addEventListener('input', () => {
        // A half-typed expression stays in the box and does not disturb the film.
        if (check() && input.value.trim()) host.write(input.value, key)
    })
    input.value = String(host.read() ?? '')
    check()
    return { element: fieldRow(field.label, h('div', { class: 'expr-field' }, input, problem), false, field.help), sync }
}

function selectControl(field: Field, host: FieldHost): FieldControl {
    const select = h('select', { class: 'field-input', 'aria-label': field.label, 'data-field': field.key })
    const fill = () => {
        const options = host.options?.() ?? field.options ?? []
        const current = String(host.read() ?? '')
        clear(select)
        if (current === '' || !options.some(([value]) => value === current)) {
            select.appendChild(h('option', { value: current, selected: true, disabled: true }, current === '' ? 'Choose...' : current))
        }
        for (const [value, label] of options) select.appendChild(h('option', { value, selected: value === current }, label))
    }
    select.addEventListener('change', () => host.write(select.value))
    fill()
    return {
        element: fieldRow(field.label, select, false, field.help),
        sync() {
            if (document.activeElement !== select) fill()
        },
    }
}

function boolControl(field: Field, host: FieldHost): FieldControl {
    const input = h('input', { type: 'checkbox', class: 'switch', 'aria-label': field.label, 'data-field': field.key })
    input.addEventListener('change', () => host.write(input.checked))
    const sync = () => {
        input.checked = Boolean(host.read())
    }
    sync()
    return { element: fieldRow(field.label, input, false, field.help), sync }
}

function swatchColor(value: string, tokens: Readonly<Record<string, string>>): string {
    try {
        const rgba: Rgba = parseColor(tokens[value] ?? value)
        return css(rgba)
    } catch {
        return 'transparent'
    }
}

/** Look colors as a palette, so a project re-themes as a whole. Custom CSS colors also work. */
export function colorControl(field: Field, host: FieldHost): FieldControl {
    const swatch = h('span', { class: 'swatch' })
    const name = h('span', { class: 'color-name' })
    const button = h('button', { type: 'button', class: 'field-input color-button', 'aria-label': `${field.label} color`, 'data-field': field.key }, swatch, name)
    const sync = () => {
        const value = host.read()
        if (value === null || value === '') {
            swatch.style.background = 'transparent'
            swatch.classList.add('is-none')
            name.textContent = 'None'
        } else {
            swatch.classList.remove('is-none')
            swatch.style.background = swatchColor(String(value), host.tokens())
            name.textContent = String(value)
        }
    }
    button.addEventListener('click', () => {
        const tokens = host.tokens()
        const current = host.read()
        const hex = h('input', {
            class: 'field-input mono', type: 'text', placeholder: '#ffffff or any CSS color', spellcheck: 'false',
            'aria-label': 'Custom color', value: typeof current === 'string' && !(current in tokens) ? current : '',
        })
        const message = h('p', { class: 'field-error', hidden: true })
        hex.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return
            try {
                parseColor(hex.value.trim())
                message.hidden = true
                host.write(hex.value.trim())
                sync()
                closePopover()
            } catch {
                message.hidden = false
                message.textContent = 'That is not a color.'
            }
        })
        const grid = h('div', { class: 'color-grid' },
            COLOR_TOKENS.map((token) => h('button', {
                type: 'button', class: `color-chip${current === token ? ' is-current' : ''}`, title: token, 'aria-label': token, 'data-color': token,
                style: { background: swatchColor(token, tokens) },
                onClick: () => {
                    host.write(token)
                    sync()
                    closePopover()
                },
            })),
            field.nullable ? h('button', {
                type: 'button', class: 'color-chip is-none', title: 'None', 'aria-label': 'No color', 'data-color': 'none',
                onClick: () => {
                    host.write(null)
                    sync()
                    closePopover()
                },
            }) : null)
        openPopover(button, h('div', { class: 'color-popover' }, grid, hex, message))
    })
    sync()
    return { element: fieldRow(field.label, button), sync }
}

export function fieldControl(field: Field, host: FieldHost): FieldControl {
    switch (field.type) {
        case 'number': return numberControl(field, host)
        case 'text': return textControl(field, host, false)
        case 'longtext': return textControl(field, host, true)
        case 'tex': return texControl(field, host)
        case 'expr': return exprControl(field, host)
        case 'select': return selectControl(field, host)
        case 'bool': return boolControl(field, host)
        case 'color': return colorControl(field, host)
    }
}
