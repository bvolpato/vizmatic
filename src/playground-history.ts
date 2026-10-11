export class PlaygroundHistory {
    private entries: string[]
    private position = 0
    private group?: string
    private changedAt = 0

    constructor(source: string, private readonly limit = 100) {
        this.entries = [source]
    }

    get canUndo(): boolean { return this.position > 0 }
    get canRedo(): boolean { return this.position < this.entries.length - 1 }

    record(source: string, group?: string, now = Date.now()): void {
        if (source === this.entries[this.position]) return
        const merge = group !== undefined && group === this.group && now - this.changedAt < 800
            && this.position > 0 && !this.canRedo
        this.entries.splice(this.position + 1)
        if (merge) this.entries[this.position] = source
        else { this.entries.push(source); this.position += 1 }
        if (this.entries.length > this.limit) { this.entries.shift(); this.position -= 1 }
        this.group = group
        this.changedAt = now
    }

    reset(source: string): void {
        this.entries = [source]
        this.position = 0
        this.group = undefined
    }

    undo(): string | undefined {
        this.group = undefined
        if (!this.canUndo) return
        return this.entries[--this.position]
    }

    redo(): string | undefined {
        this.group = undefined
        if (!this.canRedo) return
        return this.entries[++this.position]
    }
}

export interface PlaygroundDraft {
    version: 1
    source: string
    theme: 'dark' | 'light'
    background: 'transparent' | 'theme'
    component?: string
    updatedAt: number
}

export function readPlaygroundDraft(storage: Pick<Storage, 'getItem'>, key: string): PlaygroundDraft | undefined {
    try {
        const value = JSON.parse(storage.getItem(key) ?? 'null')
        if (!value || value.version !== 1 || typeof value.source !== 'string' || !value.source.trim()
            || value.source.length > 500_000 || !['dark', 'light'].includes(value.theme)
            || !['transparent', 'theme'].includes(value.background) || !Number.isFinite(value.updatedAt)
            || value.component !== undefined && typeof value.component !== 'string') return
        return value
    } catch { return }
}

export function savePlaygroundDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: PlaygroundDraft): boolean {
    try {
        if (draft.source.length > 500_000) return false
        storage.setItem(key, JSON.stringify(draft))
        return true
    } catch { return false }
}
