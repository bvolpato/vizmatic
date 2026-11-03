import { paintFrame } from '../stage/index'
import type { App } from './app'
import { compileProject } from './compile'
import { ExportCancelled, evenSize, type ExportFormat, type ExportQuality, type ExportResult, type ExportSettings } from './export'
import { emptyProject, type StudioProject } from './model'
import { normalizeProject } from './project'
import { TEMPLATES, type Template } from './templates'
import { clear, closePopover, download, h, icon, MOD, openModal, toast } from './ui/dom'

export interface Command {
    id: string
    label: string
    group: string
    keys?: string
    enabled?: () => boolean
    run: () => void
}

// ── Command palette ─────────────────────────────────────────────────────────

export function openCommandPalette(app: App): void {
    closePopover()
    const commands = app.commands()
    const input = h('input', { class: 'command-input', type: 'text', placeholder: 'Type a command', spellcheck: 'false', 'aria-label': 'Command', 'data-test': 'command-input' })
    const list = h('div', { class: 'command-list', role: 'listbox' })
    let results: Command[] = commands
    let cursor = 0
    const paint = () => {
        clear(list)
        results.slice(0, 60).forEach((command, index) => {
            list.appendChild(h('button', {
                type: 'button', class: `command-item${index === cursor ? ' is-current' : ''}`, role: 'option', 'data-command': command.id,
                onClick: () => run(command),
                onPointermove: () => {
                    if (cursor !== index) {
                        cursor = index
                        paint()
                    }
                },
            }, h('span', { class: 'command-group' }, command.group), h('span', { class: 'command-label' }, command.label), command.keys ? h('kbd', {}, command.keys) : null))
        })
        if (results.length === 0) list.appendChild(h('p', { class: 'empty-hint' }, 'No matching command.'))
        list.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' })
    }
    const close = openModal(h('div', { class: 'command-palette', 'data-test': 'command-palette' }, input, list), { class: 'is-top' })
    const run = (command: Command) => {
        close()
        command.run()
    }
    const score = (command: Command, query: string): number => {
        const text = `${command.group} ${command.label}`.toLowerCase()
        if (command.label.toLowerCase().startsWith(query)) return 3
        if (text.includes(query)) return 2
        let at = 0
        for (const ch of query) {
            at = text.indexOf(ch, at)
            if (at < 0) return 0
            at++
        }
        return 1
    }
    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase()
        results = commands
            .filter((command) => command.enabled?.() !== false)
            .map((command) => ({ command, value: query ? score(command, query) : 1 }))
            .filter((entry) => entry.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((entry) => entry.command)
        cursor = 0
        paint()
    })
    input.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault()
            cursor = Math.min(results.length - 1, cursor + 1)
            paint()
        } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            cursor = Math.max(0, cursor - 1)
            paint()
        } else if (event.key === 'Enter') {
            event.preventDefault()
            const command = results[cursor]
            if (command) run(command)
        }
    })
    paint()
    input.focus()
}

// ── Shortcut sheet ──────────────────────────────────────────────────────────

export function openShortcuts(app: App): void {
    const groups = new Map<string, Command[]>()
    for (const command of app.commands()) {
        if (!command.keys) continue
        const list = groups.get(command.group) ?? []
        list.push(command)
        groups.set(command.group, list)
    }
    const extra: [string, [string, string][]][] = [
        ['Canvas', [['Move 1 px, or 10 with Shift', 'Arrows'], ['Select several', 'Shift-click'], ['Pan', 'Space + drag'], ['Zoom', `${MOD} + wheel`], ['Keep proportions', 'Shift + handle'], ['Resize from center', 'Alt + handle'], ['Skip snapping', `${MOD} + drag`]]],
        ['Timeline clips', [['Copy a clip', 'Alt + drag'], ['Make room for a clip', 'Shift + release'], ['Set a loop region', 'Shift + drag ruler'], ['Rename a chapter', 'Double-click']]],
    ]
    const section = (title: string, rows: [string, string][]) => h('section', { class: 'shortcut-group' },
        h('h3', { class: 'panel-label' }, title),
        rows.map(([label, keys]) => h('div', { class: 'shortcut-row' }, h('span', {}, label), h('kbd', {}, keys))))
    openModal(h('div', { class: 'shortcut-sheet', 'data-test': 'shortcuts' },
        [...groups].map(([group, list]) => section(group, list.map((command) => [command.label, command.keys!]))),
        extra.map(([title, rows]) => section(title, rows))), { title: 'Keyboard shortcuts', class: 'is-wide' })
}

// ── Share ───────────────────────────────────────────────────────────────────

