import type { App } from './app'
import { BEATS, EASES, naturalEntrance } from './beats'
import { displayName, KINDS, PALETTE, type Field, type PaletteEntry } from './catalog'
import { objectById, VALUE_TRACK, type Beat, type StudioObject } from './model'
import { clear, dragPointer, h, icon, iconButton, openPopover, rawSvg, closePopover } from './ui/dom'
import { fieldControl, type FieldControl, type FieldHost } from './ui/fields'

// ── Left panel: palette and layers ──────────────────────────────────────────

export class LeftPanel {
    readonly element: HTMLElement
    private readonly layers: HTMLElement
    private gestureCount = 0

    constructor(private readonly app: App) {
        this.layers = h('div', { class: 'layer-list', role: 'tree', 'aria-label': 'Layers', 'data-test': 'layers' })
        // Rows capture the pointer for dragging, so the double click lands on the list itself.
        this.layers.addEventListener('dblclick', (event) => {
            const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-layer]')
            const object = row ? objectById(this.app.store.project, row.dataset['layer']!) : undefined
            const label = row?.querySelector<HTMLElement>('.layer-name')
            if (object && label) this.rename(object, label)
        })
        const groups = [...new Set(PALETTE.map((entry) => entry.group))]
        const palette = h('div', { class: 'palette', 'data-test': 'palette' },
            groups.map((group) => h('div', { class: 'palette-group' },
                h('h3', { class: 'panel-label' }, group),
                h('div', { class: 'palette-grid' }, PALETTE.filter((entry) => entry.group === group).map((entry) => this.paletteButton(entry))))))
        this.element = h('aside', { class: 'left-panel', 'aria-label': 'Objects' },
            h('section', { class: 'panel-section is-palette' }, palette),
            h('section', { class: 'panel-section is-fill' },
                h('div', { class: 'panel-head' }, h('h3', { class: 'panel-label' }, 'Layers')),
                this.layers))
    }

    private paletteButton(entry: PaletteEntry): HTMLElement {
        const button = h('button', {
            type: 'button', class: 'palette-item', title: `${entry.label}${entry.key ? ` (${entry.key.toUpperCase()})` : ''}. Click to add, or drag onto the canvas`,
            'data-palette': entry.id,
        }, rawSvg(entry.icon), h('span', {}, entry.label))
        button.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return
            event.preventDefault()
            const startX = event.clientX, startY = event.clientY
            let ghost: HTMLElement | null = null
            dragPointer(event, button, {
                move: (next) => {
                    if (!ghost && Math.hypot(next.clientX - startX, next.clientY - startY) > 4) {
                        ghost = h('div', { class: 'drag-ghost' }, entry.label)
                        document.body.appendChild(ghost)
                    }
                    if (ghost) {
                        ghost.style.transform = `translate(${next.clientX + 10}px, ${next.clientY + 10}px)`
                        ghost.classList.toggle('is-over', this.app.view.containsClient(next.clientX, next.clientY))
                    }
                },
                up: (next) => {
                    const dragged = ghost !== null
                    ghost?.remove()
                    ghost = null
                    if (!dragged) {
                        this.app.addFromPalette(entry)
                    } else if (this.app.view.containsClient(next.clientX, next.clientY)) {
                        this.app.addFromPalette(entry, this.app.view.toStage(next.clientX, next.clientY))
                    }
                },
                cancel: () => {
                    ghost?.remove()
                    ghost = null
                },
            })
        })
        return button
    }

    render(): void {
        const { project, selection } = this.app.store
        clear(this.layers)
        if (project.objects.length === 0) {
            this.layers.appendChild(h('p', { class: 'empty-hint' }, 'Nothing here yet. Pick an object above, or drag one onto the canvas.'))
            return
        }
        const errors = this.app.built?.objectErrors
        for (let i = project.objects.length - 1; i >= 0; i--) {
            const object = project.objects[i]!
            this.layers.appendChild(this.row(object, selection.includes(object.id), errors?.has(object.id) ?? false))
        }
    }

    private row(object: StudioObject, selected: boolean, hasError: boolean): HTMLElement {
        const store = this.app.store
        const name = h('span', { class: 'layer-name' }, displayName(object))
        const row = h('div', {
            class: `layer-row${selected ? ' is-selected' : ''}${object.hidden ? ' is-hidden' : ''}${hasError ? ' has-error' : ''}`,
            role: 'treeitem', 'aria-selected': selected ? 'true' : 'false', 'data-layer': object.id, tabindex: '-1',
        },
        h('span', { class: 'layer-kind' }, (KINDS[object.kind]?.label ?? object.kind).slice(0, 1)),
        name,
        h('button', {
            type: 'button', class: `layer-toggle${object.locked ? ' is-on' : ''}`, title: object.locked ? 'Unlock' : 'Lock', 'aria-label': object.locked ? 'Unlock' : 'Lock',
            onClick: (event: MouseEvent) => {
                event.stopPropagation()
                store.commit((draft) => {
                    const target = objectById(draft, object.id)
                    if (target) target.locked = !target.locked
                })
            },
        }, icon(object.locked ? 'lock' : 'unlock', 13)),
        h('button', {
            type: 'button', class: `layer-toggle${object.hidden ? ' is-on' : ''}`, title: object.hidden ? 'Show' : 'Hide', 'aria-label': object.hidden ? 'Show' : 'Hide',
            onClick: (event: MouseEvent) => {
                event.stopPropagation()
                store.commit((draft) => {
                    const target = objectById(draft, object.id)
                    if (target) target.hidden = !target.hidden
                })
            },
        }, icon(object.hidden ? 'eyeOff' : 'eye', 13)))
        row.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
            const additive = event.shiftKey || event.metaKey || event.ctrlKey
            store.select(additive
                ? store.selection.includes(object.id) ? store.selection.filter((id) => id !== object.id) : [...store.selection, object.id]
                : [object.id])
            const startY = event.clientY
            let moved = false
            const key = `layer:${++this.gestureCount}`
            dragPointer(event, this.layers, {
                move: (next) => {
                    if (!moved && Math.abs(next.clientY - startY) < 4) return
                    moved = true
                    const under = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>('[data-layer]')
                    const overId = under?.dataset['layer']
                    if (!overId || overId === object.id) return
                    store.commit((draft) => {
                        const from = draft.objects.findIndex((entry) => entry.id === object.id)
                        const to = draft.objects.findIndex((entry) => entry.id === overId)
                        if (from < 0 || to < 0) return
                        const [taken] = draft.objects.splice(from, 1)
                        draft.objects.splice(to, 0, taken!)
                    }, { merge: key })
                },
                up: () => store.settle(),
            })
        })
        return row
    }

    private rename(object: StudioObject, label: HTMLElement): void {
        const input = h('input', { class: 'layer-rename', type: 'text', value: object.name, 'aria-label': 'Layer name' })
        label.replaceWith(input)
        input.focus()
        input.select()
        const finish = (save: boolean) => {
            const value = input.value.trim()
            if (save && value && value !== object.name) {
                this.app.store.commit((draft) => {
                    const target = objectById(draft, object.id)
                    if (target) target.name = value
                })
            } else {
                this.render()
            }
        }
        input.addEventListener('blur', () => finish(true), { once: true })
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') input.blur()
            if (event.key === 'Escape') {
                event.stopPropagation()
                input.value = object.name
                input.blur()
            }
        })
    }
}

