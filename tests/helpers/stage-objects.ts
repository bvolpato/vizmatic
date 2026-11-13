import { expect } from "vitest"
import { compileFilm, film, frameToSvg, type CompiledFilm, type FilmDefinition, type PathOp, type Stage } from "../../src/stage/index"
import { clock } from "../../src/stage/track"

export async function compile(build: (s: Stage) => void | Promise<void>, options: Parameters<typeof film>[0] extends never ? never : Record<string, unknown> = {}): Promise<CompiledFilm> {
    return compileFilm(film(options as never, build) as FilmDefinition)
}

export const paths = (f: CompiledFilm, t: number) => f.frame(t).ops.filter((op): op is PathOp => op.kind === "path")
export const svgAt = (f: CompiledFilm, t: number) => frameToSvg(f.frame(t))

/** Run code that reads node state as of a time. */
export function at<T>(time: number, read: () => T): T {
    const saved = clock.now
    clock.now = time
    try {
        return read()
    } finally {
        clock.now = saved
    }
}

export function expectPure(f: CompiledFilm, times: readonly number[]): void {
    const forward = times.map((t) => svgAt(f, t))
    const backward = [...times].reverse().map((t) => svgAt(f, t)).reverse()
    expect(backward).toEqual(forward)
    expect(times.map((t) => svgAt(f, t))).toEqual(forward)
}