export function openShareDialog(url: string): void {
    const input = h('input', { class: 'field-input mono', type: 'text', value: url, readOnly: true, 'aria-label': 'Share link', 'data-test': 'share-url' })
    const note = h('p', { class: 'field-help' }, `The whole project is inside this link (${(url.length / 1024).toFixed(1)} KB). Nothing is uploaded.`)
    const copy = h('button', {
        type: 'button', class: 'text-button is-primary', 'data-test': 'copy-share',
        onClick: async () => {
            try {
                await navigator.clipboard.writeText(url)
                toast('Link copied')
            } catch {
                input.select()
                toast('The browser blocked the clipboard. Press copy on the selected text.')
            }
        },
    }, icon('copy', 14), 'Copy link')
    openModal(h('div', { class: 'share-dialog' }, input, note, h('div', { class: 'dialog-actions' }, copy)), { title: 'Share this project' })
    input.focus()
    input.select()
}

// ── Export ──────────────────────────────────────────────────────────────────

type ExportChoice = ExportFormat | 'tsx' | 'project'

const FORMATS: readonly { id: ExportChoice; label: string; hint: string }[] = [
    { id: 'mp4', label: 'MP4', hint: 'Video for any player, encoded here in your browser' },
    { id: 'webm', label: 'WebM', hint: 'Open video format' },
    { id: 'gif', label: 'GIF', hint: 'Animated image for docs and chat' },
    { id: 'png', label: 'PNG', hint: 'The frame at the playhead' },
    { id: 'svg', label: 'SVG', hint: 'The frame at the playhead, as vectors' },
    { id: 'tsx', label: 'film.tsx', hint: 'Source for the Vizmatic CLI' },
    { id: 'project', label: 'Project', hint: 'A file you can open here again' },
]

