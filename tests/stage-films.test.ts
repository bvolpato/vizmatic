import { readdirSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compileFilm, isFilm } from 'vizmatic/stage'

interface Entry { id: string; title: string; summary: string; topic: string; duration: number; posterTime: number; featured: boolean; look: 'midnight' | 'paper' }

const catalog = JSON.parse(readFileSync('examples/films/catalog.json', 'utf8')) as Entry[]

async function load(id: string) {
    const module = await import(`../examples/films/${id}.ts`) as { default: unknown }
    if (!isFilm(module.default)) throw new Error(`${id} has no film as its default export`)
    return module.default
}

it('lists every film in the folder exactly once', () => {
    const files = readdirSync('examples/films').filter((name) => name.endsWith('.ts')).map((name) => name.replace(/\.ts$/, '')).sort()
    expect(catalog.map((entry) => entry.id).sort()).toEqual(files)
})

it.each(catalog.map((entry) => [entry.id, entry] as const))('%s compiles and matches its catalog entry', async (_id, entry) => {
    const film = await compileFilm(await load(entry.id), { look: entry.look })
    expect(Math.abs(film.duration - entry.duration)).toBeLessThan(0.1)
    expect(entry.posterTime).toBeLessThanOrEqual(film.duration)
    expect(film.width).toBe(1920)
    expect(film.height).toBe(1080)
    expect(film.fps).toBe(60)
    if (entry.id !== 'vizmatic-title') expect(film.chapters.length).toBeGreaterThanOrEqual(3)
    expect(film.frame(entry.posterTime).ops.length).toBeGreaterThan(0)
}, 60_000)

it('moves the Fourier camera smoothly while it follows the chain', async () => {
    const film = await compileFilm(await load('fourier-epicycles'))
    const camera = film.stage.camera
    const steps: number[] = []
    let last: [number, number] | null = null
    // The close-up, where the camera is zoomed in 9 times and any jump shows as shaking.
    for (let frame = 0; frame < 120; frame++) {
        film.frame(34 + frame / 60)
        const here: [number, number] = [camera.get('x') as number, camera.get('y') as number]
        if (last) steps.push(Math.hypot(here[0] - last[0], here[1] - last[1]) * (camera.get('sx') as number))
        last = here
    }
    expect(Math.max(...steps)).toBeGreaterThan(0)
    let largestChange = 0
    for (let i = 1; i < steps.length; i++) largestChange = Math.max(largestChange, Math.abs(steps[i]! - steps[i - 1]!))
    expect(largestChange).toBeLessThan(4)
}, 60_000)

it('closes the title loop: its last moment matches its first', async () => {
    const film = await compileFilm(await load('vizmatic-title'))
    const numbers = (svg: string) => (svg.match(/-?\d+\.?\d*/g) ?? []).map(Number)
    const first = numbers(film.svg(0)), last = numbers(film.svg(film.duration))
    expect(last.length).toBe(first.length)
    let largest = 0
    for (let i = 0; i < first.length; i++) largest = Math.max(largest, Math.abs(first[i]! - last[i]!))
    expect(largest).toBeLessThan(0.05)
}, 60_000)
