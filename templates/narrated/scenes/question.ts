// The slow page: one bar whose length is the time to build the page, and the question that the film answers.
import { assertEqual, boxOf, grow, place, row, type SceneClock, type Stage } from 'vizmatic/stage'
import { N, SIZE, chip, claimTag, display, heading, lower, middle, slowRequest, source } from './kit'

// The number that the voice says.
assertEqual(N.database.ms, 800, 'the time to build the page')

export function question(s: Stage, c: SceneClock) {
    // The first picture of the scene. The film calls this function at the moment that the picture opens, and
    // it fades in what the scene adds here. So the voice never plays over an empty frame.
    const slow = slowRequest()
    s.add(heading('The slow page'), source('Numbers: data/numbers.json'), slow.name)
    // The kind of the claim that is on the screen. The tag is at the right end of the source line.
    claimTag(c, { word: 'ILLUSTRATION', note: 'invented numbers' })

    // The bar grows from its left end while the voice says its length, and its time fades in. A cue is in the
    // words that the voice says: the pronounce map of script.json turns "800" into "eight hundred".
    c.show('eight hundred milliseconds', [grow(slow.bar, { from: boxOf(slow.bar).point('left') }), slow.time])

    // Five requests for one page, in a row that measures them. The row starts where the bar starts. The voice asks
    // its question when the last one arrives, and the question has its middle on the middle of the picture.
    const requests = Array.from({ length: 5 }, () => chip('GET /home', { font: 'mono' }))
    place(row(requests), middle, 'left')
    const why = place(display('Why build it again?', { size: SIZE.question }), lower)
    c.show('Most requests', requests, { stagger: true })
    c.show('why build it again', why)

    // At the end of the scene, the film fades out all that the scene put on the stage. The next scene shows
    // the same bar at the same place, so the scene keeps the bar: it stays, with no fade between the scenes.
    c.keep(slow.all)
}
