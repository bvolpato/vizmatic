// Keep the answer: a second bar, to the same scale, for the request that the cache serves.
import { assertEqual, commas, fadeIn, grow, type SceneClock, type Stage } from 'vizmatic/stage'
import { BAR, COLOR, N, SCALE, area, claimTag, heading, label, left, slowRequest, source, timeBar } from './kit'

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

    const fast = timeBar(N.cache.ms, BAR.fastY, COLOR.fast)
    const name = left('served from the cache', BAR.left, BAR.fastY - 80)
    const time = left(`${N.cache.ms} ms`, BAR.left + N.cache.ms * SCALE + 32, BAR.fastY, { size: 56, color: COLOR.fast })
    c.on('A cache keeps', () => s.play(fadeIn(name, { duration: 0.4 })), -0.1)
    c.on('five milliseconds', () => s.play(grow(fast, { from: [BAR.left, BAR.fastY], duration: 0.3 }), fadeIn(time, { duration: 0.4 })), -0.1)

    const result = label(`${commas(TIMES_FASTER)} times faster`, area.cx, 300, { size: 88, color: COLOR.fast })
    c.on('one hundred and sixty times', () => s.play(fadeIn(result, { duration: 0.4 })), -0.1, 1)
    // This is the last scene. Its picture stays while the sound fades, and the film takes it away at the end.
}