export function openExportDialog(app: App): void {
    closePopover()
    const size = app.stageSize()
    const project = app.project
    const code = project.mode === 'code'
    const widths = [
        ['720', Math.round(size.width * 2 / 3)], ['1080', size.width], ['1440', Math.round(size.width * 4 / 3)], ['2160', size.width * 2],
    ] as const
    const options = widths.map(([label, width]) => {
        const even = evenSize(size, width)
        return { value: String(even.width), label: `${label}p  ${even.width} x ${even.height}` }
    })
    let format: ExportChoice = 'mp4'
    const widthSelect = h('select', { class: 'field-input', 'aria-label': 'Resolution', 'data-test': 'export-width' },
        options.map((option, i) => h('option', { value: option.value, selected: i === 1 }, option.label)))
    const fpsSelect = h('select', { class: 'field-input', 'aria-label': 'Frames per second', 'data-test': 'export-fps' },
        [24, 30, 60].map((fps) => h('option', { value: String(fps), selected: fps === Math.min(60, app.fps) }, `${fps} fps`)))
    const qualitySelect = h('select', { class: 'field-input', 'aria-label': 'Quality', 'data-test': 'export-quality' },
        (['draft', 'standard', 'high'] as const).map((quality) => h('option', { value: quality, selected: quality === 'standard' }, quality[0]!.toUpperCase() + quality.slice(1))))
    const blurSelect = h('select', { class: 'field-input', 'aria-label': 'Motion blur', 'data-test': 'export-blur' },
        [[1, 'Off'], [4, '4 samples'], [8, '8 samples']].map(([value, label]) => h('option', { value: String(value), selected: value === 1 }, String(label))))
    const rangeSelect = h('select', { class: 'field-input', 'aria-label': 'Range', 'data-test': 'export-range' },
        h('option', { value: 'all', selected: true }, 'Whole film'),
        !code && project.loop ? h('option', { value: 'loop' }, `Loop region (${project.loop.from.toFixed(1)}s to ${project.loop.to.toFixed(1)}s)`) : null)
    const row = (label: string, control: HTMLElement) => h('label', { class: 'export-row' }, h('span', { class: 'field-label' }, label), control)
    const videoRows = [row('Frame rate', fpsSelect), row('Quality', qualitySelect), row('Motion blur', blurSelect), row('Range', rangeSelect)]
    const sizeRow = row('Resolution', widthSelect)
    const hint = h('p', { class: 'field-help export-hint' })
    const bar = h('div', { class: 'progress-fill' })
    const progress = h('div', { class: 'progress', hidden: true, 'data-test': 'export-progress' }, bar)
    const status = h('p', { class: 'export-status', role: 'status', 'data-test': 'export-status' })
    const start = h('button', { type: 'button', class: 'text-button is-primary', 'data-test': 'export-start' }, icon('export', 14), 'Export')
    let controller: AbortController | null = null
    const tabs = h('div', { class: 'export-formats', role: 'tablist' }, FORMATS.map((entry) => h('button', {
        type: 'button', class: `format-tab${entry.id === format ? ' is-active' : ''}`, role: 'tab', 'data-format': entry.id,
        onClick: () => choose(entry.id),
    }, entry.label)))
    const choose = (next: ExportChoice) => {
        format = next
        for (const tab of Array.from(tabs.children)) tab.classList.toggle('is-active', (tab as HTMLElement).dataset['format'] === next)
        const video = next === 'mp4' || next === 'webm' || next === 'gif'
        const raster = video || next === 'png'
        sizeRow.hidden = !raster
        for (const entry of videoRows) entry.hidden = !video
        qualitySelect.closest('label')!.hidden = !(next === 'mp4' || next === 'webm')
        hint.textContent = FORMATS.find((entry) => entry.id === next)!.hint
        status.textContent = ''
        if (next === 'gif') widthSelect.value = options[0]!.value
    }
    const finish = (result: ExportResult) => {
        download(result.bytes as BlobPart, result.type, app.fileName(result.extension))
        status.textContent = `Saved ${app.fileName(result.extension)}, ${(result.bytes.length / 1024 / 1024).toFixed(2)} MB. ${result.note}`
        status.dataset['done'] = 'true'
        status.dataset['type'] = result.type
    }
    const reset = () => {
        controller = null
        start.replaceChildren(icon('export', 14), 'Export')
        start.classList.add('is-primary')
    }
    start.addEventListener('click', async () => {
        if (controller) {
            controller.abort()
            return
        }
        delete status.dataset['done']
        if (format === 'tsx') {
            const source = code ? project.source : app.generatedSource()
            download(source, 'text/plain', 'film.tsx')
            status.textContent = 'Saved film.tsx. Render it with: vizmatic film ./film.tsx'
            status.dataset['done'] = 'true'
            return
        }
        if (format === 'project') {
            app.saveProjectFile()
            status.textContent = 'Saved the project file.'
            status.dataset['done'] = 'true'
            return
        }
        const useLoop = rangeSelect.value === 'loop' && project.loop
        const settings: ExportSettings = {
            format,
            width: Number(widthSelect.value),
            fps: Number(fpsSelect.value),
            quality: qualitySelect.value as ExportQuality,
            motionBlur: Number(blurSelect.value),
            from: useLoop ? project.loop!.from : 0,
            to: useLoop ? project.loop!.to : app.duration,
            time: app.time,
        }
        controller = new AbortController()
        start.replaceChildren(icon('close', 14), 'Cancel')
        start.classList.remove('is-primary')
        progress.hidden = false
        bar.style.width = '0%'
        status.textContent = 'Starting'
        try {
            const result = await app.renderExport(settings, {
                signal: controller.signal,
                onProgress: ({ done, total, stage }) => {
                    bar.style.width = `${(done / total) * 100}%`
                    status.textContent = `${stage}: frame ${done} of ${total}`
                },
            })
            finish(result)
        } catch (error) {
            const cancelled = error instanceof ExportCancelled || (error instanceof Error && error.name === 'ExportCancelled')
            status.textContent = cancelled ? 'Export cancelled.' : error instanceof Error ? error.message : String(error)
            if (!cancelled) status.dataset['error'] = 'true'
        } finally {
            progress.hidden = true
            reset()
        }
    })
    openModal(h('div', { class: 'export-dialog', 'data-test': 'export-dialog' },
        tabs,
        hint,
        h('div', { class: 'export-grid' }, sizeRow, videoRows),
        progress,
        status,
        h('div', { class: 'dialog-actions' }, start)), {
        title: 'Export',
        class: 'is-export',
        sticky: () => controller !== null,
    })
    choose('mp4')
}

// ── Welcome ─────────────────────────────────────────────────────────────────

interface CatalogFilm {
    id: string
    title: string
    description?: string
    file: string
    poster?: string
}

async function loadCatalog(app: App): Promise<CatalogFilm[]> {
    try {
        const response = await fetch(new URL('films.json', app.studioAssets))
        const type = response.headers.get('content-type') ?? ''
        if (!response.ok || !type.includes('json')) return []
        const films = await response.json() as unknown
        return Array.isArray(films) ? films.filter((film): film is CatalogFilm => !!film && typeof film.file === 'string' && typeof film.title === 'string') : []
    } catch {
        return []
    }
}

async function drawThumb(canvas: HTMLCanvasElement, template: Template): Promise<void> {
    const { film } = await compileProject(template.project())
    const frame = film.frame(Math.min(template.thumb, film.duration))
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const width = canvas.clientWidth || 280
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(canvas.width * film.height / film.width)
    paintFrame(canvas.getContext('2d')!, frame, canvas.width / film.width)
}

