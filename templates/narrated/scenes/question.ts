// The slow page: one bar whose length is the time to build the page, and the question that the film answers.
import { assertEqual, delay, fadeIn, grow, type SceneClock, type Stage } from 'vizmatic/stage'
import { BAR, N, area, chip, claimTag, heading, label, slowRequest, source } from './kit'

// The number that the voice says.
assertEqual(N.database.ms, 800, 'the time to build the page')

export function question(s: Stage, c: SceneClock) {
    // The first picture of the scene. The film calls this function at the moment that the picture opens, and
    // it fades in what the scene adds here. So the voice never plays over an empty frame.
    const slow = slowRequest()
    s.add(heading('The slow page'), source('Numbers: data/numbers.json'), slow.name)
    // The kind of the claim that is on the screen. The tag is at the right end of the source line.
    claimTag(c, { word: 'ILLUSTRATION', note: 'invented numbers' })

    // The bar grows from the start line while the voice says its length. A cue is in the words that the voice
    // says: the pronounce map of script.json turns "800" into "eight hundred".
    c.on('eight hundred milliseconds', () => s.play(grow(slow.bar, { from: [BAR.left, BAR.slowY], duration: 1.2 }), fadeIn(slow.time, { duration: 0.4 })), -0.2)

    // Five requests for one page. The voice asks its question when the last one arrives.
    const requests = Array.from({ length: 5 }, (_, i) => chip('GET /home', { font: 'mono' }).at(BAR.left + i * 260, BAR.fastY))
    const why = label('Why build it again?', area.cx, 300, { size: 72 })
    c.on('Most requests', () => s.play(...requests.map((request, i) => delay(fadeIn(request, { duration: 0.3 }), i * 0.25))), 0, 1)
    c.on('why build it again', () => s.play(fadeIn(why, { duration: 0.4 })), -0.1, 1)

    // At the end of the scene, the film fades out all that the scene put on the stage. The next scene shows
    // the same bar at the same place, so the scene keeps the bar: it stays, with no fade between the scenes.
    c.keep(slow.all)
}
