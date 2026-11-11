// Model routing: filter six illustrative lanes by request requirements, then rank the survivors.
import { film, lagged, place, sceneKit, table, type TableColumn } from 'vizmatic/stage'

const LANES = [
    { id: 'A', context: false, schema: true, private: true, ceiling: true, cost: 0.0012, latency: 310 },
    { id: 'B', context: true, schema: false, private: true, ceiling: true, cost: 0.0019, latency: 380 },
    { id: 'C', context: true, schema: true, private: true, ceiling: true, cost: 0.0031, latency: 940 },
    { id: 'D', context: true, schema: true, private: true, ceiling: true, cost: 0.0042, latency: 620 },
    { id: 'E', context: true, schema: true, private: true, ceiling: true, cost: 0.0048, latency: 450 },
    { id: 'F', context: true, schema: true, private: true, ceiling: false, cost: 0.0065, latency: 700 },
] as const
const NEEDS = ['context', 'schema', 'private', 'ceiling'] as const

const COLUMNS: TableColumn[] = [
    { key: 'id', label: 'lane', mono: true },
    { key: 'context', label: '24,000 units', align: 'center', marks: true },
    { key: 'schema', label: 'cited-v3', align: 'center', marks: true },
    { key: 'private', label: 'private data', align: 'center', marks: true },
    { key: 'ceiling', label: 'under $0.005', align: 'center', marks: true },
    { key: 'cost', label: 'cost', format: (value) => `$${value.toFixed(4)}` },
    { key: 'latency', label: 'p50', format: (value) => `${value} ms` },
]

export default film({ title: 'Filter the lanes, then rank them', fps: 30 }, (s) => {
    const { area, heading, note } = sceneKit()
    s.add(heading('Request R900: filter the lanes, then rank them'))
    const board = place(table(COLUMNS, LANES.map((lane) => ({ id: lane.id, cost: lane.cost, latency: lane.latency })), { size: 34 }), area)
    s.play(board.enter(), { duration: 1.2 })
    // A sweep goes over the requirement columns and stamps each cell with a mark.
    for (const need of NEEDS) {
        s.play(board.light(null, need), { duration: 0.35 })
        s.play(lagged(LANES.map((lane) => board.setCell(lane.id, need, { state: lane[need] ? 'pass' : 'fail' })), { lag: 0.4 }), { duration: 0.8 })
    }
    s.play(board.light(null), { duration: 0.3 })
    s.wait(0.3)
    // The lanes that fail one requirement leave, and C, D and E move up.
    s.play(board.remove((row) => NEEDS.some((need) => row.states[need] === 'fail')), { duration: 1.1 })
    s.wait(0.5)
    // The three lanes that stay are in the order of their cost. The preference changes to latency, and they trade places.
    s.play(board.light(null, 'cost'), { duration: 0.4 })
    s.wait(1)
    const cheapest = board.ids[0]
    s.play(board.light(null, 'latency'), board.sort('latency'), { duration: 1.2 })
    s.add(place(note(`Lane ${cheapest} costs the least. Lane ${board.ids[0]} has the lowest p50 latency.`), area, 'bottom'))
    s.wait(3.4)
})
