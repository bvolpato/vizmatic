import { LOOKS, type Aspect, type LookName } from '../stage/index'
import { compileProject, type StudioFilm } from './compile'
import { projectToSource } from './codegen'
import { BEATS, BEAT_GROUPS, naturalEntrance } from './beats'
import { defaultProps, KINDS, PALETTE, type PaletteEntry } from './catalog'
import { compileSource } from './compile-code'
import { CodePanel } from './code-panel'
import { openCommandPalette, openExportDialog, openShareDialog, openShortcuts, openWelcome, type Command } from './dialogs'
import { exportFilm, type ExportProgress, type ExportResult, type ExportSettings } from './export'
import {
    beatEnd, createId, emptyProject, LIMITS, objectById, projectDuration, round3, VALUE_TRACK,
    type Beat, type ObjectProps, type ProjectMode, type StudioObject, type StudioProject,
} from './model'
import { Inspector, LeftPanel } from './panels'
import { decodeShare, encodeShare, normalizeProject, SHARE_KEY } from './project'
import { SandboxHost, type SandboxInfo } from './sandbox-host'
import { isTyping, StageView, activeMoveBeat } from './stage-view'
import { Store } from './store'
import { Timeline } from './timeline'
import { Transport } from './transport'
import { closePopover, download, dragPointer, h, icon, iconButton, isMac, MOD, openPopover, toast } from './ui/dom'

const AUTOSAVE_KEY = 'vizmatic-studio-autosave-v1'
const BACKUP_KEY = 'vizmatic-studio-backup-v1'
const PREFS_KEY = 'vizmatic-studio-prefs-v1'

const ASPECT_SIZES: Record<Aspect, [number, number]> = {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2520, 1080],
}

interface Prefs {
    left: number
    right: number
    bottom: number
    code: number
}

function loadPrefs(): Prefs {
    const fallback: Prefs = { left: 232, right: 288, bottom: 252, code: 560 }
    try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>
        return {
            left: clampPref(saved.left, 180, 420, fallback.left),
            right: clampPref(saved.right, 220, 520, fallback.right),
            bottom: clampPref(saved.bottom, 120, 600, fallback.bottom),
            code: clampPref(saved.code, 320, 1200, fallback.code),
        }
    } catch {
        return fallback
    }
}

function isEmptyProject(project: StudioProject): boolean {
    return project.objects.length === 0 && project.source.trim() === ''
}

