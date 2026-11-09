// What the scenes of this film share: its labels, its colors, its numbers, and the picture that both scenes show.
import { sceneKit, rect, type Node } from 'vizmatic/stage'
import numbers from '../data/numbers.json'

/** The frame and the labels of the film, in one font. A phone shows this film too, so the size is large: the heading, the source line and the chips follow it. */
export const { area, heading, source, label, left, chip, claimTag } = sceneKit({ size: 44 })

/** One color has one job through the film. */
export const COLOR = { slow: 'red', fast: 'green', note: 'dim' } as const

/** Every number on screen. A scene asserts each number that the voice says before it draws. */
export const N = numbers

/** Pixels for one millisecond. Both bars use it, so their lengths compare. */
export const SCALE = 1.5
export const BAR = { left: -700, height: 64, slowY: -150, fastY: 90 } as const

/** A bar whose length is a time, with its left end on the common start line. */
export function timeBar(ms: number, y: number, color: string): Node {
    const length = ms * SCALE
    return rect(length, BAR.height, { radius: Math.min(8, length / 2), fill: color, stroke: null }).at(BAR.left + length / 2, y)
}

/** The slow request, as both scenes show it: the bar, its name, and its time. Each scene builds its own copy. */
export function slowRequest(): { bar: Node; name: Node; time: Node; all: Node[] } {
    const bar = timeBar(N.database.ms, BAR.slowY, COLOR.slow)
    const name = left('built from the database', BAR.left, BAR.slowY - 80)
    const time = left(`${N.database.ms} ms`, BAR.left + N.database.ms * SCALE + 32, BAR.slowY, { size: 56, color: COLOR.slow })
    return { bar, name, time, all: [bar, name, time] }
}
