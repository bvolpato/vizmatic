// Keep the answer: a second bar, to the same scale, for the request that the cache serves.
import { assertEqual, boxOf, commas, grow, place, type SceneClock, type Stage } from 'vizmatic/stage'
import { COLOR, N, SIZE, claimTag, display, heading, lower, middle, request, slowRequest, source } from './kit'

// The numbers that the voice says.
assertEqual(N.cache.ms, 5, 'the time from the cache')
const TIMES_FASTER = N.database.ms / N.cache.ms
assertEqual(TIMES_FASTER, 160, 'how many times faster the cache is')

export function answer(s: Stage, c: SceneClock) {
    s.add(heading('Keep the answer'), source('Numbers: data/numbers.json'))
    claimTag(c, { word: 'ILLUSTRATION', note: 'invented numbers' })
    // This scene takes the slow request from the scene before it.
    const slow = slowRequest()
    c.take(slow.all)

    // The fast request has the place of the five requests of the scene before: the band under the slow one.
    const fast = request('served from the cache', N.cache.ms, COLOR.fast, middle)
    c.show('A cache keeps', fast.name)
    c.show('five milliseconds', [grow(fast.bar, { from: boxOf(fast.bar).point('left') }), fast.time])

    const result = place(display(`${commas(TIMES_FASTER)} times faster`, { size: SIZE.result, color: COLOR.fast }), lower)
    c.show('one hundred and sixty times', result)
    // This is the last scene. Its picture stays while the sound fades, and the film takes it away at the end.
}