// ── Right panel: inspector and generated code ───────────────────────────────

const TRANSFORM_FIELDS: readonly (Field & { key: 'x' | 'y' | 'rotation' | 'scale' | 'opacity' })[] = [
    { key: 'x', label: 'X', type: 'number', step: 1, min: -20000, max: 20000 },
    { key: 'y', label: 'Y', type: 'number', step: 1, min: -20000, max: 20000 },
    { key: 'rotation', label: 'Rotate', type: 'number', step: 1, min: -36000, max: 36000 },
    { key: 'scale', label: 'Scale', type: 'number', step: 0.01, min: 0.01, max: 100 },
    { key: 'opacity', label: 'Opacity', type: 'number', step: 0.01, min: 0, max: 1 },
]

/** Curve thumbnail for an easing, as a static path. */
export function easeCurve(name: string, width = 44, height = 28): SVGSVGElement {
    const ease = EASES[name]?.fn
    const points: string[] = []
    const padY = height * 0.2, padX = 2
    for (let i = 0; i <= 28; i++) {
        const t = i / 28
        const y = ease ? ease(t) : t
        points.push(`${(padX + t * (width - padX * 2)).toFixed(1)},${(height - padY - y * (height - padY * 2)).toFixed(1)}`)
    }
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.classList.add('ease-curve')
    const path = document.createElementNS(NS, 'polyline')
    path.setAttribute('points', points.join(' '))
    svg.appendChild(path)
    return svg
}

