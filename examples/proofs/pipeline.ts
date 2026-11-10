/**
 * Two calls ask the host to hold a book. Only the call with a text ID can reach execution.
 */
import { film, pipeline, place, sceneKit } from 'vizmatic/stage'

export default film({ title: 'The host checks each call', fps: 30, font: 'text-serif' }, (s) => {
    const { area, heading, note } = sceneKit()
    s.add(heading('The host checks each call'))
    const flow = place(pipeline(['complete', 'schema', 'authorization', 'execute'], {
        width: area.width, size: 34, gates: true, lanes: 2, tray: 'refused',
        counts: (count) => `${count} ${count === 1 ? 'call' : 'calls'}`,
    }), area)
    s.add(place(note('To hold a book, the caller needs a string ID and permission to place the hold.'), area, 'bottom'))
    s.play(flow.enter(), flow.put([{ id: 'call 17' }, { id: 'call 18', color: 'orange' }]), { duration: 1 })
    s.wait(1)
    s.play(flow.move(() => true), { duration: 1 })
    s.play(flow.pass('call 17', 'text id'), flow.stop('call 18', 'numeric id'), { duration: 0.8 })
    s.wait(1.5)
    s.play(flow.eject('call 18'), { duration: 1.2 })
    s.wait(0.6)
    s.play(flow.move('call 17'), { duration: 1 })
    s.play(flow.pass('call 17', 'grant ok'), { duration: 0.8 })
    s.wait(1)
    s.play(flow.move('call 17'), { duration: 1 })
    s.play(flow.pass('call 17', 'held B7'), { duration: 0.8 })
    s.wait(2)
})
