import { highlightPlaygroundSource } from '../playground-highlight'
import type { App } from './app'
import { h, icon, toast } from './ui/dom'

export interface CodeProblem {
    message: string
    line?: number
    column?: number
}

/** A plain text editor with syntax color, line numbers, and an error marker. */
export class CodeEditor {
    readonly element: HTMLElement
    readonly textarea: HTMLTextAreaElement
    private readonly highlight: HTMLElement
    private readonly gutter: HTMLElement
    private problem: CodeProblem | null = null

    constructor(private readonly options: { readOnly?: boolean; onChange?: (value: string) => void } = {}) {
        this.textarea = h('textarea', {
            class: 'code-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: 'off', 'aria-label': 'Film source',
            'data-test': options.readOnly ? 'generated-code' : 'code-editor', readOnly: options.readOnly ?? false,
        })
        this.highlight = h('pre', { class: 'code-highlight', 'aria-hidden': 'true' })
        this.gutter = h('div', { class: 'code-gutter', 'aria-hidden': 'true' })
        this.element = h('div', { class: 'code-editor' }, this.gutter, h('div', { class: 'code-body' }, this.highlight, this.textarea))
        this.textarea.addEventListener('input', () => {
            this.paint()
            this.options.onChange?.(this.textarea.value)
        })
        this.textarea.addEventListener('scroll', () => this.syncScroll())
        this.textarea.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                event.preventDefault()
                const { selectionStart: start, selectionEnd: end, value } = this.textarea
                this.textarea.value = `${value.slice(0, start)}    ${value.slice(end)}`
                this.textarea.selectionStart = this.textarea.selectionEnd = start + 4
                this.paint()
                this.options.onChange?.(this.textarea.value)
            }
        })
    }

    get value(): string {
        return this.textarea.value
    }

    set value(text: string) {
        if (this.textarea.value === text) return
        const { scrollTop } = this.textarea
        this.textarea.value = text
        this.paint()
        this.textarea.scrollTop = scrollTop
        this.syncScroll()
    }

    setProblem(problem: CodeProblem | null): void {
        this.problem = problem
        this.paint()
    }

    private paint(): void {
        const source = this.textarea.value
        // The highlighter escapes all source text before it adds spans.
        this.highlight.innerHTML = `${highlightPlaygroundSource(source)}\n`
        const lines = source.split('\n').length
        const fragment = document.createDocumentFragment()
        for (let i = 1; i <= lines; i++) {
            fragment.appendChild(h('div', { class: `code-line-number${this.problem?.line === i ? ' has-error' : ''}` }, String(i)))
        }
        this.gutter.replaceChildren(fragment)
        this.syncScroll()
    }

    private syncScroll(): void {
        this.highlight.style.transform = `translate(${-this.textarea.scrollLeft}px, ${-this.textarea.scrollTop}px)`
        this.gutter.style.transform = `translateY(${-this.textarea.scrollTop}px)`
    }

    revealLine(line: number): void {
        const height = parseFloat(getComputedStyle(this.textarea).lineHeight) || 18
        this.textarea.scrollTop = Math.max(0, (line - 4) * height)
    }
}

/** Generated source beside the visual editor, and the hand-written editor in code mode. */
export class CodePanel {
    readonly generated: CodeEditor
    readonly writer: CodeEditor
    readonly writerElement: HTMLElement
    private readonly generatedElement: HTMLElement
    private readonly problemLine: HTMLElement
    private readonly logs: HTMLElement
    private readonly pausedBanner: HTMLElement

    constructor(private readonly app: App) {
        this.generated = new CodeEditor({ readOnly: true })
        this.generatedElement = h('div', { class: 'generated-code' },
            h('div', { class: 'code-bar' },
                h('span', { class: 'panel-label' }, 'film.tsx'),
                h('span', { class: 'tl-spacer' }),
                h('button', { type: 'button', class: 'text-button', 'data-test': 'copy-code', onClick: () => this.copyGenerated() }, icon('copy', 14), 'Copy'),
                h('button', { type: 'button', class: 'text-button', 'data-test': 'edit-as-code', onClick: () => this.app.setMode('code') }, icon('code', 14), 'Edit')),
            this.generated.element)
        this.writer = new CodeEditor({ onChange: (value) => this.app.onSourceEdited(value) })
        this.problemLine = h('div', { class: 'code-problem', role: 'alert', hidden: true, 'data-test': 'code-error' })
        this.logs = h('div', { class: 'code-logs', role: 'log', 'aria-label': 'Film output', 'data-test': 'code-logs' })
        this.pausedBanner = h('div', { class: 'code-paused', hidden: true, 'data-test': 'code-paused' },
            h('span', {}, 'This link includes code. It stays paused until you run it, and it runs in a sandbox with no access to this site.'),
            h('button', { type: 'button', class: 'text-button is-accent', 'data-test': 'run-shared-code', onClick: () => this.app.resumeSharedCode() }, icon('play', 14), 'Run'))
        this.writerElement = h('section', { class: 'code-pane', 'aria-label': 'Film source editor' },
            h('div', { class: 'code-bar' },
                h('span', { class: 'panel-label' }, 'film.tsx'),
                h('span', { class: 'code-note' }, 'Imports from vizmatic/stage. Runs in a sandbox as you type.'),
                h('span', { class: 'tl-spacer' }),
                h('button', { type: 'button', class: 'text-button', 'data-test': 'regenerate', title: 'Replace this source with code generated from the visual project', onClick: () => this.app.regenerateSource() }, 'From visual')),
            this.pausedBanner,
            this.writer.element,
            this.problemLine,
            this.logs)
        this.app.inspector.codeSlot.appendChild(this.generatedElement)
    }

    /** Refresh the read-only view when it is on screen. */
    renderGenerated(): void {
        if (!this.app.inspector.codeVisible) return
        this.generated.value = this.app.generatedSource()
    }

    private async copyGenerated(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.app.generatedSource())
            toast('Copied film.tsx')
        } catch {
            toast('The browser blocked clipboard access. Select the text and copy it.', 'error')
        }
    }

    setPaused(paused: boolean): void {
        this.pausedBanner.hidden = !paused
    }

    showProblem(problem: CodeProblem | null): void {
        this.writer.setProblem(problem)
        this.problemLine.hidden = !problem
        this.problemLine.textContent = problem ? `${problem.line ? `Line ${problem.line}${problem.column ? `:${problem.column}` : ''}  ` : ''}${problem.message}` : ''
        if (problem?.line) this.problemLine.dataset['line'] = String(problem.line)
        else delete this.problemLine.dataset['line']
    }

    log(level: string, text: string): void {
        const line = h('div', { class: `code-log is-${level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'}` }, text)
        this.logs.appendChild(line)
        while (this.logs.childElementCount > 200) this.logs.firstElementChild?.remove()
        this.logs.scrollTop = this.logs.scrollHeight
    }

    clearLogs(): void {
        this.logs.replaceChildren()
    }
}