export class Inspector {
    readonly element: HTMLElement
    private readonly body: HTMLElement
    private readonly tabs: HTMLElement
    private readonly codeTab: HTMLElement
    private controls: FieldControl[] = []
    private signature = ''
    private tab: 'inspect' | 'code' = 'inspect'
    private primary: (() => void) | null = null

    constructor(private readonly app: App) {
        this.body = h('div', { class: 'inspector-body', 'data-test': 'inspector' })
        this.codeTab = h('div', { class: 'inspector-code', hidden: true })
        this.tabs = h('div', { class: 'tabs', role: 'tablist' },
            h('button', { type: 'button', class: 'tab is-active', role: 'tab', 'data-tab': 'inspect', onClick: () => this.setTab('inspect') }, 'Inspect'),
            h('button', { type: 'button', class: 'tab', role: 'tab', 'data-tab': 'code', 'data-test': 'code-tab', onClick: () => this.setTab('code') }, 'Code'))
        this.element = h('aside', { class: 'right-panel', 'aria-label': 'Inspector' }, this.tabs, this.body, this.codeTab)
    }

    get codeSlot(): HTMLElement {
        return this.codeTab
    }

    setTab(tab: 'inspect' | 'code'): void {
        this.tab = tab
        for (const button of Array.from(this.tabs.children)) {
            button.classList.toggle('is-active', (button as HTMLElement).dataset['tab'] === tab)
        }
        this.body.hidden = tab !== 'inspect'
        this.codeTab.hidden = tab !== 'code'
        if (tab === 'code') this.app.codePanel.renderGenerated()
    }

    get codeVisible(): boolean {
        return this.tab === 'code'
    }

    focusPrimaryField(): void {
        this.setTab('inspect')
        this.primary?.()
    }

    showBeat(): void {
        this.setTab('inspect')
    }

    private tokens(): Readonly<Record<string, string>> {
        return this.app.lookColors()
    }

    /** Rebuild when what is selected changes. Otherwise refresh values in place. */
    render(): void {
        const { project, selection, selectedBeat } = this.app.store
        const beat = selectedBeat ? project.beats.find((entry) => entry.id === selectedBeat) : undefined
        const object = selection.length === 1 ? objectById(project, selection[0]!) : undefined
        const signature = [
            beat ? `beat:${beat.id}:${beat.kind}:${beat.ease}` : '',
            object ? `object:${object.id}:${object.kind}` : '',
            selection.length,
            this.app.built?.objectErrors.size ?? 0,
            this.app.built?.beatErrors.size ?? 0,
            object ? project.beats.filter((entry) => entry.target === object.id).map((entry) => `${entry.id}${entry.kind}`).join() : '',
            !object && !beat && selection.length === 0 ? project.variables.map((variable) => variable.name).join() : '',
            project.objects.length,
        ].join('|')
        if (signature !== this.signature) {
            this.signature = signature
            this.rebuild(beat, object)
        } else {
            for (const control of this.controls) control.sync()
        }
    }

    private rebuild(beat: Beat | undefined, object: StudioObject | undefined): void {
        const { project, selection } = this.app.store
        this.controls = []
        this.primary = null
        clear(this.body)
        if (beat) this.body.appendChild(this.beatSection(beat))
        if (selection.length > 1) {
            this.body.appendChild(this.multiSection(selection))
        } else if (object) {
            this.body.appendChild(this.objectSections(object))
        } else if (!beat) {
            this.body.appendChild(this.projectSections())
        }
        void project
    }

    private section(title: string, ...children: (Node | null)[]): HTMLElement {
        return h('section', { class: 'inspector-section' }, h('h3', { class: 'panel-label' }, title), children)
    }

    private addField(parent: HTMLElement, field: Field, host: FieldHost): FieldControl {
        const control = fieldControl(field, host)
        this.controls.push(control)
        parent.appendChild(control.element)
        return control
    }

