import { describe, expect, it } from 'vitest'
import { byteDifferenceState, compareByteSequences, createTeachingByteDifference, escapedByte, layoutByteDifference } from '../src/teaching-byte-diff'
import type { CanvasPainter } from '../src/canvas-components'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('byte differences', () => {
    it('preserves every original and current offset through an insertion and deletion', () => {
        const inserted = compareByteSequences(bytes('abcd'), bytes('abXcd'))
        expect(inserted.commonPrefix).toBe(2)
        expect(inserted.commonSuffix).toBe(2)
        expect(inserted.columns.map(c => c.kind)).toEqual(['equal', 'equal', 'insert', 'equal', 'equal'])
        expect(inserted.columns[3]).toMatchObject({ before: { offset: 2, value: 99 }, after: { offset: 3, value: 99 } })
        const deleted = compareByteSequences(bytes('abXcd'), bytes('abcd'))
        expect(deleted.columns[2]).toMatchObject({ kind: 'delete', before: { offset: 2, value: 88 }, after: null })
        expect(deleted.columns[3]).toMatchObject({ before: { offset: 3 }, after: { offset: 2 } })
        for (const result of [inserted, deleted]) {
            expect(result.columns.flatMap(c => c.before ? [c.before.offset] : [])).toEqual(Array.from({ length: result.beforeLength }, (_, i) => i))
            expect(result.columns.flatMap(c => c.after ? [c.after.offset] : [])).toEqual(Array.from({ length: result.afterLength }, (_, i) => i))
        }
    })

    it('shows the exact removed CSV tail without inventing replacement bytes', () => {
        const result = compareByteSequences(bytes('4,0,82\n'), bytes('4,0,'))
        expect(result.columns.slice(4).map(c => [c.kind, c.before?.value, c.after])).toEqual([
            ['delete', 56, null], ['delete', 50, null], ['delete', 10, null],
        ])
        expect(result.algorithm).toBe('common-prefix/suffix with positional middle')
    })

    it('uses an explicitly positional middle for multiple edits rather than claiming minimal alignment', () => {
        const result = compareByteSequences(bytes('aXbYc'), bytes('aZbQc'))
        expect(result.columns.map(c => c.kind)).toEqual(['equal', 'replace', 'equal', 'replace', 'equal'])
        const original = new Uint8Array([0, 255]), current = original.slice()
        const snapshot = compareByteSequences(original, current)
        original[0] = 10
        expect(snapshot.columns[0].before?.value).toBe(0)
        expect(snapshot.equal).toBe(true)
    })

    it('handles identical and empty inputs and independently withholds the verdict at a completed scan', () => {
        expect(compareByteSequences(bytes(''), bytes('')).columns).toEqual([])
        expect(compareByteSequences(bytes(''), bytes('x')).columns[0].kind).toBe('insert')
        expect(compareByteSequences(bytes('x'), bytes('')).columns[0].kind).toBe('delete')
        expect(byteDifferenceState({ before: bytes('x'), after: bytes('y'), scanProgress: 1 }).verdict).toBeNull()
        expect(byteDifferenceState({ before: bytes('x'), after: bytes('y'), scanProgress: .25, revealVerdict: true }).verdict).toBe('different')
        expect(byteDifferenceState({ before: bytes('x'), after: bytes('x'), scanProgress: 1, revealVerdict: true }).verdict).toBe('equal')
        expect(() => byteDifferenceState({ before: bytes(''), after: bytes(''), scanProgress: NaN })).toThrow('finite')
    })

    it('escapes control and non-ASCII bytes without pretending to decode Unicode', () => {
        expect([0, 9, 10, 13, 27, 32, 65, 92, 255].map(escapedByte)).toEqual(['\\0', '\\t', '\\n', '\\r', '\\x1B', 'space', 'A', '\\\\', '\\xFF'])
        expect(() => escapedByte(256)).toThrow('byte')
    })

    it('keeps the visible window attached to real offsets and rejects geometry too small for its labels', () => {
        const options = { x: 0, y: 0, width: 1500, height: 360, fontSize: 28, before: bytes('0123456789'), after: bytes('012345X789'), scanProgress: 1, maxColumns: 4 }
        const layout = layoutByteDifference(options)
        expect(layout.omittedLeading).toBe(4)
        expect(layout.omittedTrailing).toBe(2)
        expect(layout.cells[0].column.before?.offset).toBe(4)
        expect(() => layoutByteDifference({ ...options, width: 100 })).toThrow('fit')
        expect(() => layoutByteDifference({ ...options, height: 10 })).toThrow('fit')
        expect(() => layoutByteDifference({ ...options, startColumn: 10 })).toThrow('outside')
    })

    it('uses checked host scopes and does not paint an unrevealed result', () => {
        const labels: string[] = []
        let scopes = 0
        const painter: CanvasPainter = {
            rect() {}, circle() {}, text(value) { labels.push(value) }, opacity(_alpha, draw) { draw() },
            container(_bounds, draw) { draw() }, labelScope(_bounds, draw) { scopes++; draw() },
        }
        const draw = createTeachingByteDifference(painter)
        const options = { x: 0, y: 0, width: 1400, height: 350, before: bytes('ab'), after: bytes('ac'), scanProgress: 1 }
        draw(options)
        expect(labels.some(v => v.includes('Bytes differ'))).toBe(false)
        expect(labels.some(v => v.includes('Verdict held'))).toBe(true)
        expect(scopes).toBeGreaterThan(2)
        labels.length = 0
        draw({ ...options, revealVerdict: true })
        expect(labels.some(v => v.includes('Bytes differ'))).toBe(true)
        const rejected = createTeachingByteDifference({ ...painter, labelScope() { throw new Error('host rejected label') } })
        expect(() => rejected(options)).toThrow('host rejected label')
    })

    it('rejects unusable insets and overflowing edges before calling the painter', () => {
        let painted = false
        const painter: CanvasPainter = {
            rect() { painted = true }, circle() { painted = true }, text() { painted = true },
            opacity(_alpha, draw) { painted = true; draw() },
            container(_bounds, draw) { painted = true; draw() }, labelScope(_bounds, draw) { painted = true; draw() },
        }
        const draw = createTeachingByteDifference(painter)
        const options = { x: 0, y: 0, width: 1500, height: 360, fontSize: 28, before: bytes('a'), after: bytes('b'), scanProgress: 1 }
        expect(() => draw({ ...options, height: 10, fontSize: 1 })).toThrow('at least 24')
        expect(() => draw({ ...options, x: Number.MAX_VALUE, width: Number.MAX_VALUE })).toThrow('finite')
        expect(() => draw({ ...options, y: Number.MAX_VALUE, height: Number.MAX_VALUE })).toThrow('finite')
        expect(painted).toBe(false)
        const minimum = layoutByteDifference({ ...options, fontSize: 24, height: 240 })
        expect(minimum.rowHeight * .3 - 8).toBeGreaterThan(0)
        expect(minimum.cells[0].beforeBounds.height - 4).toBeGreaterThan(0)
    })
})