function clampPref(value: unknown, min: number, max: number, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

/** The whole application: document, film, panels, and the commands between them. */
export class App {
    readonly store = new Store()
    readonly root: HTMLElement
    readonly view: StageView
    readonly timeline: Timeline
    readonly left: LeftPanel
    readonly inspector: Inspector
    readonly codePanel: CodePanel
    readonly transport: Transport
    built: StudioFilm | null = null
    snapping = true
    presenting = false
    looping = false
    private readonly assetBase: string
    private readonly fontBase: string
    private compileQueued = false
    private compileToken = 0
    private pendingPreview: string | null = null
    private autosaveTimer = 0
    private generatedCache: { project: StudioProject; source: string } | null = null
    private sandbox: SandboxHost | null = null
    private sandboxInfo: SandboxInfo | null = null
    private codeTimer = 0
    private codePaused = false
    private clipboard: StudioObject[] = []
    private exporting = false
    private readonly prefs = loadPrefs()
    private appliedMode: ProjectMode | null = null
    private readonly nameInput: HTMLInputElement
    private readonly lookSelect: HTMLSelectElement
    private readonly aspectSelect: HTMLSelectElement
    private readonly undoButton: HTMLButtonElement
    private readonly redoButton: HTMLButtonElement
    private readonly modeButtons: Record<ProjectMode, HTMLButtonElement>
    private readonly presentHud: HTMLElement

    constructor(assetBase: string) {
        this.assetBase = assetBase
        this.fontBase = new URL('assets/', assetBase).href
        this.view = new StageView(this)
        this.timeline = new Timeline(this)
        this.left = new LeftPanel(this)
        this.inspector = new Inspector(this)
        this.codePanel = new CodePanel(this)
        this.transport = new Transport(this.view.canvas, {
            onTime: () => this.onTime(),
            onState: () => this.onPlayState(),
        })
        this.nameInput = h('input', {
            class: 'project-name', type: 'text', 'aria-label': 'Project name', spellcheck: 'false', 'data-test': 'project-name',
            onChange: () => this.renameProject(this.nameInput.value),
            onKeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter') this.nameInput.blur()
            },
        })
        this.lookSelect = h('select', {
            class: 'bar-select', title: 'Look: colors and light for the whole film', 'aria-label': 'Look', 'data-test': 'look',
            onChange: () => this.setLook(this.lookSelect.value as LookName),
        }, Object.keys(LOOKS).map((name) => h('option', { value: name }, name[0]!.toUpperCase() + name.slice(1))))
        this.aspectSelect = h('select', {
            class: 'bar-select', title: 'Frame shape', 'aria-label': 'Aspect ratio', 'data-test': 'aspect',
            onChange: () => this.store.commit((draft) => {
                draft.aspect = this.aspectSelect.value as Aspect
            }),
        }, ['16:9', '9:16', '1:1', '4:3', '21:9'].map((aspect) => h('option', { value: aspect }, aspect)))
        this.undoButton = iconButton('undo', { title: `Undo (${MOD}Z)`, testId: 'undo', onClick: () => this.store.undo() })
        this.redoButton = iconButton('redo', { title: `Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z'})`, testId: 'redo', onClick: () => this.store.redo() })
        this.modeButtons = {
            visual: h('button', { type: 'button', class: 'segment', 'data-test': 'mode-visual', onClick: () => this.setMode('visual') }, 'Visual'),
            code: h('button', { type: 'button', class: 'segment', 'data-test': 'mode-code', onClick: () => this.setMode('code') }, 'Code'),
        }
        const fileButton = h('button', {
            type: 'button', class: 'text-button', 'data-test': 'file-menu', 'aria-haspopup': 'menu',
            onClick: () => this.openFileMenu(fileButton),
        }, 'File', icon('chevron', 12))
        const brand = h('a', { class: 'studio-brand', href: 'index.html', title: 'Vizmatic home' },
            h('img', { src: 'assets/icon.svg', alt: '', width: '20', height: '20' }),
            h('span', {}, 'Studio'))
        const topbar = h('header', { class: 'topbar' },
            h('div', { class: 'topbar-left' }, brand, fileButton, this.undoButton, this.redoButton, h('span', { class: 'bar-divider' }), this.nameInput),
            h('div', { class: 'topbar-center' },
                h('div', { class: 'segmented', role: 'group', 'aria-label': 'Editing mode' }, this.modeButtons.visual, this.modeButtons.code),
                this.lookSelect, this.aspectSelect),
            h('div', { class: 'topbar-right' },
                h('button', { type: 'button', class: 'search-button', title: 'Command palette', 'data-test': 'open-palette', onClick: () => openCommandPalette(this) }, icon('search', 14), h('span', {}, 'Commands'), h('kbd', {}, `${MOD}K`)),
                iconButton('present', { title: 'Present (F)', testId: 'present', onClick: () => this.startPresenting() }),
                h('button', { type: 'button', class: 'text-button', 'data-test': 'share', onClick: () => this.share() }, icon('share', 14), 'Share'),
                h('button', { type: 'button', class: 'text-button is-primary', 'data-test': 'export', onClick: () => openExportDialog(this) }, icon('export', 14), 'Export')))
        const resizer = (axis: 'left' | 'right' | 'bottom' | 'code', label: string) => {
            const element = h('div', { class: `resizer is-${axis}`, role: 'separator', 'aria-label': label, 'data-resizer': axis })
            element.addEventListener('pointerdown', (event) => this.beginResize(event, axis, element))
            return element
        }
        this.presentHud = h('div', { class: 'present-hud', hidden: true, 'data-test': 'present-hud' })
        const center = h('main', { class: 'center', id: 'main-content' }, this.view.element, this.presentHud)
        const workspace = h('div', { class: 'workspace' },
            this.left.element,
            resizer('left', 'Resize left panel'),
            this.codePanel.writerElement,
            resizer('code', 'Resize code panel'),
            center,
            resizer('right', 'Resize right panel'),
            this.inspector.element)
        this.root = h('div', { class: 'studio', 'data-test': 'studio' }, topbar, workspace, resizer('bottom', 'Resize timeline'), this.timeline.element)
        this.applyPrefs()
        this.store.subscribe((kinds) => this.onStoreChange(kinds))
        this.installKeyboard()
        this.installFileDrop()
    }

    // ── State reads ─────────────────────────────────────────────────────────

    get project(): StudioProject {
        return this.store.project
    }

    /** Folder of the Studio's own files, for templates and film sources. */
    get studioAssets(): string {
        return this.assetBase
    }

    get time(): number {
        return this.sandbox ? this.sandbox.time : this.transport.time
    }

    get playing(): boolean {
        return this.sandbox ? this.sandbox.playing : this.transport.playing
    }

    get fps(): number {
        return this.sandboxInfo?.fps ?? this.project.fps
    }

    get duration(): number {
        return this.sandbox ? this.sandbox.duration : projectDuration(this.project)
    }

    /** Length of the film running in the sandbox, or 0 when there is none. */
    get sandboxDuration(): number {
        return this.sandbox?.duration ?? 0
    }

    get codeChapters(): readonly { title: string; time: number }[] {
        return this.sandboxInfo?.chapters ?? []
    }

    /** Logical size of the film on screen. */
    stageSize(): { width: number; height: number } {
        if (this.sandboxInfo) return { width: this.sandboxInfo.width, height: this.sandboxInfo.height }
        const [width, height] = ASPECT_SIZES[this.project.aspect]
        return { width, height }
    }

    lookColors(): Readonly<Record<string, string>> {
        const code = this.project.mode === 'code' ? this.project.codeLook : null
        return LOOKS[code ?? this.project.look].colors
    }

    resizeFilm(): void {
        this.transport.resize()
    }

    // ── Start up ────────────────────────────────────────────────────────────

    /** Open a shared link, then an autosave, then the welcome screen. */
    async start(): Promise<void> {
        const params = new URLSearchParams(location.hash.slice(1))
        const shared = params.get(SHARE_KEY)
        if (shared) {
            try {
                const project = decodeShare(shared)
                history.replaceState(null, '', location.pathname + location.search)
                // A shared link replaces what is open, so keep the visitor's own work restorable.
                this.backUp(this.readAutosave())
                this.codePaused = project.mode === 'code'
                this.loadProject(project)
                toast(`Opened shared project: ${project.name}`)
                return
            } catch (error) {
                toast(error instanceof Error ? error.message : 'Could not open that link.', 'error')
            }
        }
        const saved = this.readAutosave()
        // An empty autosave means nothing was made yet, so the welcome screen still helps.
        if (saved && !isEmptyProject(saved)) {
            this.loadProject(saved)
            return
        }
        this.loadProject(emptyProject())
        openWelcome(this)
    }

    private readAutosave(): StudioProject | null {
        try {
            const raw = localStorage.getItem(AUTOSAVE_KEY)
            return raw ? normalizeProject(JSON.parse(raw)) : null
        } catch {
            return null
        }
    }

    get hasAutosave(): boolean {
        try {
            return localStorage.getItem(AUTOSAVE_KEY) !== null
        } catch {
            return false
        }
    }

    private backUp(project: StudioProject | null): void {
        if (!project || isEmptyProject(project)) return
        try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify(project))
        } catch {
            // Storage can be full or blocked. Opening the new project still works.
        }
    }

    get hasBackup(): boolean {
        try {
            return localStorage.getItem(BACKUP_KEY) !== null
        } catch {
            return false
        }
    }

    /** Swap back to what was open before the last template, file, or shared link. */
    restoreBackup(): void {
        try {
            const raw = localStorage.getItem(BACKUP_KEY)
            if (!raw) return
            const backup = normalizeProject(JSON.parse(raw))
            this.loadProject(backup)
            toast(`Restored ${backup.name}`)
        } catch {
            toast('The previous project could not be restored.', 'error')
        }
    }

    loadProject(project: StudioProject): void {
        if (project !== this.project) this.backUp(this.project)
        this.transport.pause()
        this.transport.time = 0
        this.store.load(project)
        this.nameInput.value = project.name
        this.applyMode()
        this.timeline.fit(true)
    }

    // ── Reacting to changes ─────────────────────────────────────────────────

    private onStoreChange(kinds: ReadonlySet<string>): void {
        const project = this.project
        if (project.mode !== this.appliedMode) this.applyMode()
        if (kinds.has('project')) {
            if (project.mode === 'code') {
                if (project.codeLook) this.lookSelect.value = project.codeLook
                // Undo and redo reach here too, and the editor and film follow them.
                if (this.codePanel.writer.value !== project.source) {
                    this.codePanel.writer.value = project.source
                    this.runCode()
                }
            } else {
                this.lookSelect.value = project.look
            }
            this.aspectSelect.value = project.aspect
            if (document.activeElement !== this.nameInput) this.nameInput.value = project.name
            document.title = `${project.name} | Vizmatic Studio`
            this.scheduleCompile()
            this.scheduleAutosave()
            this.syncLoop()
        }
        if (kinds.has('history')) {
            this.undoButton.disabled = !this.store.canUndo
            this.redoButton.disabled = !this.store.canRedo
        }
        this.left.render()
        this.timeline.render()
        this.inspector.render()
        this.view.renderOverlay()
        if (kinds.has('project')) {
            this.generatedCache = null
            this.codePanel.renderGenerated()
        }
    }

    private scheduleAutosave(): void {
        window.clearTimeout(this.autosaveTimer)
        this.autosaveTimer = window.setTimeout(() => this.saveNow(), 350)
    }

    /** Write the autosave at once. */
    saveNow(): void {
        window.clearTimeout(this.autosaveTimer)
        try {
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(this.project))
        } catch {
            // Storage can be full or blocked. The project stays open and can be saved as a file.
        }
    }

    private scheduleCompile(): void {
        if (this.project.mode === 'code') return
        if (this.compileQueued) return
        this.compileQueued = true
        requestAnimationFrame(() => {
            this.compileQueued = false
            void this.compileNow()
        })
    }

    private async compileNow(): Promise<void> {
        const token = ++this.compileToken
        const project = this.project
        if (project.mode === 'code') return
        try {
            const result = await compileProject(project)
            if (token !== this.compileToken || this.project.mode === 'code') return
            const hadErrors = (this.built?.objectErrors.size ?? 0) + (this.built?.beatErrors.size ?? 0)
            this.built = result
            this.transport.setFilm(result.film)
            this.view.layout()
            this.timeline.syncTransport()
            if (hadErrors !== result.objectErrors.size + result.beatErrors.size) {
                this.left.render()
                this.timeline.render()
            }
            this.inspector.render()
            this.onTime()
            this.root.dataset['compiled'] = String(token)
            if (this.pendingPreview) {
                const id = this.pendingPreview
                this.pendingPreview = null
                this.previewBeat(id)
            }
        } catch (error) {
            console.error('Could not compile the project:', error)
            toast(error instanceof Error ? error.message : 'Could not compile the project.', 'error')
        }
    }

    private onTime(): void {
        this.timeline.updatePlayhead()
        if (!this.playing || this.store.selection.length > 0) this.view.renderOverlay()
    }

    private onPlayState(): void {
        this.timeline.syncTransport()
        this.view.renderOverlay()
        this.root.dataset['playing'] = String(this.playing)
    }

    // ── Transport ───────────────────────────────────────────────────────────

    seek(time: number): void {
        if (this.sandbox) {
            this.sandbox.seek(Math.max(0, Math.min(this.sandbox.duration, time)))
            this.onTime()
            return
        }
        this.transport.seek(time)
    }

    togglePlay(): void {
        if (this.sandbox) this.sandbox.toggle()
        else this.transport.toggle()
    }

    stepFrames(count: number): void {
        const fps = this.fps
        this.seek(Math.round(this.time * fps + count) / fps)
    }

    setSpeed(value: number): void {
        this.transport.speed = value
        this.sandbox?.setSpeed(value)
    }

    toggleLoop(): void {
        this.looping = !this.looping
        this.syncLoop()
        this.timeline.syncTransport()
        this.timeline.updatePlayhead()
    }

    syncLoop(): void {
        const region = this.looping ? this.project.loop : null
        this.transport.loop = region
        this.transport.loopAll = this.looping && !region
        this.sandbox?.setLoop(region)
        this.sandbox?.setLoopAll(this.looping && !region)
    }

    setLoopPoint(which: 'from' | 'to'): void {
        const time = round3(this.time)
        this.store.commit((draft) => {
            const current = draft.loop ?? { from: 0, to: projectDuration(draft) }
            const next = which === 'from' ? { from: time, to: current.to } : { from: current.from, to: time }
            draft.loop = next.to - next.from > 0.02 ? next : null
        })
    }

    toggleSnapping(): void {
        this.snapping = !this.snapping
        this.timeline.syncTransport()
    }

    // ── Objects ─────────────────────────────────────────────────────────────

    private uniqueName(base: string): string {
        const names = new Set(this.project.objects.map((object) => object.name))
        if (!names.has(base)) return base
        for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
    }

    addFromPalette(entry: PaletteEntry, at?: readonly [number, number]): void {
        if (this.project.mode === 'code') return
        if (this.project.objects.length >= LIMITS.objects) {
            toast(`A project can hold ${LIMITS.objects} objects.`, 'error')
            return
        }
        const count = this.project.objects.length
        const place = at ?? [((count % 6) - 2.5) * 36, ((count % 5) - 2) * 36]
        const object: StudioObject = {
            id: createId('o'), kind: entry.kind, name: this.uniqueName(entry.label),
            x: round3(place[0]), y: round3(place[1]), rotation: 0, scale: 1, opacity: 1, hidden: false, locked: false,
            props: defaultProps(entry.kind, entry.props),
        }
        this.store.commit((draft) => {
            draft.objects.push(object)
        })
        this.store.select([object.id])
    }

    deleteSelection(): void {
        const { selection, selectedBeat } = this.store
        if (selectedBeat) {
            this.deleteBeat(selectedBeat)
            return
        }
        if (selection.length === 0) return
        const ids = new Set(selection)
        this.store.commit((draft) => {
            draft.objects = draft.objects.filter((object) => !ids.has(object.id))
            draft.beats = draft.beats.filter((beat) => !ids.has(beat.target))
            for (const beat of draft.beats) {
                for (const key of ['into', 'path']) {
                    if (typeof beat.params[key] === 'string' && ids.has(beat.params[key] as string)) beat.params[key] = ''
                }
            }
        })
    }

    duplicateSelection(): void {
        const ids = this.store.selection
        if (ids.length === 0) return
        const copies: StudioObject[] = []
        for (const id of ids) {
            const object = objectById(this.project, id)
            if (object) copies.push({ ...structuredClone(object), id: createId('o'), name: this.uniqueName(object.name), x: object.x + 40, y: object.y + 40 })
        }
        this.store.commit((draft) => {
            draft.objects.push(...copies)
        })
        this.store.select(copies.map((copy) => copy.id))
    }

    copySelection(): void {
        this.clipboard = this.store.selection.flatMap((id) => {
            const object = objectById(this.project, id)
            return object ? [structuredClone(object)] : []
        })
    }

    paste(): void {
        if (this.clipboard.length === 0) return
        const copies = this.clipboard.map((object) => ({ ...structuredClone(object), id: createId('o'), name: this.uniqueName(object.name), x: object.x + 40, y: object.y + 40 }))
        this.store.commit((draft) => {
            draft.objects.push(...copies)
        })
        this.store.select(copies.map((copy) => copy.id))
    }

    /** Move an object by a stage offset, whether its position lives on the object or on a move beat. */
    private shiftObject(draft: StudioProject, id: string, dx: number, dy: number): void {
        const beat = activeMoveBeat(draft.beats, id, this.time)
        if (beat) {
            const target = draft.beats.find((entry) => entry.id === beat.id)!
            target.params['x'] = round3(Number(target.params['x']) + dx)
            target.params['y'] = round3(Number(target.params['y']) + dy)
            return
        }
        const object = objectById(draft, id)
        if (object) {
            object.x = round3(object.x + dx)
            object.y = round3(object.y + dy)
        }
    }

    nudge(dx: number, dy: number): void {
        const ids = this.store.selection.filter((id) => !objectById(this.project, id)?.locked)
        if (ids.length === 0) return
        this.store.commit((draft) => {
            for (const id of ids) this.shiftObject(draft, id, dx, dy)
        }, { merge: 'nudge' })
    }

    align(edge: 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY'): void {
        const frames = this.store.selection.flatMap((id) => {
            const frame = this.view.frameOfObject(id)
            return frame ? [{ id, b: frame.aabb }] : []
        })
        if (frames.length < 2) return
        const minX = Math.min(...frames.map(({ b }) => b.x)), maxX = Math.max(...frames.map(({ b }) => b.x + b.width))
        const minY = Math.min(...frames.map(({ b }) => b.y)), maxY = Math.max(...frames.map(({ b }) => b.y + b.height))
        this.store.commit((draft) => {
            for (const { id, b } of frames) {
                let dx = 0, dy = 0
                if (edge === 'left') dx = minX - b.x
                else if (edge === 'right') dx = maxX - b.x - b.width
                else if (edge === 'centerX') dx = (minX + maxX) / 2 - b.x - b.width / 2
                else if (edge === 'top') dy = minY - b.y
                else if (edge === 'bottom') dy = maxY - b.y - b.height
                else dy = (minY + maxY) / 2 - b.y - b.height / 2
                this.shiftObject(draft, id, dx, dy)
            }
        })
    }

    distribute(axis: 'x' | 'y'): void {
        const frames = this.store.selection.flatMap((id) => {
            const frame = this.view.frameOfObject(id)
            return frame ? [{ id, b: frame.aabb }] : []
        })
        if (frames.length < 3) {
            toast('Select at least three objects to distribute.')
            return
        }
        const start = (entry: { b: { x: number; y: number } }) => axis === 'x' ? entry.b.x : entry.b.y
        const size = (entry: { b: { width: number; height: number } }) => axis === 'x' ? entry.b.width : entry.b.height
        const sorted = [...frames].sort((a, b) => start(a) - start(b))
        const first = sorted[0]!, last = sorted[sorted.length - 1]!
        const span = start(last) + size(last) - start(first)
        const gap = (span - sorted.reduce((sum, entry) => sum + size(entry), 0)) / (sorted.length - 1)
        this.store.commit((draft) => {
            let cursor = start(first)
            for (const entry of sorted) {
                const delta = cursor - start(entry)
                this.shiftObject(draft, entry.id, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0)
                cursor += size(entry) + gap
            }
        })
    }

    renameProject(name: string): void {
        const value = name.trim() || 'Untitled film'
        if (value !== this.project.name) {
            this.store.commit((draft) => {
                draft.name = value.slice(0, 200)
            })
        }
    }

    setLook(look: LookName): void {
        if (this.sandbox) {
            this.store.commit((draft) => {
                draft.codeLook = look
            })
            this.runCode()
            return
        }
        this.store.commit((draft) => {
            draft.look = look
        })
    }

    addVariable(name: string): boolean {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name) || ['x', 'pi', 'tau', 'e'].includes(name)) {
            toast('Use a short name that starts with a letter. x, pi, tau, and e are taken.', 'error')
            return false
        }
        if (this.project.variables.some((variable) => variable.name === name)) {
            toast(`There is already a variable named ${name}.`, 'error')
            return false
        }
        this.store.commit((draft) => {
            draft.variables.push({ name, value: 1 })
        })
        return true
    }

    // ── Beats ───────────────────────────────────────────────────────────────

    addBeat(kind: string, targetId: string, options: { preview?: boolean } = {}): Beat | null {
        const def = BEATS[kind]
        if (!def) return null
        const project = this.project
        const target = def.group === 'Value' ? VALUE_TRACK : targetId
        const duration = def.duration
        const track = project.beats.filter((beat) => beat.target === target)
        let start = round3(this.time)
        if (track.some((beat) => beat.start < start + Math.max(duration, 0.001) && beatEnd(beat) > start)) {
            start = round3(Math.max(...track.map(beatEnd)))
        }
        const params: ObjectProps = { ...def.params }
        const others = project.objects.filter((object) => object.id !== targetId)
        if (kind === 'move') {
            const frame = this.view.frameOfObject(targetId)
            params['x'] = round3((frame?.center[0] ?? 0) + 240)
            params['y'] = round3(frame?.center[1] ?? 0)
        } else if (kind === 'morph') {
            const self = objectById(project, targetId)
            const similar = others.find((object) => object.kind === self?.kind)
            params['into'] = similar?.id ?? others[0]?.id ?? ''
        } else if (kind === 'along') {
            const path = others.find((object) => KINDS[object.kind]?.pick === 'shape')
            params['path'] = path?.id ?? ''
        } else if (kind === 'value') {
            params['variable'] = project.variables[0]?.name ?? ''
        }
        const beat: Beat = { id: createId('b'), target, kind, start, duration, ease: 'smooth', params }
        this.store.commit((draft) => {
            if (kind === 'value' && !params['variable']) {
                draft.variables.push({ name: 'a', value: 0 })
                beat.params['variable'] = 'a'
            }
            draft.beats.push(beat)
        })
        this.store.select(target === VALUE_TRACK ? [] : [target], beat.id)
        if (options.preview !== false && !def.instant) this.pendingPreview = beat.id
        return beat
    }

    deleteBeat(id: string): void {
        this.store.commit((draft) => {
            draft.beats = draft.beats.filter((beat) => beat.id !== id)
        })
    }

    previewBeat(id: string): void {
        const beat = this.project.beats.find((entry) => entry.id === id)
        if (!beat || this.sandbox) return
        this.transport.previewRange(Math.max(0, beat.start - 0.05), beatEnd(beat) + 0.02)
    }

    /** Choose an animation for an object, or for the selected one. */
    openBeatPicker(anchor: HTMLElement, targetId?: string): void {
        if (this.project.mode === 'code') return
        const target = targetId ?? this.store.selection[0]
        const isValueTrack = target === VALUE_TRACK
        const list = h('div', { class: 'beat-picker', 'data-test': 'beat-picker' })
        const object = target && !isValueTrack ? objectById(this.project, target) : undefined
        list.appendChild(h('p', { class: 'picker-title' }, object ? `Animate ${object.name}` : isValueTrack ? 'Tween a value' : 'Select an object to animate'))
        for (const group of BEAT_GROUPS) {
            const items = Object.values(BEATS).filter((def) => def.group === group
                && (isValueTrack ? def.group === 'Value' : object ? !def.only || def.only(object.kind) : def.group === 'Value'))
            if (items.length === 0) continue
            list.appendChild(h('h3', { class: 'panel-label' }, group))
            for (const def of items) {
                const natural = object && naturalEntrance(object.kind) === def.kind
                list.appendChild(h('button', {
                    type: 'button', class: `picker-item group-${def.group.toLowerCase()}`, 'data-beat-kind': def.kind,
                    onClick: () => {
                        closePopover()
                        this.addBeat(def.kind, target ?? '')
                    },
                }, h('span', { class: 'picker-name' }, def.label, natural ? h('em', {}, 'suggested') : null), h('span', { class: 'picker-hint' }, def.hint)))
            }
        }
        openPopover(anchor, list, { side: 'above', class: 'picker-popover' })
    }

    // ── Markers ─────────────────────────────────────────────────────────────

    addMarker(): void {
        if (this.project.mode === 'code') return
        const time = round3(this.time)
        const title = `Chapter ${this.project.markers.length + 1}`
        this.store.commit((draft) => {
            draft.markers.push({ id: createId('m'), time, title })
        })
    }

    editMarker(id: string, x: number, y: number): void {
        const marker = this.project.markers.find((entry) => entry.id === id)
        if (!marker) return
        const input = h('input', { class: 'field-input', type: 'text', value: marker.title, 'aria-label': 'Chapter title', 'data-test': 'marker-title' })
        const save = () => this.store.commit((draft) => {
            const target = draft.markers.find((entry) => entry.id === id)
            if (target && input.value.trim()) target.title = input.value.trim().slice(0, 200)
        })
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                save()
                closePopover()
            }
        })
        const body = h('div', { class: 'marker-popover' }, input, h('div', { class: 'button-row' },
            h('button', { type: 'button', class: 'text-button is-primary', onClick: () => {
                save()
                closePopover()
            } }, 'Save'),
            h('button', { type: 'button', class: 'text-button', onClick: () => {
                this.store.commit((draft) => {
                    draft.markers = draft.markers.filter((entry) => entry.id !== id)
                })
                closePopover()
            } }, icon('trash', 14), 'Delete')))
        openPopover({ x, y }, body, { side: 'below' })
        input.focus()
        input.select()
    }

    // ── Code mode ───────────────────────────────────────────────────────────

    generatedSource(): string {
        if (this.generatedCache?.project !== this.project) {
            this.generatedCache = { project: this.project, source: projectToSource(this.project) }
        }
        return this.generatedCache.source
    }

    setMode(mode: ProjectMode): void {
        if (mode === this.project.mode) return
        this.store.commit((draft) => {
            draft.mode = mode
            if (mode === 'code' && !draft.source.trim()) draft.source = projectToSource({ ...draft, mode: 'visual' })
        })
    }

    private applyMode(): void {
        const code = this.project.mode === 'code'
        this.appliedMode = this.project.mode
        this.root.classList.toggle('is-code', code)
        this.modeButtons.visual.classList.toggle('is-active', !code)
        this.modeButtons.code.classList.toggle('is-active', code)
        this.modeButtons.visual.setAttribute('aria-pressed', String(!code))
        this.modeButtons.code.setAttribute('aria-pressed', String(code))
        this.aspectSelect.disabled = code
        this.view.sandboxSlot.hidden = !code
        this.view.canvas.hidden = code
        if (code) {
            this.transport.pause()
            this.built = null
            this.codePanel.writer.value = this.project.source
            if (!this.sandbox) {
                this.sandbox = new SandboxHost(this.view.sandboxSlot, this.assetBase, this.fontBase, {
                    onCompiled: (info) => this.onSandboxCompiled(info),
                    onError: (error) => {
                        this.codePanel.showProblem(error)
                        this.root.dataset['codeError'] = 'true'
                    },
                    onTime: () => this.onTime(),
                    onState: () => this.onPlayState(),
                    onLog: (level, text) => this.codePanel.log(level, text),
                })
            }
            this.codePanel.setPaused(this.codePaused)
            if (!this.codePaused) this.runCode()
            this.timeline.setReadOnly([], 0)
        } else {
            this.sandbox?.destroy()
            this.sandbox = null
            this.sandboxInfo = null
            this.codePanel.showProblem(null)
            this.timeline.setReadOnly(null)
            this.codePaused = false
            this.scheduleCompile()
        }
        this.view.layout()
        this.view.renderOverlay()
        this.timeline.syncTransport()
    }

    resumeSharedCode(): void {
        this.codePaused = false
        this.codePanel.setPaused(false)
        this.runCode()
    }

    onSourceEdited(source: string): void {
        if (source.length > LIMITS.sourceBytes) {
            this.codePanel.showProblem({ message: `This source is larger than ${LIMITS.sourceBytes / 1024} KB. Please shorten it.` })
            return
        }
        this.store.commit((draft) => {
            draft.source = source
        }, { merge: 'source-edit' })
        if (this.codePaused) return
        window.clearTimeout(this.codeTimer)
        this.codeTimer = window.setTimeout(() => this.runCode(), 320)
    }

    regenerateSource(): void {
        this.store.commit((draft) => {
            draft.source = projectToSource({ ...draft, mode: 'visual' })
        })
        this.codePanel.writer.value = this.project.source
        this.runCode()
    }

    /** Compile here, run in the sandbox. Syntax errors never reach the frame. */
    runCode(): void {
        const sandbox = this.sandbox
        if (!sandbox || this.codePaused) return
        const source = this.project.source
        void compileSource(source).then((result) => {
            if (this.sandbox !== sandbox || this.project.source !== source) return
            if (result.error || result.code === undefined) {
                this.codePanel.showProblem(result.error ?? { message: 'Could not compile this source.' })
                this.root.dataset['codeError'] = 'true'
                return
            }
            this.codePanel.clearLogs()
            sandbox.run(result.code, this.project.codeLook)
        })
    }

    private onSandboxCompiled(info: SandboxInfo): void {
        this.sandboxInfo = info
        this.codePanel.showProblem(null)
        delete this.root.dataset['codeError']
        this.root.dataset['codeCompiled'] = String(Number(this.root.dataset['codeCompiled'] ?? 0) + 1)
        if (!this.project.codeLook) this.lookSelect.value = Object.hasOwn(LOOKS, info.look) ? info.look : this.project.look
        this.timeline.setReadOnly(info.clips.map((clip) => ({ t0: clip.t0, t1: clip.t1, label: clip.labels.join(' + ') })), info.duration)
        this.syncLoop()
        this.view.layout()
    }

    // ── Files ───────────────────────────────────────────────────────────────

    fileName(extension: string): string {
        const base = this.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'film'
        return `${base}.${extension}`
    }

    saveProjectFile(): void {
        download(JSON.stringify(this.project, null, 2), 'application/json', this.fileName('vizmatic.json'))
        toast('Saved a project file')
    }

    openProjectFile(): void {
        const input = h('input', { type: 'file', accept: '.json,application/json', 'data-test': 'open-file-input', style: { display: 'none' } })
        input.addEventListener('change', () => {
            const file = input.files?.[0]
            input.remove()
            if (file) void this.readProjectFile(file)
        })
        document.body.appendChild(input)
        input.click()
    }

    async readProjectFile(file: File): Promise<void> {
        try {
            if (file.size > 8_000_000) throw new Error('This file is too large to be a project.')
            const project = normalizeProject(JSON.parse(await file.text()))
            this.loadProject(project)
            toast(`Opened ${project.name}`)
        } catch (error) {
            toast(error instanceof Error ? `Could not open that file. ${error.message}` : 'Could not open that file.', 'error')
        }
    }

    private installFileDrop(): void {
        window.addEventListener('dragover', (event) => {
            if (event.dataTransfer?.types.includes('Files')) event.preventDefault()
        })
        window.addEventListener('drop', (event) => {
            const file = event.dataTransfer?.files[0]
            if (!file) return
            event.preventDefault()
            void this.readProjectFile(file)
        })
    }

    shareUrl(): string {
        return `${location.origin}${location.pathname}#${SHARE_KEY}=${encodeShare(this.project)}`
    }

    share(): void {
        openShareDialog(this.shareUrl())
    }

    newProject(): void {
        openWelcome(this)
    }

    /** Render a file. Hand-written films render inside their sandbox. */
    async renderExport(settings: ExportSettings, control: { signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void }): Promise<ExportResult> {
        if (this.exporting) throw new Error('An export is already running.')
        this.exporting = true
        const wasPlaying = this.playing
        if (wasPlaying) this.togglePlay()
        try {
            if (this.sandbox) return await this.sandbox.exportFilm(settings, control)
            const film = (await compileProject(this.project)).film
            return await exportFilm(film, settings, control)
        } finally {
            this.exporting = false
        }
    }

    // ── Presenting ──────────────────────────────────────────────────────────

    private chapterTimes(): number[] {
        const titles = this.sandbox ? this.sandbox.chapters.map((chapter) => chapter.time) : this.project.markers.map((marker) => marker.time)
        return [...new Set(titles.filter((time) => time > 0))].sort((a, b) => a - b)
    }

    startPresenting(): void {
        if (this.presenting) return
        this.presenting = true
        this.root.classList.add('is-presenting')
        closePopover()
        void this.root.requestFullscreen?.().catch(() => {
            // The window-filling layout still works when the browser declines full screen.
        })
        this.seek(0)
        this.presentNext()
        this.updateHud()
        this.view.layout()
    }

    stopPresenting(): void {
        if (!this.presenting) return
        this.presenting = false
        this.root.classList.remove('is-presenting')
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        if (this.playing) this.togglePlay()
        this.presentHud.hidden = true
        this.view.layout()
    }

    private presentNext(): void {
        const now = this.time
        // The last chapter has already played, so stay on the final frame.
        if (now >= this.duration - 1e-3) return
        const next = this.chapterTimes().find((time) => time > now + 1e-3) ?? this.duration
        if (this.sandbox) this.sandbox.previewRange(now, next)
        else this.transport.previewRange(now, next)
        this.updateHud()
    }

    private presentPrevious(): void {
        const now = this.time
        const before = this.chapterTimes().filter((time) => time < now - 0.25)
        const target = before.length ? before[before.length - 1]! : 0
        if (this.playing) this.togglePlay()
        this.seek(target)
        this.updateHud()
    }

    private updateHud(): void {
        const chapters = this.chapterTimes()
        const total = chapters.length + 1
        const nextIndex = chapters.findIndex((time) => time > this.time + 1e-3)
        const index = nextIndex < 0 ? total : nextIndex + 1
        this.presentHud.hidden = false
        this.presentHud.textContent = `${index} / ${total}   ← → to step   Esc to exit`
    }

    // ── Layout ──────────────────────────────────────────────────────────────

    private applyPrefs(): void {
        const style = this.root.style
        style.setProperty('--left-width', `${this.prefs.left}px`)
        style.setProperty('--right-width', `${this.prefs.right}px`)
        style.setProperty('--bottom-height', `${this.prefs.bottom}px`)
        style.setProperty('--code-width', `${this.prefs.code}px`)
    }

    private beginResize(event: PointerEvent, axis: keyof Prefs, element: HTMLElement): void {
        event.preventDefault()
        const start = this.prefs[axis]
        const startX = event.clientX, startY = event.clientY
        document.body.classList.add('is-dragging', axis === 'bottom' ? 'is-resizing-row' : 'is-resizing-col')
        const limits: Record<keyof Prefs, [number, number]> = { left: [180, 420], right: [220, 620], bottom: [120, window.innerHeight - 240], code: [320, window.innerWidth - 420] }
        dragPointer(event, element, {
            move: (next) => {
                const delta = axis === 'bottom' ? startY - next.clientY : axis === 'right' ? startX - next.clientX : next.clientX - startX
                this.prefs[axis] = Math.round(Math.max(limits[axis][0], Math.min(limits[axis][1], start + delta)))
                this.applyPrefs()
            },
            up: () => {
                document.body.classList.remove('is-dragging', 'is-resizing-row', 'is-resizing-col')
                try {
                    localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs))
                } catch {
                    // Panel sizes are a convenience, so a blocked store is fine.
                }
            },
        })
    }

    // ── Menus and keys ──────────────────────────────────────────────────────

    commands(): Command[] {
        const has = () => this.store.selection.length > 0
        return [
            { id: 'new', label: 'New project', group: 'File', run: () => this.newProject() },
            { id: 'open', label: 'Open project file', group: 'File', keys: `${MOD}O`, run: () => this.openProjectFile() },
            { id: 'save', label: 'Save project file', group: 'File', keys: `${MOD}S`, run: () => this.saveProjectFile() },
            { id: 'share', label: 'Copy share link', group: 'File', run: () => this.share() },
            { id: 'export', label: 'Export', group: 'File', keys: `${MOD}E`, run: () => openExportDialog(this) },
            { id: 'diagram', label: 'Open the diagram builder', group: 'File', run: () => { location.href = 'playground.html' } },
            { id: 'undo', label: 'Undo', group: 'Edit', keys: `${MOD}Z`, run: () => this.store.undo() },
            { id: 'redo', label: 'Redo', group: 'Edit', keys: isMac ? '⇧⌘Z' : 'Ctrl+Shift+Z', run: () => this.store.redo() },
            { id: 'duplicate', label: 'Duplicate selection', group: 'Edit', keys: `${MOD}D`, enabled: has, run: () => this.duplicateSelection() },
            { id: 'delete', label: 'Delete selection', group: 'Edit', keys: 'Delete', enabled: has, run: () => this.deleteSelection() },
            { id: 'select-all', label: 'Select all', group: 'Edit', keys: `${MOD}A`, run: () => this.store.select(this.project.objects.filter((object) => !object.locked && !object.hidden).map((object) => object.id)) },
            { id: 'play', label: 'Play or pause', group: 'Playback', keys: 'Space', run: () => this.togglePlay() },
            { id: 'start', label: 'Go to start', group: 'Playback', keys: 'Home', run: () => this.seek(0) },
            { id: 'end', label: 'Go to end', group: 'Playback', keys: 'End', run: () => this.seek(this.duration) },
            { id: 'prev-frame', label: 'Previous frame', group: 'Playback', keys: ',', run: () => this.stepFrames(-1) },
            { id: 'next-frame', label: 'Next frame', group: 'Playback', keys: '.', run: () => this.stepFrames(1) },
            { id: 'loop', label: 'Toggle loop', group: 'Playback', keys: 'L', run: () => this.toggleLoop() },
            { id: 'loop-in', label: 'Set loop start', group: 'Playback', keys: 'I', run: () => this.setLoopPoint('from') },
            { id: 'loop-out', label: 'Set loop end', group: 'Playback', keys: 'O', run: () => this.setLoopPoint('to') },
            { id: 'present', label: 'Present', group: 'Playback', keys: 'F', run: () => this.startPresenting() },
            { id: 'animate', label: 'Add animation', group: 'Timeline', keys: 'N', run: () => this.openBeatPicker(document.querySelector('[data-test="add-beat"]') as HTMLElement) },
            { id: 'marker', label: 'Add chapter at playhead', group: 'Timeline', keys: 'M', run: () => this.addMarker() },
            { id: 'fit-timeline', label: 'Fit timeline', group: 'Timeline', run: () => this.timeline.fit() },
            { id: 'zoom-fit', label: 'Fit canvas to window', group: 'View', keys: `${MOD}0`, run: () => this.view.setZoom('fit') },
            { id: 'zoom-in', label: 'Zoom canvas in', group: 'View', keys: `${MOD}=`, run: () => this.view.zoomBy(1.25) },
            { id: 'zoom-out', label: 'Zoom canvas out', group: 'View', keys: `${MOD}-`, run: () => this.view.zoomBy(0.8) },
            { id: 'code-view', label: 'Show generated code', group: 'View', keys: `${MOD}/`, run: () => this.inspector.setTab(this.inspector.codeVisible ? 'inspect' : 'code') },
            { id: 'mode-code', label: 'Edit as code', group: 'View', run: () => this.setMode('code') },
            { id: 'mode-visual', label: 'Back to visual editing', group: 'View', run: () => this.setMode('visual') },
            { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'Help', keys: '?', run: () => openShortcuts(this) },
            ...Object.keys(LOOKS).map((look): Command => ({
                id: `look-${look}`, label: `Look: ${look[0]!.toUpperCase()}${look.slice(1)}`, group: 'Look', run: () => this.setLook(look as LookName),
            })),
            ...PALETTE.map((entry): Command => ({
                id: `add-${entry.id}`, label: `Add ${entry.label.toLowerCase()}`, group: 'Add', keys: entry.key?.toUpperCase(),
                run: () => this.addFromPalette(entry),
            })),
        ]
    }

    private openFileMenu(anchor: HTMLElement): void {
        const items: [string, string, string | null, () => void][] = [
            ['new', 'New project', null, () => this.newProject()],
            ['open', 'Open project file', `${MOD}O`, () => this.openProjectFile()],
            ['save', 'Save project file', `${MOD}S`, () => this.saveProjectFile()],
            ['share', 'Copy share link', null, () => this.share()],
            ['export', 'Export', `${MOD}E`, () => openExportDialog(this)],
        ]
        const menu = h('div', { class: 'menu', role: 'menu', 'data-test': 'file-menu-list' },
            items.map(([id, label, keys, run]) => h('button', {
                type: 'button', class: 'menu-item', role: 'menuitem', 'data-menu': id,
                onClick: () => {
                    closePopover()
                    run()
                },
            }, h('span', {}, label), keys ? h('kbd', {}, keys) : null)),
            h('hr', {}),
            this.hasBackup ? h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-menu': 'restore', onClick: () => {
                closePopover()
                this.restoreBackup()
            } }, h('span', {}, 'Restore previous project')) : null,
            this.hasBackup ? h('hr', {}) : null,
            h('a', { class: 'menu-item', href: 'playground.html', role: 'menuitem' }, h('span', {}, 'Diagram builder')),
            h('a', { class: 'menu-item', href: 'components.html', role: 'menuitem' }, h('span', {}, 'Component gallery')))
        openPopover(anchor, menu, { side: 'below' })
    }

    private installKeyboard(): void {
        window.addEventListener('keydown', (event) => this.onKeyDown(event))
        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.presenting) this.stopPresenting()
        })
    }

    private onKeyDown(event: KeyboardEvent): void {
        const mod = event.metaKey || event.ctrlKey
        const key = event.key
        if (this.presenting) {
            if (key === 'Escape') {
                event.preventDefault()
                this.stopPresenting()
            } else if (key === 'ArrowRight' || key === ' ' || key === 'PageDown') {
                event.preventDefault()
                if (!this.playing) this.presentNext()
            } else if (key === 'ArrowLeft' || key === 'PageUp') {
                event.preventDefault()
                this.presentPrevious()
            }
            return
        }
        if (document.querySelector('.modal-backdrop')) return
        if (mod && key.toLowerCase() === 'k') {
            event.preventDefault()
            openCommandPalette(this)
            return
        }
        if (mod && key.toLowerCase() === 's') {
            event.preventDefault()
            this.saveProjectFile()
            return
        }
        if (mod && key.toLowerCase() === 'o') {
            event.preventDefault()
            this.openProjectFile()
            return
        }
        if (mod && key.toLowerCase() === 'e') {
            event.preventDefault()
            openExportDialog(this)
            return
        }
        const code = this.project.mode === 'code'
        if (isTyping(event)) {
            // Undo stays native inside text fields. Everything else belongs to the field.
            return
        }
        if (mod) {
            switch (key.toLowerCase()) {
                case 'z':
                    event.preventDefault()
                    if (event.shiftKey) this.store.redo()
                    else this.store.undo()
                    if (code) this.codePanel.writer.value = this.project.source
                    return
                case 'y':
                    event.preventDefault()
                    this.store.redo()
                    return
                case 'd':
                    event.preventDefault()
                    this.duplicateSelection()
                    return
                case 'a':
                    event.preventDefault()
                    this.store.select(this.project.objects.filter((object) => !object.locked && !object.hidden).map((object) => object.id))
                    return
                case 'c':
                    this.copySelection()
                    return
                case 'v':
                    this.paste()
                    return
                case '/':
                    event.preventDefault()
                    this.inspector.setTab(this.inspector.codeVisible ? 'inspect' : 'code')
                    return
                case '0':
                    event.preventDefault()
                    this.view.setZoom('fit')
                    return
                case '=':
                case '+':
                    event.preventDefault()
                    this.view.zoomBy(1.25)
                    return
                case '-':
                    event.preventDefault()
                    this.view.zoomBy(0.8)
                    return
            }
            return
        }
        switch (key) {
            case ' ':
                event.preventDefault()
                this.togglePlay()
                return
            case 'Home':
                event.preventDefault()
                this.seek(0)
                return
            case 'End':
                event.preventDefault()
                this.seek(this.duration)
                return
            case ',':
                this.stepFrames(event.shiftKey ? -10 : -1)
                return
            case '.':
                this.stepFrames(event.shiftKey ? 10 : 1)
                return
            case '?':
                event.preventDefault()
                openShortcuts(this)
                return
            case 'Escape':
                this.store.select([])
                return
            case 'l':
            case 'L':
                this.toggleLoop()
                return
            case 'i':
            case 'I':
                if (!code) this.setLoopPoint('from')
                return
            case 'o':
            case 'O':
                if (!code) this.setLoopPoint('to')
                return
            case 'f':
            case 'F':
                this.startPresenting()
                return
        }
        if (code) return
        const step = event.shiftKey ? 10 : 1
        switch (key) {
            case 'Delete':
            case 'Backspace':
                event.preventDefault()
                this.deleteSelection()
                return
            case 'ArrowLeft':
                event.preventDefault()
                this.nudge(-step, 0)
                return
            case 'ArrowRight':
                event.preventDefault()
                this.nudge(step, 0)
                return
            case 'ArrowUp':
                event.preventDefault()
                this.nudge(0, -step)
                return
            case 'ArrowDown':
                event.preventDefault()
                this.nudge(0, step)
                return
            case 'n':
            case 'N':
                this.openBeatPicker(document.querySelector('[data-test="add-beat"]') as HTMLElement)
                return
            case 'm':
            case 'M':
                this.addMarker()
                return
        }
        const entry = PALETTE.find((candidate) => candidate.key === key.toLowerCase())
        if (entry && !event.altKey) this.addFromPalette(entry)
    }
}