    private objectHost(id: string, key: string): FieldHost {
        const store = this.app.store
        return {
            read: () => objectById(store.project, id)?.props[key] ?? null,
            write: (value, merge) => store.commit((draft) => {
                const target = objectById(draft, id)
                if (target) target.props[key] = value
            }, merge ? { merge: `${id}:${merge}` } : {}),
            tokens: () => this.tokens(),
            variables: () => store.project.variables.map((variable) => variable.name),
        }
    }

    private objectSections(object: StudioObject): HTMLElement {
        const store = this.app.store
        const def = KINDS[object.kind]
        const wrap = h('div', {})
        const nameInput = h('input', {
            class: 'object-title', type: 'text', value: object.name, 'aria-label': 'Object name', spellcheck: 'false', 'data-test': 'object-name',
            onChange: () => store.commit((draft) => {
                const target = objectById(draft, object.id)
                if (target && nameInput.value.trim()) target.name = nameInput.value.trim()
            }),
        })
        wrap.appendChild(h('header', { class: 'inspector-head' }, nameInput, h('span', { class: 'kind-tag' }, def?.label ?? object.kind)))
        const error = this.app.built?.objectErrors.get(object.id)
        if (error) wrap.appendChild(h('p', { class: 'inspector-error', role: 'alert' }, error))
        const transform = h('div', { class: 'field-grid' })
        for (const field of TRANSFORM_FIELDS) {
            this.addField(transform, field, {
                read: () => objectById(store.project, object.id)?.[field.key] ?? 0,
                write: (value, merge) => store.commit((draft) => {
                    const target = objectById(draft, object.id)
                    if (target) target[field.key] = Number(value)
                }, merge ? { merge: `${object.id}:${merge}` } : {}),
                tokens: () => this.tokens(),
                variables: () => [],
            })
        }
        wrap.appendChild(this.section('Transform', transform))
        if (def) {
            const props = h('div', { class: 'field-stack' })
            for (const field of def.fields) {
                const control = this.addField(props, field, this.objectHost(object.id, field.key))
                if (!this.primary && (field.type === 'longtext' || field.type === 'tex' || field.type === 'expr')) {
                    this.primary = () => control.element.querySelector<HTMLElement>('textarea, input')?.focus()
                }
            }
            wrap.appendChild(this.section(def.label, props))
        }
        wrap.appendChild(this.animationSection(object))
        return wrap
    }

    private animationSection(object: StudioObject): HTMLElement {
        const store = this.app.store
        const beats = store.project.beats.filter((beat) => beat.target === object.id).sort((a, b) => a.start - b.start)
        const list = h('div', { class: 'beat-list' }, beats.map((beat) => h('button', {
            type: 'button', class: `beat-chip group-${(BEATS[beat.kind]?.group ?? 'Change').toLowerCase()}${store.selectedBeat === beat.id ? ' is-selected' : ''}`,
            onClick: () => {
                store.select([object.id], beat.id)
                this.app.seek(beat.start)
            },
        }, h('span', {}, BEATS[beat.kind]?.label ?? beat.kind), h('span', { class: 'beat-time' }, `${beat.start.toFixed(2)}s`))))
        const quick = h('div', { class: 'quick-beats' },
            this.quickKinds(object.kind).map((kind) => h('button', {
                type: 'button', class: 'chip', 'data-quick-beat': kind,
                onClick: () => this.app.addBeat(kind, object.id),
            }, BEATS[kind]!.label)),
            h('button', { type: 'button', class: 'chip is-more', 'data-test': 'more-beats', onClick: (event: MouseEvent) => this.app.openBeatPicker(event.currentTarget as HTMLElement, object.id) }, 'More'))
        return this.section('Animation', beats.length ? list : h('p', { class: 'field-help' }, 'Visible from the start. Add an entrance to bring it in.'), quick)
    }

    /** The object's own entrance goes first, with the common ones after it. */
    private quickKinds(kind: string): string[] {
        const list = [naturalEntrance(kind), 'write', 'draw', 'fadeIn', 'grow']
        return [...new Set(list)].slice(0, 4)
    }

