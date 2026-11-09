// What the scenes of this film share: its labels, its colors, its numbers, its regions, and the picture that both scenes show.
import { column, place, rect, row, sceneKit, type Box, type Node } from 'vizmatic/stage'
import numbers from '../data/numbers.json'

/** The frame and the labels of the film, in one font. A phone shows this film too, so the size is large: the heading, the source line and the chips follow it. */
export const { area, heading, source, label, display, chip, claimTag } = sceneKit({ size: 44 })

/** One color has one job through the film. */
export const COLOR = { slow: 'red', fast: 'green', note: 'dim' } as const

/** Every number on screen. A scene asserts each number that the voice says before it draws. */
export const N = numbers

/** The sizes of the three texts that are larger than a label: the time of a request, the question, and the result. */
export const SIZE = { time: 56, question: 72, result: 88 } as const

/**
 * The plot: the middle seven ninths of the area. Every bar starts at its left edge, and the line that a scene
 * ends on has its middle on the middle of the plot. So the picture has one axis, the middle of the frame.
 */
const plot = area.columns([1, 7, 1], 'none')[1]!

/** The three bands of the plot, from top to bottom: the slow request, what the scene sets under it, and the line that the scene ends on. */
export const [upper, middle, lower] = plot.rows(3) as [Box, Box, Box]

/** Pixels for one millisecond. Both bars use it, so their lengths compare. The slowest bar is six sevenths of the plot, and its time has the rest. */
const SCALE = plot.columns([6, 1], 'none')[0]!.width / N.database.ms

/** One request: its name over a bar whose length is its time, and the time right of the bar. The layout places the three in a band. */
export function request(name: string, ms: number, color: string, band: Box): { bar: Node; name: Node; time: Node; all: Node[] } {
    const length = ms * SCALE
    const bar = rect(length, 64, { radius: Math.min(8, length / 2), fill: color, stroke: null })
    const title = label(name), time = label(`${ms} ms`, { size: SIZE.time, color })
    place(column([title, row([bar, time])]), band, 'left')
    return { bar, name: title, time, all: [bar, title, time] }
}

/** The slow request, as both scenes show it. Each scene builds its own copy. */
export const slowRequest = () => request('built from the database', N.database.ms, COLOR.slow, upper)