export function openWelcome(app: App): void {
    closePopover()
    const hasWork = app.project.objects.length > 0 || app.project.source.trim().length > 0
    let close = (): void => {}
    const load = (project: StudioProject) => {
        close()
        app.loadProject(project)
        app.saveNow()
    }
    const templateCard = (template: Template) => {
        const canvas = h('canvas', { class: 'template-thumb', 'aria-hidden': 'true' })
        const card = h('button', {
            type: 'button', class: 'template-card', 'data-template': template.id,
            onClick: () => load(normalizeProject(template.project())),
        }, canvas, h('span', { class: 'template-title' }, template.title), h('span', { class: 'template-text' }, template.description))
        requestAnimationFrame(() => {
            void drawThumb(canvas, template).catch((error) => console.warn('Template preview failed:', error))
        })
        return card
    }
    const filmGrid = h('div', { class: 'template-grid is-films', 'data-test': 'film-templates' })
    const filmSection = h('section', { class: 'welcome-section', hidden: true }, h('h2', { class: 'panel-label' }, 'Films, as code'), filmGrid)
    void loadCatalog(app).then((films) => {
        if (films.length === 0) return
        filmSection.hidden = false
        for (const film of films) {
            filmGrid.appendChild(h('button', {
                type: 'button', class: 'template-card is-film', 'data-film': film.id,
                onClick: async () => {
                    try {
                        const response = await fetch(new URL(`films/${film.file}`, app.studioAssets))
                        if (!response.ok) throw new Error(`HTTP ${response.status}`)
                        const source = await response.text()
                        load({ ...emptyProject(film.title), mode: 'code', source })
                    } catch (error) {
                        toast(`Could not open ${film.title}. ${error instanceof Error ? error.message : ''}`, 'error')
                    }
                },
            },
            film.poster ? h('img', { class: 'film-poster', src: film.poster, alt: '', loading: 'lazy' }) : null,
            h('span', { class: 'template-title' }, film.title),
            film.description ? h('span', { class: 'template-text' }, film.description) : null))
        }
    })
    const body = h('div', { class: 'welcome', 'data-test': 'welcome' },
        h('header', { class: 'welcome-head' },
            h('h1', { class: 'welcome-title' }, 'Make something move.'),
            h('p', { class: 'welcome-lede' }, 'Equations that write themselves, diagrams that explain, charts that arrive on cue. Everything runs in this tab, and nothing is uploaded.')),
        h('div', { class: 'welcome-actions' },
            h('button', { type: 'button', class: 'text-button is-primary', 'data-test': 'blank', onClick: () => load(emptyProject()) }, icon('plus', 14), 'Blank film'),
            hasWork ? h('button', { type: 'button', class: 'text-button', 'data-test': 'continue', onClick: () => close() }, 'Back to my project') : null,
            h('button', { type: 'button', class: 'text-button', onClick: () => {
                close()
                app.openProjectFile()
            } }, 'Open a project file'),
            h('button', { type: 'button', class: 'text-button', 'data-test': 'blank-code', onClick: () => load({ ...emptyProject('Hand-written film'), mode: 'code', source: STARTER_SOURCE }) }, icon('code', 14), 'Start from code'),
            h('a', { class: 'text-button', href: 'playground.html' }, 'Static diagram builder')),
        h('section', { class: 'welcome-section' },
            h('h2', { class: 'panel-label' }, 'Start from a template'),
            h('div', { class: 'template-grid' }, TEMPLATES.map(templateCard))),
        filmSection)
    close = openModal(body, { class: 'is-welcome', sticky: () => false, title: undefined })
}

const STARTER_SOURCE = `import { draw, film, plane, tex, text, write, applyMatrix } from 'vizmatic/stage'

export default film({ title: 'A matrix bends space', fps: 60 }, (s) => {
    const grid = s.add(plane({ unit: 130, color: 'blue' }))
    s.play(draw(grid), { duration: 2 })

    const matrix = s.add(tex('\\\\begin{bmatrix} 1 & 1 \\\\\\\\ 0 & 1 \\\\end{bmatrix}', { size: 72, color: 'yellow' }).moveTo([-640, -370]))
    s.play(write(matrix))

    s.chapter('Apply it')
    s.play(applyMatrix(grid, [[1, 1], [0, 1]]), { duration: 2.4 })

    const note = s.add(text('Every line stays straight.', { font: 'serif', size: 52 }).moveTo([560, 420]))
    s.play(write(note))
    s.wait(1.5)
})
`
