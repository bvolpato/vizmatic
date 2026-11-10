// Retrieval evaluation: follow each claim back to the policy that supports or contradicts it.
import { sceneKit, beside, column, decimal, fitted, film, passage, place, sceneArea, Value } from 'vizmatic/stage'

const ANSWER = 'Returns with a receipt are free for 30 days.\nThe shop is closed on Sunday.\nRefunds arrive immediately.\nStaff answer within one hour.'
const SOURCE_A = 'Returns: free within 30 days of delivery, with the receipt.'
const SOURCE_B = 'Opening hours: Monday to Saturday, 9 to 18. Closed on Sunday.\nA refund is paid on the next business day.'

export default film({ title: 'Which claims does the policy support?', fps: 30, font: 'text-serif' }, (s) => {
    s.add(sceneKit().heading('Which claims does the policy support?'))
    const [left, right] = sceneArea().columns([4, 5], 'loose')
    // Each passage is as wide as its column: the layout gives the width.
    const answer = place(fitted(left!, (width) => passage(ANSWER, { width, size: 36, title: 'answer' })), left!, 'top')
    const a = fitted(right!, (width) => passage(SOURCE_A, { width, size: 36, title: 'source A' }))
    const b = fitted(right!, (width) => passage(SOURCE_B, { width, size: 36, title: 'source B' }))
    place(column([a, b], { gap: 'wide' }), right!, 'top')
    s.play(answer.enter(), a.enter(), b.enter(), { duration: 1.2 })

    // The count of the claims that a source supports. It reads the state of the answer after each change.
    const supported = new Value(0)
    const faithful = beside(decimal(() => supported.value, { digits: 0, size: 36, suffix: ' of 4 claims supported' }), answer, 'under', 'wide', 'left')
    s.add(faithful)
    const claims = ANSWER.split('\n')
    s.play(...claims.map((claim) => answer.mark(claim, 'claim')), { duration: 0.8 })

    // Each claim that holds: the span of its source, a line to it, and the kind of the claim.
    s.play(a.mark('free within 30 days'))
    const first = answer.link(claims[0]!, a.span('free within 30 days'), { color: 'green', shift: 20 })
    s.play(first.enter(), answer.mark(claims[0]!, 'supported'), { duration: 0.8 })
    s.play(supported.to(answer.count('supported')), { duration: 0.3 })
    s.play(b.mark('Closed on Sunday.'))
    const second = answer.link(claims[1]!, b.span('Closed on Sunday.'), { color: 'green' })
    s.play(second.enter(), answer.mark(claims[1]!, 'supported'), { duration: 0.8 })
    s.play(supported.to(answer.count('supported')), { duration: 0.3 })

    // The third claim has a source that says another thing: the line breaks, and the count does not move.
    s.play(b.mark('on the next business day'))
    const third = answer.link(claims[2]!, b.span('on the next business day'), { shift: -20 })
    s.play(third.enter(), { duration: 0.8 })
    s.wait(0.5)
    s.play(third.break(), answer.mark(claims[2]!, 'contradicted'), b.mark('on the next business day', 'contradicted'), { duration: 0.7 })
    // No source says the fourth claim.
    s.play(answer.mark(claims[3]!, 'unsupported'), { duration: 0.6 })
    s.wait(3)
})
