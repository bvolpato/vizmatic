import { describe, expect, it } from 'vitest'
import { PlaygroundHistory, readPlaygroundDraft, savePlaygroundDraft } from '../src/playground-history'

describe('playground history and drafts', () => {
    it('undoes programmatic changes, branches after undo, and ignores unchanged source', () => {
        const history = new PlaygroundHistory('initial')
        history.record('text edit')
        history.record('slider edit')
        history.record('slider edit')
        expect(history.undo()).toBe('text edit')
        expect(history.redo()).toBe('slider edit')
        history.undo()
        history.record('new branch')
        expect(history.canRedo).toBe(false)
        expect(history.undo()).toBe('text edit')
        expect(history.undo()).toBe('initial')
        expect(history.undo()).toBeUndefined()
    })

    it('groups a typing burst but preserves the baseline and separates controls', () => {
        const history = new PlaygroundHistory('initial')
        history.record('a', 'typing', 1000)
        history.record('ab', 'typing', 1200)
        history.record('abc', 'typing', 1400)
        history.record('wider', 'width', 1500)
        expect(history.undo()).toBe('abc')
        expect(history.undo()).toBe('initial')
        expect(history.redo()).toBe('abc')
    })

    it('bounds history and resets restored source as its baseline', () => {
        const history = new PlaygroundHistory('0', 3)
        for (const value of ['1', '2', '3']) history.record(value)
        expect(history.undo()).toBe('2')
        expect(history.undo()).toBe('1')
        expect(history.canUndo).toBe(false)
        history.reset('restored')
        expect(history.canRedo).toBe(false)
        expect(history.canUndo).toBe(false)
    })

    it('round-trips a draft and handles corrupted or inaccessible storage', () => {
        let raw: string | null = null
        const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } }
        const draft = { version: 1 as const, source: '<Scene title="draft" />', theme: 'light' as const, background: 'theme' as const, updatedAt: 10 }
        expect(savePlaygroundDraft(storage, 'draft', draft)).toBe(true)
        expect(readPlaygroundDraft(storage, 'draft')).toEqual(draft)
        raw = '{broken'
        expect(readPlaygroundDraft(storage, 'draft')).toBeUndefined()
        raw = JSON.stringify({ ...draft, theme: 'invalid' })
        expect(readPlaygroundDraft(storage, 'draft')).toBeUndefined()
        const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } }
        expect(readPlaygroundDraft(blocked, 'draft')).toBeUndefined()
        expect(savePlaygroundDraft(blocked, 'draft', draft)).toBe(false)
    })
})
