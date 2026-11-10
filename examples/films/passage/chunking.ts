// Document chunking: compare fixed windows, overlap, and sentence boundaries on one runbook.
import { sceneKit, beside, decimal, fadeIn, fadeOut, film, passage, place, sceneArea, text } from 'vizmatic/stage'

const RUNBOOK = 'If the error rate stays above 2% after a deploy, roll back within 15 minutes. Then page the incident commander. Write the deploy ID in the incident channel.'

export default film({ title: 'Does the chunk keep the deadline intact?', fps: 30, font: 'text-serif' }, (s) => {
    s.add(sceneKit().heading('Does the chunk keep the deadline intact?'))
    const area = sceneArea()
    const [upper, lower] = area.rows([5, 4])
    // Each word and punctuation mark is a token in this example vocabulary.
    const tokens = (part: string) => part.match(/\w+|[^\w\s]/g)?.length ?? 0
    const page = place(passage(RUNBOOK, { tokens, width: 1500, size: 44, title: 'runbook.md' }), upper!, 'top')
    s.play(page.enter(), { duration: 1.2 })
    // The fact that a chunk must hold whole.
    s.play(page.mark('within 15 minutes', 'mark'), { duration: 0.6 })

    // One label names the method, at one place. Each cut is an operation on the same page.
    const methods = ['7 words per chunk', '7 words per chunk, 2 shared', '10 tokens per chunk, counting punctuation', '1 sentence per chunk'].map((words) => place(text(words, { size: 40, color: 'dim' }), lower!, 'top left'))
    // The windows cut the fact in two: "15" ends one chunk, and "minutes." starts the next.
    s.play(fadeIn(methods[0]!), page.cut({ size: 7 }), { duration: 1.4 })
    s.wait(1.2)
    // With an overlap, one chunk holds the fact whole, and the words that two chunks share show both.
    s.play(fadeOut(methods[0]!), { duration: 0.3 })
    s.play(fadeIn(methods[1]!), page.cut({ size: 7, overlap: 2 }), { duration: 1.4 })
    s.wait(1.6)
    s.play(fadeOut(methods[1]!), { duration: 0.3 })
    s.play(fadeIn(methods[2]!), page.cut({ tokens: 10 }), { duration: 1.2 })
    s.wait(1.6)
    s.play(fadeOut(methods[2]!), { duration: 0.3 })
    s.play(fadeIn(methods[3]!), page.cut({ by: 'sentence' }), { duration: 1.4 })
    s.wait(0.8)

    // The first chunk is selected, a count follows the selection, and the chunk lifts out as a passage of its own.
    const words = page.counter('words')
    const count = beside(decimal(() => words.value, { digits: 0, size: 40, suffix: ' words' }), methods[3]!, 'under')
    s.play(fadeIn(count), page.select({ chunk: 0 }), { duration: 0.8 })
    const chunk = place(page.slip({ chunk: 0 }, { title: `chunk 1 of ${page.chunks.length}`, width: 820 }), lower!, 'bottom right')
    s.play(page.lift(chunk), { duration: 1.4 })
    s.wait(3.6)
})
