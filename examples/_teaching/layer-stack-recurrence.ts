// RNN memory: unfold one cell over a sentence and follow one coordinate of its hidden state.
import { film, layerStack, place, sceneKit } from 'vizmatic/stage'

const words = ['The', 'dog', 'chased', 'the', 'cat']
const input = [0, 0.8, 0, 0, -0.8]

export default film({ title: 'One recurrent cell, five time steps', fps: 30, font: 'text-serif' }, (s) => {
    const { area, heading } = sceneKit()
    const [left, right] = area.columns(2)
    const model = place(layerStack([{
        label: 'time', repeat: words.length,
        layers: [{ id: 'cell', label: 'h = 0.5 × previous h + input', color: 'blue' }],
    }]), left!)
    const steps = place(layerStack(words.map((word, i) => ({
        id: String(i), label: `${i + 1}.  ${word}    input ${input[i]!.toFixed(1)}`, color: 'blue',
    })), { cells: 1, digits: 1, shape: 'h' }), right!)

    s.add(heading('One recurrent cell, five time steps'))
    s.play(model.enter())
    s.play(steps.enter(), model.open('cell', steps))
    let hidden = 0
    s.play(steps.feed([hidden]))
    for (const [i, value] of input.entries()) {
        hidden = 0.5 * hidden + value
        s.play(steps.light(String(i)), steps.pass(String(i), [hidden]), { duration: 1.2 })
        s.wait(0.5)
    }
    s.wait(1)
})
