// Lesson: transformer (Preparation and prerequisites, part 1 of 2).
// Scene idea of the survey: give the lesson its machine. One decoder block as a tall diagram at the left
// (embed, norm, attention, add, norm, feed-forward, add, unembed), with the residual stream as one thick
// line. The token "the" enters at the bottom as a vector of four colored cells and travels up. The stage of
// the current scene lights, and its close-up opens at the right. Later scenes reuse the block with one
// change each, such as another norm.
import { film, heatmap, layerStack, place, sceneKit } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif', title: 'One decoder block' }, (s) => {
    const { area, heading } = sceneKit()
    const [left, right] = area.columns([4, 5])
    const model = place(layerStack([
        { label: 'embed', color: 'purple', shape: '4 numbers' },
        { repeat: 'N', label: 'block', layers: [
            { branch: [{ label: 'norm', id: 'norm 1', color: 'yellow' }, { label: 'attention', color: 'orange' }] },
            { branch: [{ label: 'norm', id: 'norm 2', color: 'yellow' }, { label: 'feed forward', color: 'blue' }] },
        ] },
        { label: 'norm', id: 'norm 3', color: 'yellow' },
        { label: 'unembed', color: 'green', shape: '4 scores' },
    ], { size: 26, shape: 'token "the"' }), left!)
    // The close-up of the attention step: the weights of "the" on the three tokens that it may read.
    const weights = place(heatmap([[0.2, 0.3, 0.5]], {
        cell: 150, values: true, valueSize: 40, labelSize: 34, rowLabels: ['the'], columnLabels: ['function', 'returns', 'the'], colors: ['surface', 'orange'], domain: [0, 1],
    }), right!)

    s.add(heading('One decoder block, and the stream that it adds to'))
    s.play(model.enter(), { duration: 1.6 })
    s.play(model.feed([0.6, -0.2, 0.1, 0.4]))
    s.play(model.pass('embed', [0.3, 0.7, -0.5, 0.1]))
    s.wait(0.4)

    // Attention reads the stream, and the add puts its result back on the stream.
    s.play(model.light('attention'), model.open('attention', weights))
    s.play(model.pass('attention', [0.5, 0.2, -0.1, 0.8]), { duration: 3 })
    s.wait(0.5)
    s.play(model.close(), model.light('feed forward'))
    s.play(model.pass('feed forward', [0.9, 0.1, -0.6, 0.6]), { duration: 2.6 })
    s.play(model.light(null), model.pass('unembed', [-0.4, 0.2, 0.9, 0.1]), { duration: 2 })
    s.wait(0.6)

    // One change, and the rest of the picture stays: another norm in the same two places.
    s.play(model.replace('norm 1', 'RMSNorm'), model.replace('norm 2', 'RMSNorm'))
    s.wait(1)
})
