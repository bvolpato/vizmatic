/**
 * Lesson `decoding`: temperature reshapes one next-token distribution, top-k removes its tail, and a
 * fixed draw selects a surviving token. Blue is probability, a cross means excluded, and a check means
 * selected. The fixed draw makes the film repeatable. The sum is computed from the bars at every frame.
 */
import { assertEqual, barChart, column, decimal, film, place, row, sceneArea, text } from 'vizmatic/stage'

const TOKENS = ['sat', 'slept', 'ran', 'ate', 'flew']
const LOGITS = [2, 1.2, 0.6, 0.1, -0.9]
const KEEP = 3
const DRAW = 0.7

function softmax(temperature: number): number[] {
    const weights = LOGITS.map((logit) => Math.exp(logit / temperature))
    const sum = weights.reduce((a, b) => a + b, 0)
    return weights.map((weight) => weight / sum)
}

export default film({ title: 'Keep three tokens, keep all the probability', fps: 60, font: 'sans' }, (s) => {
    const [top, rest] = sceneArea().rows([1, 4])
    const title = text('The cat ___', { size: 56, font: 'mono' })
    const temperature = s.value(1)
    const dial = decimal(() => temperature.value, { digits: 1, size: 34, color: 'dim', prefix: 'target temperature ' })
    const chart = barChart(TOKENS.map((label, i) => ({ label, value: softmax(1)[i]! })), {
        width: 1100, height: 440, max: 1, ticks: [0, 0.5, 1], labelSize: 32, barColor: 'blue', states: true,
        format: (value) => value.toFixed(2), cutAfter: { count: KEEP, label: (count) => `top ${count}` },
    })
    const mass = decimal(() => chart.values.reduce((sum, value) => sum + value.value, 0), {
        digits: 2, size: 34, color: 'dim', prefix: 'sum ',
    })
    place(column([title, row([dial, mass], { gap: 'wide' })], { gap: 'tight', align: 'center' }), top!)
    place(chart, rest!)
    chart.rankCut!.hide()
    s.add(title, dial, mass, chart)

    s.chapter('A distribution on a fixed scale')
    s.caption('The model assigns a probability to each possible next token.')
    s.play(chart.enter(), { duration: 1.4 })
    s.wait(0.8)
    s.chapter('Temperature changes the distribution')
    s.caption('A lower temperature sharpens the distribution. A higher temperature flattens it.')
    temperature.set(0.5)
    s.play(chart.update(softmax(0.5)), { duration: 1.2 })
    s.wait(0.8)
    temperature.set(2)
    s.play(chart.update(softmax(2)), { duration: 1.2 })
    s.wait(0.8)
    temperature.set(1)
    s.play(chart.update(softmax(1)), { duration: 1 })
    s.wait(0.6)

    s.chapter('Keep three and renormalize')
    s.caption('Top-k keeps three tokens. The others go to zero, and the survivors grow to sum to one.')
    s.play(chart.cutAfter(KEEP), { duration: 0.8 })
    s.wait(0.6)
    s.play(chart.mask(chart.tail()), { duration: 1.4 })
    assertEqual(chart.values.reduce((sum, value) => sum + value.value, 0), 1)
    s.wait(0.8)

    s.chapter('Select a surviving token')
    let cumulative = 0
    const selected = chart.values.findIndex((value) => (cumulative += value.value) > DRAW)
    assertEqual(TOKENS[selected], 'slept')
    s.caption('A fixed draw of 0.70 selects slept from the renormalized distribution.')
    s.play(chart.mark(selected, 'chosen'), { duration: 0.6 })
    s.wait(2.2)
})
