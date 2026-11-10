import { assertEqual, column, connector, narrated, place, sceneKit, type SceneClock, type Stage } from 'vizmatic/stage'
import timing from './timing.json'
import times from './data/numbers.json'

const total = times.load + times.parse + times.save
const remaining = total - times.parse
const savedPercent = 100 * times.parse / total
assertEqual([total, remaining, savedPercent], [12, 6, 50], 'the totals spoken in script.json')

const { area, heading, source, label, display } = sceneKit({ size: 48 })
const [diagramBand, resultBand] = area.rows(2)
const cells = diagramBand!.columns(3, 160)
const footnote = () => source('Illustration: invented times, one task at a time.')

function task(name: string, ms: number, index: number, color: string) {
    const title = label(name, { size: 56 })
    const value = display(`${ms} ms`, { size: 104, color })
    const block = place(column([title, value], { gap: 'wide' }), cells[index]!)
    return { title, value, block }
}

function path() {
    const load = task('Load', times.load, 0, 'blue')
    const parse = task('Parse', times.parse, 1, 'yellow')
    const save = task('Save', times.save, 2, 'teal')
    const wires = [
        connector(load.block, parse.block, { route: 'straight', color: 'dim', width: 4 }),
        connector(parse.block, save.block, { route: 'straight', color: 'dim', width: 4 }),
    ]
    return { load, parse, save, wires, all: [...load.block.nodes, ...parse.block.nodes, ...save.block.nodes, ...wires] }
}

function serial(s: Stage, c: SceneClock) {
    s.add(heading('Tasks run one after another'), footnote())
    s.add(place(label('One task at a time', { size: 64 }), resultBand!))
    const p = path()
    assertEqual(c.cue('numeric-four').data, times.load, 'the numeric cue agrees with the task time')
    c.show('load-name', p.load.title)
    c.show('numeric-four', p.load.value, { after: true })
    c.show('parse-name', [p.parse.block, p.wires[0]!])
    c.show('save-name', [p.save.block, p.wires[1]!])
    c.keep(p.all)
}

function sum(s: Stage, c: SceneClock) {
    s.add(heading('Serial time is a sum'), footnote())
    const p = path()
    c.take(p.all)
    const question = place(display(`${times.load} + ${times.parse} + ${times.save} = ?`, { size: 92 }), resultBand!)
    const answer = place(display(`${times.load} + ${times.parse} + ${times.save} = ${total} ms`, { size: 92, color: 'teal' }), resultBand!)
    c.show('add-times', question)
    c.swap('total', question, answer, { after: true })
    c.keep(p.all)
}

function skip(s: Stage, c: SceneClock) {
    s.add(heading('Remove work to save its time'), footnote())
    const p = path()
    c.take(p.all)
    const skipped = task('Skip parse', 0, 1, 'dim')
    c.swap('skip-parse', p.parse.block, skipped.block, { after: true })
    const [equationBand, savingBand] = resultBand!.rows(2)
    const question = place(display(`${total} − ${times.parse} = ?`, { size: 92 }), equationBand!)
    const answer = place(display(`${total} − ${times.parse} = ${remaining} ms`, { size: 92, color: 'teal' }), equationBand!)
    const saving = place(label(`${savedPercent}% less time`, { size: 56, color: 'teal' }), savingBand!)
    c.show('subtract', question)
    c.swap('remaining', question, answer, { after: true })
    c.show('saved-percent', saving, { after: true })
}

export default narrated({
    title: 'Three tasks, one clock',
    description: 'Add serial task times, then calculate the time saved by removing one task.',
    intro: { title: 'Three tasks, one clock', subtitle: 'Add the work. Then remove a step.' },
    fps: 24,
    timing,
    scenes: { serial, sum, skip },
})
