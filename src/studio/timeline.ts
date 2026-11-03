import type { App } from './app'
import { BEATS, type BeatGroup } from './beats'
import { beatEnd, createId, laneOf, objectById, projectDuration, round3, VALUE_TRACK, type Beat, type StudioProject } from './model'
import { clear, dragPointer, formatTime, h, icon, iconButton } from './ui/dom'

const NAME_WIDTH = 164
const LANE_HEIGHT = 24
const RULER_HEIGHT = 28
const MIN_DURATION = 0.05
const SNAP_PIXELS = 7
const TICK_STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]

type ClipPart = 'body' | 'left' | 'right'

export interface ReadOnlyClip {
    t0: number
    t1: number
    label: string
}

interface ClipGesture {
    type: 'clip'
    id: string
    part: ClipPart
    startX: number
    origin: Beat
    key: string
    moved: boolean
    others: number[]
}

type Gesture =
    | ClipGesture
    | { type: 'scrub' }
    | { type: 'loop'; anchor: number; key: string }
    | { type: 'marker'; id: string; key: string; moved: boolean; startX: number; origin: number }
    | { type: 'reorder'; id: string; key: string }

function groupClass(group: BeatGroup): string {
    return `group-${group.toLowerCase()}`
}

/** The time ruler, per-object tracks, and clips you can drag, stretch, and reorder. */
export class Timeline {
    readonly element: HTMLElement
    private readonly scroller: HTMLElement
    private readonly ruler: HTMLCanvasElement
    private readonly rows: HTMLElement
    private readonly content: HTMLElement
    private readonly playhead: HTMLElement
    private readonly timeInput: HTMLInputElement
    private readonly frameLabel: HTMLElement
    private readonly durationLabel: HTMLElement
    private readonly playButton: HTMLButtonElement
    private readonly speedSelect: HTMLSelectElement
    private readonly loopButton: HTMLButtonElement
    private readonly snapButton: HTMLButtonElement
    private readonly zoomSlider: HTMLInputElement
    private readonly addBeatButton: HTMLButtonElement
    private pps = 90
    private autoFit = true
    private fittedDuration = -1
    private gesture: Gesture | null = null
    private gestureCount = 0
    private readOnlyClips: ReadOnlyClip[] | null = null
    private readOnlyDuration = 0