    private beatSection(beat: Beat): HTMLElement {
        const store = this.app.store
        const def = BEATS[beat.kind]
        const updateBeat = (change: (target: Beat) => void, merge?: string) => store.commit((draft) => {
            const target = draft.beats.find((entry) => entry.id === beat.id)
            if (target) change(target)
        }, merge ? { merge: `${beat.id}:${merge}` } : {})
        const grid = h('div', { class: 'field-grid' })
        this.addField(grid, { key: 'start', label: 'Start', type: 'number', step: 0.05, min: 0, max: 3600 }, {
            read: () => store.project.beats.find((entry) => entry.id === beat.id)?.start ?? 0,
            write: (value, merge) => updateBeat((target) => {
                target.start = Number(value)
            }, merge),
            tokens: () => this.tokens(), variables: () => [],
        })
        if (!def?.instant) {
            this.addField(grid, { key: 'duration', label: 'Length', type: 'number', step: 0.05, min: 0.05, max: 3600 }, {
                read: () => store.project.beats.find((entry) => entry.id === beat.id)?.duration ?? 0,
                write: (value, merge) => updateBeat((target) => {
                    target.duration = Number(value)
                }, merge),
                tokens: () => this.tokens(), variables: () => [],
            })
        }
        const stack = h('div', { class: 'field-stack' })
        for (const field of def?.fields ?? []) {
            this.addField(stack, field, {
                read: () => store.project.beats.find((entry) => entry.id === beat.id)?.params[field.key] ?? null,
                write: (value, merge) => updateBeat((target) => {
                    target.params[field.key] = value
                }, merge ? `${field.key}:${merge}` : undefined),
                tokens: () => this.tokens(),
                variables: () => store.project.variables.map((variable) => variable.name),
                options: field.type === 'select' && field.options?.length === 0 ? () => this.dynamicOptions(field.key, beat) : undefined,
            })
        }
        const error = this.app.built?.beatErrors.get(beat.id)
        const easeButton = def?.eases ? h('button', {
            type: 'button', class: 'field-input ease-button', 'data-test': 'ease-button', 'aria-label': 'Easing',
            onClick: () => this.openEasePicker(easeButton!, beat),
        }, easeCurve(beat.ease, 30, 18), EASES[beat.ease]?.label ?? beat.ease) : null
        return h('div', { class: 'beat-inspector' },
            h('header', { class: 'inspector-head' },
                h('strong', { class: 'beat-name' }, def?.label ?? beat.kind),
                h('span', { class: `kind-tag group-${(def?.group ?? 'Change').toLowerCase()}` }, def?.group ?? ''),
                h('span', { class: 'head-actions' },
                    iconButton('play', { title: 'Preview this beat', testId: 'preview-beat', onClick: () => this.app.previewBeat(beat.id) }),
                    iconButton('trash', { title: 'Delete this beat (Delete)', testId: 'delete-beat', onClick: () => this.app.deleteBeat(beat.id) }))),
            error ? h('p', { class: 'inspector-error', role: 'alert' }, error) : null,
            this.section('Timing', grid, easeButton ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Easing'), h('div', { class: 'field-control' }, easeButton)) : null),
            def?.fields.length ? this.section('Settings', stack) : null)
    }

    private dynamicOptions(key: string, beat: Beat): readonly (readonly [string, string])[] {
        const project = this.app.store.project
        if (key === 'variable') return project.variables.map((variable) => [variable.name, variable.name] as const)
        return project.objects.filter((object) => object.id !== beat.target).map((object) => [object.id, object.name] as const)
    }

    private openEasePicker(anchor: HTMLElement, beat: Beat): void {
        const grid = h('div', { class: 'ease-grid', 'data-test': 'ease-grid' }, Object.values(EASES).map((ease) => h('button', {
            type: 'button', class: `ease-option${beat.ease === ease.name ? ' is-current' : ''}`, 'data-ease': ease.name, title: ease.label,
            onClick: () => {
                this.app.store.commit((draft) => {
                    const target = draft.beats.find((entry) => entry.id === beat.id)
                    if (target) target.ease = ease.name
                })
                closePopover()
                this.app.previewBeat(beat.id)
            },
        }, easeCurve(ease.name), h('span', {}, ease.label))))
        openPopover(anchor, grid, { side: 'below', class: 'ease-popover' })
    }

    private multiSection(ids: readonly string[]): HTMLElement {
        const app = this.app
        return h('div', {},
            h('header', { class: 'inspector-head' }, h('strong', { class: 'beat-name' }, `${ids.length} objects`)),
            this.section('Align',
                h('div', { class: 'button-row', 'data-test': 'align' },
                    iconButton('alignLeft', { title: 'Align left', testId: 'align-left', onClick: () => app.align('left') }),
                    iconButton('alignCenterH', { title: 'Align horizontal centers', testId: 'align-center', onClick: () => app.align('centerX') }),
                    iconButton('alignRight', { title: 'Align right', testId: 'align-right', onClick: () => app.align('right') }),
                    iconButton('alignTop', { title: 'Align top', testId: 'align-top', onClick: () => app.align('top') }),
                    iconButton('alignCenterV', { title: 'Align vertical centers', testId: 'align-middle', onClick: () => app.align('centerY') }),
                    iconButton('alignBottom', { title: 'Align bottom', testId: 'align-bottom', onClick: () => app.align('bottom') })),
                h('div', { class: 'button-row' },
                    iconButton('distributeH', { title: 'Distribute horizontally', testId: 'distribute-h', onClick: () => app.distribute('x') }),
                    iconButton('distributeV', { title: 'Distribute vertically', testId: 'distribute-v', onClick: () => app.distribute('y') }))),
            this.section('Animate together',
                h('div', { class: 'quick-beats' }, ['write', 'draw', 'fadeIn', 'grow', 'fadeOut'].map((kind) => h('button', {
                    type: 'button', class: 'chip', onClick: () => {
                        for (const id of ids) app.addBeat(kind, id, { preview: false })
                    },
                }, BEATS[kind]!.label)))))
    }

    private projectSections(): HTMLElement {
        const store = this.app.store
        const project = store.project
        const nameInput = h('input', {
            class: 'object-title', type: 'text', value: project.name, 'aria-label': 'Project name', spellcheck: 'false', 'data-test': 'inspector-project-name',
            onChange: () => this.app.renameProject(nameInput.value),
        })
        const settings = h('div', { class: 'field-stack' })
        this.addField(settings, { key: 'hold', label: 'Hold at end', type: 'number', min: 0, max: 120, step: 0.1, help: 'Seconds after the last beat' }, {
            read: () => store.project.hold,
            write: (value, merge) => store.commit((draft) => {
                draft.hold = Number(value)
            }, merge ? { merge: `project:${merge}` } : {}),
            tokens: () => this.tokens(), variables: () => [],
        })
        this.addField(settings, { key: 'fps', label: 'Frame rate', type: 'select', options: [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']] }, {
            read: () => String(store.project.fps),
            write: (value) => store.commit((draft) => {
                draft.fps = Number(value)
            }),
            tokens: () => this.tokens(), variables: () => [],
        })
        const variables = h('div', { class: 'variable-list', 'data-test': 'variables' })
        project.variables.forEach((variable) => {
            const row = h('div', { class: 'variable-row' }, h('code', {}, variable.name))
            const holder = h('div', { class: 'field-stack' })
            this.addField(holder, { key: `var-${variable.name}`, label: 'Value', type: 'number', step: 0.1, min: -1e6, max: 1e6 }, {
                read: () => store.project.variables.find((entry) => entry.name === variable.name)?.value ?? 0,
                write: (value, merge) => store.commit((draft) => {
                    const target = draft.variables.find((entry) => entry.name === variable.name)
                    if (target) target.value = Number(value)
                }, merge ? { merge: `var:${variable.name}:${merge}` } : {}),
                tokens: () => this.tokens(), variables: () => [],
            })
            row.append(holder, iconButton('trash', {
                title: `Delete ${variable.name}`, onClick: () => store.commit((draft) => {
                    draft.variables = draft.variables.filter((entry) => entry.name !== variable.name)
                    draft.beats = draft.beats.filter((beat) => !(beat.target === VALUE_TRACK && beat.params['variable'] === variable.name))
                }),
            }))
            variables.appendChild(row)
        })
        const newVariable = h('input', { class: 'field-input mono', type: 'text', placeholder: 'New variable, such as h', spellcheck: 'false', 'aria-label': 'New variable name', 'data-test': 'new-variable' })
        newVariable.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return
            if (this.app.addVariable(newVariable.value.trim())) newVariable.value = ''
        })
        return h('div', {},
            h('header', { class: 'inspector-head' }, nameInput, h('span', { class: 'kind-tag' }, 'Project')),
            this.section('Film', settings),
            this.section('Variables', variables, newVariable, h('p', { class: 'field-help' }, 'Graphs and readouts can read variables, and Tween value animates them.')))
    }
}

