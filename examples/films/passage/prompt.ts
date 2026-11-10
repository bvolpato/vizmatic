// Prompt engineering: change the deadline in the prompt and trace it to the JSON field.
import { sceneKit, codeBlock, column, fadeIn, film, fitted, morphCode, passage, place, sceneArea } from 'vizmatic/stage'

const SYSTEM = 'You are the incident assistant. Reply in JSON. Deadline: in minutes.'
const SYSTEM_NEXT = 'You are the incident assistant. Reply in JSON. Deadline: 15 minutes, by runbook IR-7.'
const USER = 'The error rate is 4% after deploy D-42. What do we do?'
const reply = (minutes: number) => `{\n  "action": "roll back",\n  "deadline_minutes": ${minutes},\n  "deploy": "D-42"\n}`

export default film({ title: 'How does the deadline reach the JSON reply?', fps: 30, font: 'text-serif' }, (s) => {
    s.add(sceneKit().heading('How does the deadline reach the JSON reply?'))
    const [left, right] = sceneArea().columns([5, 4], 'loose')
    // One passage for each section of the prompt, with its role as the title.
    const system = fitted(left!, (width) => passage(SYSTEM, { width, lines: 4, size: 42, title: 'system', color: 'purple' }))
    const user = fitted(left!, (width) => passage(USER, { width, size: 42, title: 'user', color: 'teal' }))
    place(column([system, user], { gap: 'wide' }), left!)
    s.play(system.enter(), user.enter(), { duration: 1.2 })
    const first = place(codeBlock(reply(90), { language: 'json', size: 34 }), right!, 'right'), second = place(codeBlock(reply(15), { language: 'json', size: 34 }), right!, 'right')
    s.play(fadeIn(first), { duration: 0.6 })

    // Each phrase of the prompt is tied to the field of the reply that follows from it.
    s.play(system.mark('Deadline: in minutes.', 'mark'), user.mark('deploy D-42', 'claim'), { duration: 0.6 })
    // The next version of the reply arrives later, over what is on the stage. The two lines stay over it.
    const deadline = system.link('Deadline: in minutes.', first.line(2), { color: 'blue', shift: -24 }).zIndex(1)
    const deploy = user.link('deploy D-42', first.line(3), { color: 'purple', shift: 24 }).zIndex(1)
    s.play(deadline.enter(), deploy.enter(), { duration: 0.9 })
    s.wait(1.6)

    // One phrase changes to an exact reference. The span keeps its words, and the field of the reply follows.
    s.play(system.diff(SYSTEM_NEXT), { duration: 1.6 })
    s.play(morphCode(first, second), { duration: 1 })
    s.wait(1.4)
    s.play(system.accept(), { duration: 1 })
    s.wait(3)
})
