// Prompt engineering: two prompts pass the same number of cases but fail on different inputs.
import { film, place, sceneKit, table, type TableColumn, type TableRowView } from 'vizmatic/stage'

const CASES = [
    { id: 'first', name: 'first page is due', old: true, revised: true },
    { id: 'overdue', name: 'page is overdue', old: false, revised: true },
    { id: 'prior', name: 'a page was sent before', old: true, revised: false },
    { id: 'no-p1', name: 'no P1 was declared', old: true, revised: true },
    { id: 'no-time', name: 'declaration time is missing', old: false, revised: false },
    { id: 'second', name: 'second incident, same service', old: true, revised: true },
] as const

const passed = (key: string) => (rows: readonly TableRowView[]) => `${rows.filter((row) => row.states[key] === 'pass').length}/${rows.length}`
const COLUMNS: TableColumn[] = [
    { key: 'name', label: 'incident case', total: () => 'passed' },
    { key: 'old', label: 'old prompt', align: 'center', total: passed('old') },
    { key: 'revised', label: 'revised prompt', align: 'center', total: passed('revised') },
]

export default film({ title: 'One regression suite, two prompts', fps: 30 }, (s) => {
    const { area, heading, note } = sceneKit()
    s.add(heading('One regression suite, two prompts'))
    const results = place(table(COLUMNS, CASES.map((item) => ({ id: item.id, name: item.name, old: { state: 'pending' }, revised: { state: 'pending' } })), { size: 36 }), area)
    s.play(results.enter(), { duration: 1.2 })
    s.wait(0.3)
    // A marker passes each cell of a column, and the cell turns to pass or fail. The total of the column counts with it.
    for (const key of ['old', 'revised'] as const) {
        for (const item of CASES) {
            s.play(results.light(item.id, key), results.setCell(item.id, key, { state: item[key] ? 'pass' : 'fail' }), { duration: 0.4 })
        }
        s.wait(0.4)
    }
    const changes = results.find((row) => row.states.old !== row.states.revised)
    s.add(place(note(`Pass totals: ${results.totalOf('old')} and ${results.totalOf('revised')}. Verdicts differ on ${changes.length} cases.`), area, 'bottom'))
    s.play(results.light('overdue'), { duration: 0.5 })
    s.wait(1.1)
    s.play(results.light('prior'), { duration: 0.5 })
    s.wait(1.1)
    s.play(results.light(null), { duration: 0.4 })
    s.wait(0.6)
})
