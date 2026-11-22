import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { FILM_TEMPLATES } from '../src/stage/templates'

const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'vizmatic-cli-film-check-'))
    tempDirs.push(directory)
    return directory
}

const BUILT_CLI = resolve('dist/cli.js')
const USE_BUILT_CLI = process.env['VIZMATIC_TEST_USE_EXISTING_BUILD'] === '1' && existsSync(BUILT_CLI)

function cli(args: string[], cwd = process.cwd()) {
    const env: NodeJS.ProcessEnv = { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' }
    delete env.NODE_OPTIONS
    for (const key of Object.keys(env)) {
        if (key.startsWith('TSX_') || key.startsWith('VITEST')) delete env[key]
    }
    const cliArgs = USE_BUILT_CLI
        ? [BUILT_CLI, ...args]
        : ['--import', `file://${resolve('node_modules/tsx/dist/loader.mjs')}`, resolve('src/cli.ts'), ...args]
    return spawnSync(process.execPath, cliArgs, {
        cwd, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024,
    })
}

describe('vizmatic new, looks, and objects', () => {
    it('scaffolds every template into a film that passes its own check', async () => {
        const directory = await tempDirectory()
        // A template that is a folder has its own tests, in narrated-cli.test.ts.
        for (const template of FILM_TEMPLATES.filter((entry) => entry.source !== undefined)) {
            const created = cli(['new', template.name, '--template', template.name], directory)
            expect(created.status, created.stderr).toBe(0)
            const check = cli(['check', `${template.name}.ts`, '--json'], directory)
            expect(check.status, `${template.name}: ${check.stdout}${check.stderr}`).toBe(0)
            const report = JSON.parse(check.stdout)
            expect(report.files[0].film.title).toBeTruthy()
            expect(report.files[0].diagnostics, template.name).toEqual([])
        }
        const again = cli(['new', 'deck', '--template', 'deck'], directory)
        expect(again.status).not.toBe(0)
        expect(again.stderr).toContain('already exists')
    }, 180_000)

    it('lists looks and objects for agents as JSON', () => {
        const looks = JSON.parse(cli(['looks', '--json']).stdout).looks
        expect(looks.map((look: { name: string }) => look.name)).toContain('midnight')
        const catalog = JSON.parse(cli(['objects', '--json']).stdout)
        expect(catalog.objects.map((entry: { name: string }) => entry.name)).toEqual(expect.arrayContaining(['text', 'tex', 'axes', 'write', 'morph']))
        expect(catalog.objects.every((entry: { usage: string }) => entry.usage.length > 0)).toBe(true)
    }, 60_000)
})

describe('vizmatic check for films', () => {
    it('reports off-canvas text and overlapping text with times and boxes', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'bad.ts'), `import { film, line, text } from 'vizmatic/stage'
export default film({ title: 'Bad' }, (s) => {
    s.add(text('Falls off the edge of the frame', { size: 60 }).at(880, 0))
    s.add(text('Stacked', { size: 60 }).at(0, -200))
    s.add(text('Stacked', { size: 60 }).at(8, -198))
    s.add(text('Crossed', { size: 60 }).at(0, 200))
    s.add(line([-300, 200], [300, 200], { stroke: 'ink', width: 3 }))
    s.wait(1)
})
`)
        const result = cli(['check', 'bad.ts', '--json'], directory)
        expect(result.status).toBe(1)
        const report = JSON.parse(result.stdout)
        expect(report.ok).toBe(false)
        const codes = report.files[0].diagnostics.map((entry: { code: string }) => entry.code)
        expect(codes).toEqual(expect.arrayContaining(['film.off_canvas', 'film.text_overlap', 'film.text_crossed']))
        const overlap = report.files[0].diagnostics.find((entry: { code: string }) => entry.code === 'film.text_overlap')
        expect(overlap).toMatchObject({ severity: 'error', text: 'Stacked', other: 'Stacked' })
        expect(overlap.box.width).toBeGreaterThan(0)
        expect(overlap.time).toBeGreaterThanOrEqual(0)
        expect(overlap.stage.y).toBeLessThan(0)
    }, 60_000)

    it('finds a collision in motion only when --motion is set', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'crossfade.ts'), `import { fadeIn, fadeOut, film, text } from 'vizmatic/stage'
export default film({ title: 'Crossfade', fps: 30 }, (s) => {
    const before = s.add(text('Old sentence here', { size: 80 }))
    s.wait(1)
    s.play(fadeOut(before), fadeIn(text('New sentence here', { size: 80 })), { duration: 1 })
    s.wait(1)
})
`)
        const atRest = JSON.parse(cli(['check', 'crossfade.ts', '--json'], directory).stdout)
        expect(atRest.files[0].diagnostics).toEqual([])
        const result = cli(['check', 'crossfade.ts', '--motion', '--json'], directory)
        expect(result.status).toBe(0)
        const file = JSON.parse(result.stdout).files[0]
        expect(file.film.frames).toBe(90)
        expect(file.diagnostics).toHaveLength(1)
        expect(file.diagnostics[0]).toMatchObject({ code: 'film.text_overlap', severity: 'warning', motion: { spans: 1 } })
    }, 60_000)

    it('reports text with no room beside a mark only when --text-gap is set', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'tight.ts'), `import { film, rect, text } from 'vizmatic/stage'
export default film({ title: 'Tight' }, (s) => {
    s.add(rect(300, 60, { fill: 'blue', stroke: null }))
    s.add(text('caption', { size: 40 }).alignTo([0, 33], 'top'))
    s.wait(1)
})
`)
        const plain = cli(['check', 'tight.ts', '--json'], directory)
        expect(JSON.parse(plain.stdout).files[0].diagnostics).toEqual([])
        const result = cli(['check', 'tight.ts', '--text-gap', '0.3', '--json'], directory)
        expect(result.status).toBe(0)
        expect(JSON.parse(result.stdout).files[0].diagnostics).toMatchObject([
            { code: 'film.text_crowded', severity: 'warning', text: 'caption', message: 'Text "caption" is 3 px from a filled shape above it. Leave 12 px or more.' },
        ])
        // The value is the part of the font size. 0.05 of 40 is 2 px, which the caption has.
        expect(JSON.parse(cli(['check', 'tight.ts', '--text-gap', '0.05', '--json'], directory).stdout).files[0].diagnostics).toEqual([])
        const bad = cli(['check', 'tight.ts', '--text-gap', 'near'], directory)
        expect(bad.status).not.toBe(0)
        expect(bad.stderr + bad.stdout).toContain('--text-gap needs a part of the font size')
    }, 60_000)

    it('reports small text only with --text-size, and empty space only with --empty-space', async () => {
        const directory = await tempDirectory()
        // A small caption at the top left of the frame, for 6 seconds.
        await writeFile(join(directory, 'corner.ts'), `import { film, text } from 'vizmatic/stage'
export default film({ title: 'Corner' }, (s) => {
    s.add(text('caption', { size: 20 }).at(-700, -420))
    s.wait(6)
})
`)
        const codes = (...options: string[]) => (JSON.parse(cli(['check', 'corner.ts', ...options, '--json'], directory).stdout).files[0].diagnostics as { code: string; message: string }[]).map((entry) => `${entry.code}: ${entry.message}`)
        expect(codes()).toEqual([])
        expect(codes('--text-size', '26')).toEqual(['film.text_small: Text "caption" is 20 px on the screen, and the least size is 26 px. Give it a larger size.'])
        expect(codes('--text-size', '20')).toEqual([])
        expect(codes('--empty-space', '0.5')).toEqual(['film.empty_space: For 5 s, 81% of the frame stays empty in one piece: the right 81% of the width. The limit is 50%. Make the picture larger, or use that part for what the picture explains.'])
        expect(codes('--empty-space', '0.9')).toEqual([])
        expect(codes('--text-size', '26', '--empty-space', '0.5').map((line) => line.split(':')[0])).toEqual(['film.text_small', 'film.empty_space'])
        // The two findings are warnings: the check passes, and the report in words names each one.
        const words = cli(['check', 'corner.ts', '--text-size', '26', '--empty-space', '0.5'], directory)
        expect(words.status).toBe(0)
        expect(words.stdout + words.stderr).toContain('film.text_small')
        expect(words.stdout + words.stderr).toContain('film.empty_space')
        for (const [option, value, message] of [
            ['--text-size', 'big', '--text-size needs the least size of text in pixels of a frame that is 1080 high, such as 26'],
            ['--text-size', '-3', '--text-size needs the least size of text in pixels'],
            ['--empty-space', '50', '--empty-space needs the largest part of the frame that may stay empty in one piece, from 0 to 1, such as 0.5'],
            ['--empty-space', 'half', '--empty-space needs the largest part of the frame'],
        ] as const) {
            const bad = cli(['check', 'corner.ts', option, value], directory)
            expect(bad.status, option).not.toBe(0)
            expect(bad.stderr + bad.stdout).toContain(message)
        }
    }, 120_000)

    it('keeps the four-second default and accepts a shorter empty-space window', async () => {
        const directory = await tempDirectory()
        await writeFile(join(directory, 'short-corner.ts'), `import { film, rect, tex, group } from 'vizmatic/stage'
export default film((s) => {
    s.add(rect(1920, 1080, { fill: 'red', stroke: null }))
    s.add(group(tex('x_1^2', { size: 40 })).scale(0.5).at(-700, -400))
    s.wait(3.4)
})
`)
        const findings = (...args: string[]) => {
            const result = cli(['check', 'short-corner.ts', ...args, '--json'], directory)
            expect(result.status, result.stderr).toBe(0)
            return JSON.parse(result.stdout).files[0].diagnostics
        }
        expect(findings('--empty-space', '0.5')).toEqual([])
        expect(findings('--empty-seconds', '2')).toEqual([])
        expect(findings('--empty-space', '0.5', '--empty-seconds', '2')).toMatchObject([{ code: 'film.empty_space', time: 0.5, until: 2.9 }])
        expect(findings('--text-size', '26')).toMatchObject([{ code: 'film.text_small', text: 'x_1^2', message: expect.stringContaining('20 px') }])
        for (const value of ['0', '-1', 'NaN', 'Infinity', 'short']) {
            const result = cli(['check', 'short-corner.ts', '--empty-seconds', value], directory)
            expect(result.status).not.toBe(0)
            expect(result.stderr + result.stdout).toContain('--empty-seconds needs a positive number of seconds')
        }
        const missing = cli(['check', 'short-corner.ts', '--empty-seconds'], directory)
        expect(missing.status).not.toBe(0)
        expect(missing.stderr + missing.stdout).toContain('--empty-seconds needs a positive number of seconds')
    }, 120_000)
})
