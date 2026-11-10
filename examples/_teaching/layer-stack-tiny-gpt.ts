// Lesson: build-gpt-from-scratch-lab (Advanced training and adaptation, part 1 of 2).
// Scene idea of the survey: in the forward scene, draw the tiny GPT as a stack: token and position
// embedding, masked attention, MLP, output scores. Send the token "Birds" up the stack as a short vector
// whose numbers change at each layer. At the top, the four scores become the four bars of the loss scene.
import { barChart, film, layerStack, place, sceneKit } from 'vizmatic/stage'

const WORDS = ['fly', 'sing', 'swim', 'sleep']
// Illustrative next-token scores, shared by the vector and the bars.
const SCORES = [2.1, 1.4, 0.2, 0.6]

export default film({ fps: 30, font: 'text-serif', title: 'Where the scores come from' }, (s) => {
    const { area, heading } = sceneKit()
    const [left, right] = area.columns(2)
    const model = place(layerStack([
        { label: 'token + position', color: 'purple', shape: '4 numbers' },
        { branch: [{ label: 'masked attention', color: 'orange' }] },
        { branch: [{ label: 'MLP', color: 'blue' }] },
        { label: 'scores', color: 'green', shape: '4 scores' },
    ], { digits: 1, shape: '"Birds"', size: 28 }), left!)
    const bars = place(barChart(WORDS.map((label, index) => ({ label, value: SCORES[index]! })), {
        width: right!.width * 0.7, height: right!.height * 0.5, labelSize: 34, color: 'green',
    }), right!)

    s.add(heading('One token goes up, and four scores come out'))
    s.play(model.enter(), { duration: 1.2 })
    s.play(model.feed([0, 0, 0, 0]))
    s.play(model.pass('token + position', [0.5, -1.2, 0.3, 0.9]), { duration: 1.2 })
    s.wait(0.5)
    // Each branch reads the stream, and its add puts the result back: -1.2 + 0.7 is -0.5.
    s.play(model.pass('masked attention', [0.9, -0.5, 0.3, 1.4]), { duration: 3.4 })
    s.wait(0.5)
    s.play(model.pass('MLP', [1.6, -0.5, -0.4, 1.4]), { duration: 3.4 })
    s.wait(0.5)
    s.play(model.pass('scores', SCORES), { duration: 1.2 })
    s.play(model.light('scores'), bars.enter(), { duration: 1.2 })
    s.wait(1.2)
})
