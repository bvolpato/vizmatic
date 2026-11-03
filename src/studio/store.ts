import { emptyProject, type StudioProject } from './model'

export type ChangeKind = 'project' | 'selection' | 'history'

export interface CommitOptions {
    /** Consecutive commits with the same key become one undo step, such as a drag. */
    merge?: string
}

type Listener = (kinds: ReadonlySet<ChangeKind>) => void

const HISTORY_LIMIT = 200

/**
 * Holds the project and its history. Every change makes a new immutable project
 * from a draft, so undo restores a whole document with no per-feature code.
 */
export class Store {
    project: StudioProject = emptyProject()
    selection: readonly string[] = []
    selectedBeat: string | null = null
    private past: StudioProject[] = []
    private future: StudioProject[] = []
    private mergeKey: string | null = null
    private readonly listeners = new Set<Listener>()

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    private emit(...kinds: ChangeKind[]): void {
        const set = new Set(kinds)
        for (const listener of this.listeners) listener(set)
    }

    /** Apply a change to a draft of the project. */
    commit(change: (draft: StudioProject) => void, options: CommitOptions = {}): void {
        const draft = structuredClone(this.project)
        change(draft)
        if (options.merge === undefined || options.merge !== this.mergeKey) {
            this.past.push(this.project)
            if (this.past.length > HISTORY_LIMIT) this.past.shift()
        }
        this.mergeKey = options.merge ?? null
        this.future = []
        this.project = draft
        this.pruneSelection()
        this.emit('project', 'history')
    }

    /** End a merged run, so the next commit starts a new undo step. */
    settle(): void {
        this.mergeKey = null
    }

    /** Replace the whole document, for opening a file or a template. */
    load(project: StudioProject): void {
        this.project = project
        this.past = []
        this.future = []
        this.mergeKey = null
        this.selection = []
        this.selectedBeat = null
        this.emit('project', 'selection', 'history')
    }

    get canUndo(): boolean {
        return this.past.length > 0
    }

    get canRedo(): boolean {
        return this.future.length > 0
    }

    undo(): void {
        const previous = this.past.pop()
        if (!previous) return
        this.future.push(this.project)
        this.project = previous
        this.mergeKey = null
        this.pruneSelection()
        this.emit('project', 'selection', 'history')
    }

    redo(): void {
        const next = this.future.pop()
        if (!next) return
        this.past.push(this.project)
        this.project = next
        this.mergeKey = null
        this.pruneSelection()
        this.emit('project', 'selection', 'history')
    }

    select(ids: readonly string[], beat: string | null = null): void {
        const same = ids.length === this.selection.length && ids.every((id, i) => id === this.selection[i])
        if (same && beat === this.selectedBeat) return
        this.selection = ids
        this.selectedBeat = beat
        this.emit('selection')
    }

    private pruneSelection(): void {
        const ids = new Set(this.project.objects.map((object) => object.id))
        const kept = this.selection.filter((id) => ids.has(id))
        if (kept.length !== this.selection.length) this.selection = kept
        if (this.selectedBeat && !this.project.beats.some((beat) => beat.id === this.selectedBeat)) this.selectedBeat = null
    }
}
