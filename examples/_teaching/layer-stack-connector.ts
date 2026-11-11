// Lesson: multimodal-fusion (System design capstones).
// Scene idea of the survey: in the connector scene, the tiles of the picture pass a projector, which keeps
// the 576 tiles and makes each one wider. The vision encoder and the language model do not train. The film
// shows what trains: the projector, and a small branch beside the frozen language model.
import { beside, fadeIn, film, layerStack, place, sceneKit } from 'vizmatic/stage'

export default film({ fps: 30, font: 'text-serif', title: 'A connector between two frozen models' }, (s) => {
    const { area, heading, note } = sceneKit()
    const model = place(layerStack([
        { label: 'patch embed', color: 'purple', shape: '576 x 1024' },
        { label: 'vision encoder', color: 'purple' },
        { label: 'projector', color: 'orange', shape: '576 x 4096' },
        { branch: [{ label: 'LoRA', color: 'orange' }], around: { label: 'LLM', color: 'blue' }, shown: false },
        { label: 'answer head', color: 'green', shape: '32000 scores' },
    ], { shape: '576 patches' }), area)
    const trains = beside(note('the projector trains', { color: 'orange' }), model, 'right', 'wide', model.block('projector'))
    const small = beside(note('a small branch trains too', { color: 'orange' }), model, 'right', 'wide', model.block('LoRA'))

    s.add(heading('What trains, and what stays frozen'))
    s.play(model.enter(), { duration: 1.4 })
    s.play(model.mark(['patch embed', 'vision encoder', 'LLM'], 'frozen', { lag: 0.3 }), { duration: 0.9 })
    s.wait(0.4)

    // The picture goes up as 576 vectors. The projector keeps the count and changes the width.
    s.play(model.feed([0.4, -0.3, 0.8, 0.1]))
    s.play(model.pass('vision encoder', [0.7, 0.2, -0.4, 0.5]), { duration: 1.6 })
    s.play(model.light('projector'), fadeIn(trains), { duration: 0.4 })
    s.play(model.pass('projector', [-0.2, 0.9, 0.3, -0.6]), { duration: 1.2 })
    s.wait(0.8)

    // A branch beside the frozen language model adds a small change to what the model writes.
    s.play(model.light(null), model.show('LoRA'), fadeIn(small), { duration: 1 })
    s.play(model.pass('LoRA', [0.1, 0.6, 0.7, -0.3], { aroundValues: [0, 0.7, 0.5, -0.2] }), { duration: 3 })
    s.play(model.pass('answer head', [0.9, -0.1, 0.2, 0.3]), { duration: 1.1 })
    s.wait(1)
})
