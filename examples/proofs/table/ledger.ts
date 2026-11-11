// Production agent replay: a retry with the same operation key must leave exactly one effect.
import { fadeIn, fadeOut, film, place, sceneKit, table, type TableColumn } from 'vizmatic/stage'

const KEY = 'restore:A300:r-104'
// The ledger starts with no row, so each column names the longest value that it gets.
const COLUMNS: TableColumn[] = [
    { key: 'id', label: 'attempt', align: 'left' },
    { key: 'key', label: 'operation key', mono: true, sample: KEY, total: () => 'effects on the account' },
    { key: 'status', marks: true, sample: 'committed' },
    { key: 'effects', align: 'right', total: 'sum' },
]

export default film({ title: 'One operation key, one effect', fps: 30 }, (s) => {
    const { area, heading, note } = sceneKit()
    s.add(heading('One operation key, one effect'))
    const ledger = s.add(place(table(COLUMNS, [], { size: 40, maxRows: 1 }), area))
    const says = (words: string) => place(note(words), area, 'bottom')
    let line = s.add(says('The ledger of effects starts empty'))
    const next = (words: string) => {
        const before = line
        line = says(words)
        s.play(fadeOut(before), { duration: 0.25 })
        s.play(fadeIn(line), { duration: 0.25 })
    }
    s.wait(1.6)

    // Attempt 1 stops before the commit: its row falls away, and the account has no effect.
    next('Attempt 1 fails before the commit')
    s.play(ledger.append({ id: 1, key: KEY, status: { value: 'pending', state: 'pending' }, effects: 0 }), { duration: 0.7 })
    s.wait(0.5)
    s.play(ledger.setCell(1, 'status', { value: 'failed', state: 'fail' }), { duration: 0.5 })
    s.wait(0.7)
    s.play(ledger.remove(1), { duration: 0.7 })
    s.wait(0.3)

    // Attempt 2 commits: its row lands, and the account has one effect.
    next('Attempt 2 commits, and its row stays')
    s.play(ledger.append({ id: 2, key: KEY, status: { value: 'pending', state: 'pending' }, effects: 0 }), { duration: 0.7 })
    s.wait(0.4)
    s.play(ledger.setCell(2, 'status', { value: 'committed', state: 'pass' }), ledger.setCell(2, 'effects', 1), { duration: 0.6 })
    s.wait(1)

    // Attempt 3 comes with the same key. The ledger has that key, so the attempt adds no row and no effect.
    next('Attempt 3 has the same key: no new effect')
    s.play(ledger.light(2, 'key'), { duration: 0.5 })
    s.wait(2.2)
})