    constructor(private readonly app: App) {
        this.ruler = h('canvas', { class: 'tl-ruler', 'data-test': 'ruler' })
        this.rows = h('div', { class: 'tl-rows' })
        this.playhead = h('div', { class: 'tl-playhead', 'data-test': 'playhead' })
        this.content = h('div', { class: 'tl-content' }, h('div', { class: 'tl-ruler-row' }, h('div', { class: 'tl-corner' }, 'Tracks'), this.ruler), this.rows, this.playhead)
        this.scroller = h('div', { class: 'tl-scroller', 'data-test': 'timeline-scroller' }, this.content)
        this.scroller.addEventListener('scroll', () => this.drawRuler())
        this.scroller.addEventListener('pointerdown', (event) => this.onPointerDown(event))
        this.scroller.addEventListener('dblclick', (event) => this.onDoubleClick(event))
        this.scroller.addEventListener('wheel', (event) => this.onWheel(event), { passive: false })

        this.timeInput = h('input', {
            class: 'tl-time', type: 'text', spellcheck: 'false', 'aria-label': 'Playhead time', 'data-test': 'time-input',
            onChange: () => this.commitTimeInput(),
            onKeydown: (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    this.commitTimeInput()
                    this.timeInput.blur()
                }
            },
        })
        this.frameLabel = h('span', { class: 'tl-frame' })
        this.durationLabel = h('span', { class: 'tl-duration', 'data-test': 'duration' })
        this.playButton = iconButton('play', { title: 'Play or pause (Space)', testId: 'play', class: 'play-button', onClick: () => this.app.togglePlay() })
        this.speedSelect = h('select', { class: 'tl-select', title: 'Playback speed', 'aria-label': 'Playback speed', 'data-test': 'speed', onChange: () => this.app.setSpeed(Number(this.speedSelect.value)) },
            [0.25, 0.5, 1, 1.5, 2].map((speed) => h('option', { value: String(speed), selected: speed === 1 }, `${speed}x`)))
        this.loopButton = iconButton('loop', { title: 'Loop (L). Shift-drag the ruler to set a region', testId: 'loop', onClick: () => this.app.toggleLoop() })
        this.snapButton = iconButton('magnet', { title: 'Snap while dragging', testId: 'snap', active: true, class: 'edit-only', onClick: () => this.app.toggleSnapping() })
        this.zoomSlider = h('input', {
            class: 'tl-zoom', type: 'range', min: '10', max: '420', value: String(this.pps), 'aria-label': 'Timeline zoom', title: 'Timeline zoom',
            onInput: () => {
                this.autoFit = false
                this.setPps(Number(this.zoomSlider.value))
            },
        })
        this.addBeatButton = h('button', {
            type: 'button', class: 'text-button is-accent', title: 'Add animation (N)', 'data-test': 'add-beat',
            onClick: () => this.app.openBeatPicker(this.addBeatButton),
        }, icon('plus', 14), 'Animate')
        const bar = h('div', { class: 'tl-bar' },
            h('div', { class: 'tl-group' },
                iconButton('start', { title: 'Go to start (Home)', onClick: () => this.app.seek(0) }),
                iconButton('back', { title: 'Previous frame (,)', onClick: () => this.app.stepFrames(-1) }),
                this.playButton,
                iconButton('forward', { title: 'Next frame (.)', onClick: () => this.app.stepFrames(1) }),
                iconButton('end', { title: 'Go to end (End)', onClick: () => this.app.seek(this.duration) })),
            h('div', { class: 'tl-group tl-readout' }, this.timeInput, h('span', { class: 'tl-sep' }, '/'), this.durationLabel, this.frameLabel),
            h('div', { class: 'tl-group' }, this.speedSelect, this.loopButton, iconButton('marker', { title: 'Add chapter at playhead (M)', testId: 'add-marker', class: 'edit-only', onClick: () => this.app.addMarker() }), this.snapButton),
            h('div', { class: 'tl-spacer' }),
            this.addBeatButton,
            h('div', { class: 'tl-group' }, iconButton('fit', { title: 'Fit to width', onClick: () => this.fit() }), this.zoomSlider))
        this.element = h('section', { class: 'timeline', 'aria-label': 'Timeline', 'data-test': 'timeline' }, bar, this.scroller)
        new ResizeObserver(() => {
            if (this.autoFit) this.fit(false)
            this.layoutContent()
            this.drawRuler()
        }).observe(this.scroller)
    }

    get duration(): number {
        return this.readOnlyClips ? this.readOnlyDuration : projectDuration(this.app.store.project)
    }

    private get viewWidth(): number {
        return Math.max(40, this.scroller.clientWidth - NAME_WIDTH)
    }

    private setPps(value: number): void {
        const anchorTime = this.app.time
        const before = anchorTime * this.pps - this.scroller.scrollLeft
        this.pps = Math.max(4, Math.min(600, value))
        this.zoomSlider.value = String(this.pps)
        this.layoutContent()
        this.render()
        this.scroller.scrollLeft = Math.max(0, anchorTime * this.pps - before)
        this.drawRuler()
    }

    /** Fit the whole film in the visible width. */
    fit(explicit = true): void {
        if (explicit) this.autoFit = true
        this.fittedDuration = this.duration
        const span = Math.max(this.duration, 4)
        this.pps = Math.max(4, Math.min(420, (this.viewWidth - 24) / span))
        this.zoomSlider.value = String(this.pps)
        this.layoutContent()
        this.render()
        this.scroller.scrollLeft = 0
    }

    private layoutContent(): void {
        const width = Math.max(this.viewWidth, (this.duration + 2) * this.pps + 40)
        this.content.style.width = `${NAME_WIDTH + width}px`
    }

    /** In code mode the timeline shows what the film reports and cannot be edited. */
    setReadOnly(clips: ReadOnlyClip[] | null, duration = 0): void {
        this.readOnlyClips = clips
        this.readOnlyDuration = duration
        this.element.classList.toggle('is-readonly', clips !== null)
        if (this.autoFit) this.fit(false)
        this.render()
    }

    private timeAt(clientX: number): number {
        const rect = this.scroller.getBoundingClientRect()
        return (clientX - rect.left - NAME_WIDTH + this.scroller.scrollLeft) / this.pps
    }

    // ── Rendering ───────────────────────────────────────────────────────────

    render(): void {
        const project = this.app.store.project
        // Refit as the film changes length, but never under a drag that is in progress.
        if (this.autoFit && !this.gesture && Math.abs(this.duration - this.fittedDuration) > 1e-3) this.fit(false)
        this.layoutContent()
        clear(this.rows)
        if (this.readOnlyClips) {
            const row = h('div', { class: 'tl-row' }, h('div', { class: 'tl-name' }, h('span', { class: 'tl-name-text' }, 'Film')),
                h('div', { class: 'tl-lane', style: { height: `${LANE_HEIGHT * 2}px` } },
                    this.readOnlyClips.map((clip, index) => h('div', {
                        class: 'tl-clip group-change is-readonly', title: clip.label,
                        style: { left: `${clip.t0 * this.pps}px`, width: `${Math.max(3, (clip.t1 - clip.t0) * this.pps)}px`, top: `${(index % 2) * LANE_HEIGHT + 2}px` },
                    }, h('span', { class: 'tl-clip-label' }, clip.label)))))
            this.rows.appendChild(row)
        } else {
            const valueBeats = project.beats.filter((beat) => beat.target === VALUE_TRACK)
            if (valueBeats.length || project.variables.length) this.rows.appendChild(this.renderRow(project, VALUE_TRACK, 'Values', valueBeats))
            for (let i = project.objects.length - 1; i >= 0; i--) {
                const object = project.objects[i]!
                const beats = project.beats.filter((beat) => beat.target === object.id)
                this.rows.appendChild(this.renderRow(project, object.id, object.name, beats))
            }
            if (project.objects.length === 0) {
                this.rows.appendChild(h('div', { class: 'tl-empty' }, 'Add an object, then press N to animate it.'))
            }
        }
        this.durationLabel.textContent = formatTime(this.duration)
        this.syncTransport()
        this.drawRuler()
        this.updatePlayhead()
    }

    private renderRow(_project: StudioProject, id: string, name: string, beats: readonly Beat[]): HTMLElement {
        const lanes = laneOf(beats)
        const laneCount = Math.max(1, ...[...lanes.values()].map((lane) => lane + 1))
        const selected = this.app.store.selection.includes(id)
        const errors = this.app.built?.beatErrors
        const clips = beats.map((beat) => {
            const def = BEATS[beat.kind]
            const group = def?.group ?? 'Change'
            const lane = lanes.get(beat.id) ?? 0
            const instant = beat.duration === 0
            const width = instant ? 12 : Math.max(4, beat.duration * this.pps)
            const isSelected = this.app.store.selectedBeat === beat.id
            return h('div', {
                class: `tl-clip ${groupClass(group)}${isSelected ? ' is-selected' : ''}${instant ? ' is-instant' : ''}${errors?.has(beat.id) ? ' has-error' : ''}`,
                'data-beat': beat.id,
                title: `${def?.label ?? beat.kind}  ${beat.start.toFixed(2)}s to ${beatEnd(beat).toFixed(2)}s${errors?.get(beat.id) ? `\n${errors.get(beat.id)}` : ''}`,
                style: {
                    left: `${(instant ? beat.start * this.pps - 6 : beat.start * this.pps)}px`,
                    width: `${width}px`,
                    top: `${lane * LANE_HEIGHT + 2}px`,
                },
            },
            instant ? null : h('span', { class: 'tl-edge is-left', 'data-edge': 'left' }),
            instant ? null : h('span', { class: 'tl-clip-label' }, def?.label ?? beat.kind),
            instant ? null : h('span', { class: 'tl-edge is-right', 'data-edge': 'right' }))
        })
        const nameCell = h('div', { class: `tl-name${selected ? ' is-selected' : ''}`, 'data-track': id, title: name },
            id !== VALUE_TRACK ? h('span', { class: 'tl-grip', 'data-grip': id, title: 'Drag to reorder' }) : h('span', { class: 'tl-grip is-empty' }),
            h('span', { class: 'tl-name-text' }, name),
            h('button', {
                type: 'button', class: 'tl-add', title: `Add animation to ${name}`, 'aria-label': `Add animation to ${name}`, 'data-add-beat': id,
                onClick: (event: MouseEvent) => {
                    event.stopPropagation()
                    this.app.openBeatPicker(event.currentTarget as HTMLElement, id)
                },
            }, icon('plus', 12)))
        return h('div', { class: `tl-row${selected ? ' is-selected' : ''}`, 'data-row': id },
            nameCell,
            h('div', { class: 'tl-lane', style: { height: `${laneCount * LANE_HEIGHT}px` } }, clips))
    }

    syncTransport(): void {
        const project = this.app.store.project
        this.playButton.replaceChildren(icon(this.app.playing ? 'pause' : 'play'))
        this.loopButton.classList.toggle('is-active', this.app.looping)
        this.snapButton.classList.toggle('is-active', this.app.snapping)
        this.addBeatButton.hidden = project.mode === 'code'
    }

    updatePlayhead(): void {
        const time = this.app.time
        const x = NAME_WIDTH + time * this.pps
        this.playhead.style.transform = `translateX(${x}px)`
        if (document.activeElement !== this.timeInput) this.timeInput.value = formatTime(time)
        this.frameLabel.textContent = `f${Math.round(time * this.app.fps)}`
        // While playing, keep the playhead in view.
        if (this.app.playing) {
            const left = this.scroller.scrollLeft, width = this.viewWidth
            const local = time * this.pps
            if (local < left || local > left + width - 30) this.scroller.scrollLeft = Math.max(0, local - width * 0.15)
        }
        this.drawRuler()
    }

    private commitTimeInput(): void {
        const text = this.timeInput.value.trim()
        const match = /^(?:(\d+):)?(\d*\.?\d+)$/.exec(text)
        if (match) this.app.seek((match[1] ? Number(match[1]) * 60 : 0) + Number(match[2]))
        else this.timeInput.value = formatTime(this.app.time)
    }

    private drawRuler(): void {
        const ruler = this.ruler
        const width = this.viewWidth
        const ratio = Math.min(2, window.devicePixelRatio || 1)
        if (ruler.width !== Math.round(width * ratio) || ruler.height !== Math.round(RULER_HEIGHT * ratio)) {
            ruler.width = Math.round(width * ratio)
            ruler.height = Math.round(RULER_HEIGHT * ratio)
            ruler.style.width = `${width}px`
            ruler.style.height = `${RULER_HEIGHT}px`
        }
        const ctx = ruler.getContext('2d')
        if (!ctx) return
        const style = getComputedStyle(this.element)
        const dim = style.getPropertyValue('--text-dim') || '#8b8e96'
        const faint = style.getPropertyValue('--line-strong') || '#3a3c44'
        const accent = style.getPropertyValue('--accent') || '#ffd75e'
        const scroll = this.scroller.scrollLeft
        const pps = this.pps
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.clearRect(0, 0, width, RULER_HEIGHT)
        const step = TICK_STEPS.find((candidate) => candidate * pps >= 56) ?? 600
        const minor = step / 5
        const first = Math.floor(scroll / pps / minor) * minor
        ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'
        ctx.textBaseline = 'top'
        const duration = this.duration
        // Everything past the end of the film is dimmed.
        const endX = duration * pps - scroll
        if (endX < width) {
            ctx.fillStyle = 'rgba(0,0,0,0.28)'
            ctx.fillRect(Math.max(0, endX), 0, width - Math.max(0, endX), RULER_HEIGHT)
        }
        for (let time = first; time * pps - scroll < width + 40; time += minor) {
            const x = Math.round(time * pps - scroll) + 0.5
            const index = Math.round(time / minor)
            const major = index % 5 === 0
            ctx.strokeStyle = faint
            ctx.beginPath()
            ctx.moveTo(x, RULER_HEIGHT)
            ctx.lineTo(x, RULER_HEIGHT - (major ? 9 : 4))
            ctx.stroke()
            if (major) {
                ctx.fillStyle = dim
                const seconds = Math.round(time * 100) / 100
                ctx.fillText(seconds >= 60 ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}` : `${seconds}s`, x + 3, 5)
            }
        }
        const project = this.app.store.project
        if (project.loop) {
            const x0 = project.loop.from * pps - scroll, x1 = project.loop.to * pps - scroll
            ctx.fillStyle = this.app.looping ? 'rgba(255,215,94,0.2)' : 'rgba(255,255,255,0.08)'
            ctx.fillRect(x0, 0, x1 - x0, RULER_HEIGHT)
            ctx.fillStyle = this.app.looping ? accent : dim
            ctx.fillRect(x0, 0, 1, RULER_HEIGHT)
            ctx.fillRect(x1 - 1, 0, 1, RULER_HEIGHT)
        }
        const chapters = this.readOnlyClips ? this.app.codeChapters : project.markers.map((marker) => ({ title: marker.title, time: marker.time }))
        for (const marker of chapters) {
            const x = marker.time * pps - scroll
            if (x < -120 || x > width + 8) continue
            ctx.fillStyle = accent
            ctx.beginPath()
            ctx.moveTo(x, 13)
            ctx.lineTo(x + 5, 13)
            ctx.lineTo(x + 5, 19)
            ctx.lineTo(x, 23)
            ctx.closePath()
            ctx.fill()
            ctx.fillRect(x, 13, 1, RULER_HEIGHT - 13)
            ctx.font = '10px Inter, system-ui, sans-serif'
            ctx.fillStyle = accent
            ctx.fillText(marker.title, x + 8, 15)
            ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'
        }
        // The playhead cap sits on the ruler, and the line runs through the tracks.
        const px = this.app.time * pps - scroll
        if (px >= -8 && px <= width + 8) {
            ctx.fillStyle = accent
            ctx.beginPath()
            ctx.moveTo(px - 5, 0)
            ctx.lineTo(px + 5, 0)
            ctx.lineTo(px + 5, 6)
            ctx.lineTo(px, 11)
            ctx.lineTo(px - 5, 6)
            ctx.closePath()
            ctx.fill()
        }
        this.playhead.style.height = `${this.content.scrollHeight}px`
    }

    // ── Gestures ────────────────────────────────────────────────────────────

    private onWheel(event: WheelEvent): void {
        if (!(event.ctrlKey || event.metaKey)) return
        event.preventDefault()
        this.autoFit = false
        const time = this.timeAt(event.clientX)
        const rect = this.scroller.getBoundingClientRect()
        const offset = event.clientX - rect.left - NAME_WIDTH
        this.pps = Math.max(4, Math.min(600, this.pps * Math.exp(-event.deltaY * 0.0022)))
        this.zoomSlider.value = String(this.pps)
        this.layoutContent()
        this.render()
        this.scroller.scrollLeft = Math.max(0, time * this.pps - offset)
        this.drawRuler()
    }

    private markerAt(clientX: number): string | null {
        const time = this.timeAt(clientX)
        for (const marker of this.app.store.project.markers) {
            if (Math.abs(marker.time - time) * this.pps <= 7) return marker.id
        }
        return null
    }

    private onDoubleClick(event: MouseEvent): void {
        // Pointer capture retargets the event to the scroller, so ask what is really under the pointer.
        const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null
        if (!target) return
        if (target === this.ruler) {
            const id = this.markerAt(event.clientX)
            if (id) this.app.editMarker(id, event.clientX, event.clientY)
            return
        }
        if (target.closest('[data-beat]')) this.app.inspector.showBeat()
    }

    private onPointerDown(event: PointerEvent): void {
        if (event.button !== 0) return
        const target = event.target as HTMLElement
        // Leave native scrollbars and buttons alone.
        if (target.closest('button')) return
        const rect = this.scroller.getBoundingClientRect()
        if (event.clientX > rect.left + this.scroller.clientWidth || event.clientY > rect.top + this.scroller.clientHeight) return
        const app = this.app
        const store = app.store
        if (target === this.ruler) {
            event.preventDefault()
            if (event.shiftKey && !this.readOnlyClips) {
                const anchor = round3(this.timeAt(event.clientX))
                this.gesture = { type: 'loop', anchor, key: `loop:${++this.gestureCount}` }
                this.begin(event)
                return
            }
            const marker = this.readOnlyClips ? null : this.markerAt(event.clientX)
            if (marker) {
                const origin = store.project.markers.find((entry) => entry.id === marker)!.time
                this.gesture = { type: 'marker', id: marker, key: `marker:${++this.gestureCount}`, moved: false, startX: event.clientX, origin }
                this.begin(event)
                return
            }
            this.gesture = { type: 'scrub' }
            app.seek(this.timeAt(event.clientX))
            this.begin(event)
            return
        }
        if (this.readOnlyClips) {
            if (target.closest('.tl-lane')) {
                this.gesture = { type: 'scrub' }
                app.seek(this.timeAt(event.clientX))
                this.begin(event)
            }
            return
        }
        const grip = target.closest<HTMLElement>('[data-grip]')
        if (grip) {
            event.preventDefault()
            const id = grip.dataset['grip']!
            store.select([id])
            this.gesture = { type: 'reorder', id, key: `reorder:${++this.gestureCount}` }
            this.begin(event)
            return
        }
        const clip = target.closest<HTMLElement>('[data-beat]')
        if (clip) {
            event.preventDefault()
            const id = clip.dataset['beat']!
            let beat = store.project.beats.find((entry) => entry.id === id)
            if (!beat) return
            if (event.altKey) beat = this.duplicateBeat(beat)
            store.select(beat.target === VALUE_TRACK ? [] : [beat.target], beat.id)
            const edge = target.dataset['edge'] as 'left' | 'right' | undefined
            const others = this.snapTargets(beat.id)
            this.gesture = { type: 'clip', id: beat.id, part: edge ?? 'body', startX: event.clientX, origin: structuredClone(beat), key: `clip:${++this.gestureCount}`, moved: false, others }
            this.begin(event)
            return
        }
        const name = target.closest<HTMLElement>('[data-track]')
        if (name) {
            const id = name.dataset['track']!
            if (id !== VALUE_TRACK) {
                if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    store.select(store.selection.includes(id) ? store.selection.filter((entry) => entry !== id) : [...store.selection, id])
                } else {
                    store.select([id])
                }
            }
            return
        }
        if (target.closest('.tl-lane') || target === this.rows || target === this.content) {
            event.preventDefault()
            const row = target.closest<HTMLElement>('[data-row]')
            const rowId = row?.dataset['row']
            if (rowId && rowId !== VALUE_TRACK) store.select([rowId])
            this.gesture = { type: 'scrub' }
            app.seek(this.timeAt(event.clientX))
            this.begin(event)
        }
    }

    private duplicateBeat(beat: Beat): Beat {
        const copy: Beat = { ...structuredClone(beat), id: createId('b') }
        this.app.store.commit((draft) => {
            draft.beats.push(copy)
        })
        return copy
    }

    private begin(event: PointerEvent): void {
        document.body.classList.add('is-dragging')
        dragPointer(event, this.scroller, {
            move: (next) => this.onMove(next),
            up: (next) => this.finish(next),
            cancel: () => this.finish(null),
        })
    }

    private snapTargets(excludeId: string): number[] {
        const project = this.app.store.project
        const points = [0, this.app.time]
        for (const marker of project.markers) points.push(marker.time)
        for (const beat of project.beats) {
            if (beat.id === excludeId) continue
            points.push(beat.start, beatEnd(beat))
        }
        return points
    }

    private snapTime(time: number, targets: readonly number[], event: PointerEvent): number {
        if (!this.app.snapping || event.metaKey || event.ctrlKey) return round3(Math.max(0, time))
        const threshold = SNAP_PIXELS / this.pps
        let best = time, distance = threshold
        for (const point of targets) {
            const gap = Math.abs(point - time)
            if (gap < distance) {
                distance = gap
                best = point
            }
        }
        if (best === time) best = Math.round(time / 0.05) * 0.05
        return round3(Math.max(0, best))
    }

    private onMove(event: PointerEvent): void {
        const gesture = this.gesture
        if (!gesture) return
        const app = this.app
        switch (gesture.type) {
            case 'scrub':
                app.seek(Math.max(0, this.timeAt(event.clientX)))
                break
            case 'loop': {
                const time = round3(Math.max(0, this.timeAt(event.clientX)))
                const from = Math.min(gesture.anchor, time), to = Math.max(gesture.anchor, time)
                app.store.commit((draft) => {
                    draft.loop = to - from > 0.02 ? { from, to } : null
                }, { merge: gesture.key })
                app.syncLoop()
                break
            }
            case 'marker': {
                if (!gesture.moved && Math.abs(event.clientX - gesture.startX) < 3) return
                gesture.moved = true
                const time = this.snapTime(gesture.origin + (event.clientX - gesture.startX) / this.pps, this.snapTargets(''), event)
                app.store.commit((draft) => {
                    const marker = draft.markers.find((entry) => entry.id === gesture.id)
                    if (marker) marker.time = time
                }, { merge: gesture.key })
                break
            }
            case 'clip': {
                const delta = (event.clientX - gesture.startX) / this.pps
                if (!gesture.moved && Math.abs(event.clientX - gesture.startX) < 3) return
                gesture.moved = true
                const origin = gesture.origin
                const end = origin.start + origin.duration
                let start = origin.start, duration = origin.duration
                if (gesture.part === 'body') {
                    const leading = this.snapTime(origin.start + delta, gesture.others, event)
                    const trailing = this.snapTime(end + delta, gesture.others, event)
                    const wantLeading = Math.abs(leading - (origin.start + delta))
                    const wantTrailing = Math.abs(trailing - (end + delta))
                    start = round3(Math.max(0, wantLeading <= wantTrailing ? leading : trailing - origin.duration))
                } else if (gesture.part === 'left') {
                    start = Math.min(this.snapTime(origin.start + delta, gesture.others, event), end - MIN_DURATION)
                    duration = round3(end - start)
                } else {
                    const nextEnd = Math.max(this.snapTime(end + delta, gesture.others, event), origin.start + MIN_DURATION)
                    duration = round3(nextEnd - origin.start)
                }
                app.store.commit((draft) => {
                    const beat = draft.beats.find((entry) => entry.id === gesture.id)
                    if (beat) {
                        beat.start = start
                        beat.duration = duration
                    }
                }, { merge: gesture.key })
                break
            }
            case 'reorder': {
                const under = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-row]')
                const overId = under?.dataset['row']
                if (!overId || overId === gesture.id || overId === VALUE_TRACK) return
                app.store.commit((draft) => {
                    const from = draft.objects.findIndex((object) => object.id === gesture.id)
                    const to = draft.objects.findIndex((object) => object.id === overId)
                    if (from < 0 || to < 0) return
                    const [moved] = draft.objects.splice(from, 1)
                    draft.objects.splice(to, 0, moved!)
                }, { merge: gesture.key })
                break
            }
        }
    }

    private finish(event: PointerEvent | null): void {
        document.body.classList.remove('is-dragging')
        const gesture = this.gesture
        this.gesture = null
        // Shift on release makes room: later clips on the track move right instead of overlapping.
        if (gesture?.type === 'clip' && gesture.moved && event?.shiftKey) this.ripple(gesture.id)
        this.app.store.settle()
        if (this.autoFit) this.render()
    }

    private ripple(id: string): void {
        this.app.store.commit((draft) => {
            const moved = draft.beats.find((beat) => beat.id === id)
            if (!moved) return
            const track = draft.beats
                .filter((beat) => beat.target === moved.target && beat.id !== id && beatEnd(beat) > moved.start)
                .sort((a, b) => a.start - b.start)
            let cursor = beatEnd(moved)
            for (const beat of track) {
                if (beat.start >= moved.start && beat.start < cursor) beat.start = round3(cursor)
                cursor = Math.max(cursor, beatEnd(beat))
            }
        })
    }

    /** True if an object has a clip on its track. Used to show hints. */
    hasBeats(id: string): boolean {
        return this.app.store.project.beats.some((beat) => beat.target === id)
    }

    objectName(id: string): string {
        return objectById(this.app.store.project, id)?.name ?? ''
    }
}
