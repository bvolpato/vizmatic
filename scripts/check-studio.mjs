#!/usr/bin/env node
/**
 * Uses the Studio the way a person does: builds a film by dragging, edits the
 * timeline, reloads, follows a shared link, exports real files, and tries to
 * escape the code sandbox. Screenshots land in STUDIO_SHOTS when it is set.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const shots = process.env.STUDIO_SHOTS
if (shots) mkdirSync(shots, { recursive: true })
const downloads = mkdtempSync(join(tmpdir(), 'viz-studio-check-'))
const port = 4900 + Math.floor(Math.random() * 90)
const server = spawn(process.execPath, ['scripts/serve-docs.mjs', 'docs', String(port)], { cwd: resolve('.'), stdio: 'ignore' })
const base = process.env.VIZMATIC_STUDIO_URL ?? `http://127.0.0.1:${port}/studio.html`

async function serverReady() {
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            const response = await fetch(base)
            if (response.ok) return
        } catch {
            // The server is still starting.
        }
        await delay(100)
    }
    throw new Error('The docs server did not start.')
}

const failures = []
let passed = 0
async function step(name, run) {
    try {
        await run()
        passed += 1
        console.log(`ok    ${name}`)
    } catch (error) {
        failures.push(name)
        console.log(`FAIL  ${name}\n      ${String(error?.message ?? error).split('\n').slice(0, 6).join('\n      ')}`)
    }
}

const browser = await chromium.launch({ headless: true })
try {
    await serverReady()
    const context = await browser.newContext({ viewport: { width: 1600, height: 960 }, deviceScaleFactor: 1, colorScheme: 'dark', acceptDownloads: true })
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(String(error)))
    page.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(message.text())
    })

    const q = (test) => `[data-test="${test}"]`
    const shot = async (name) => {
        if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
    }
    /** Wait until the film on screen reflects the latest edit. */
    const settled = async () => {
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))))
        await page.waitForFunction(() => !window.vizmaticStudio.transport.playing, null, { timeout: 30000 })
    }
    const project = () => page.evaluate(() => JSON.parse(JSON.stringify(window.vizmaticStudio.store.project)))
    const box = async (selector) => {
        const rect = await page.locator(selector).first().boundingBox()
        assert.ok(rect, `No box for ${selector}`)
        return rect
    }
    /** Screen position of a stage point. */
    const screenOf = async (x, y) => {
        const sheet = await box('.stage-sheet')
        const size = await page.evaluate(() => window.vizmaticStudio.stageSize())
        return [sheet.x + (x + size.width / 2) * sheet.width / size.width, sheet.y + (y + size.height / 2) * sheet.height / size.height]
    }
    const drag = async (x0, y0, x1, y1, steps = 8) => {
        await page.mouse.move(x0, y0)
        await page.mouse.down()
        await page.mouse.move(x1, y1, { steps })
        await page.mouse.up()
    }
    const frameHash = () => page.evaluate(() => {
        const canvas = document.querySelector('[data-test="canvas"]')
        const small = document.createElement('canvas')
        small.width = 96
        small.height = 54
        const ctx = small.getContext('2d')
        ctx.drawImage(canvas, 0, 0, 96, 54)
        const data = ctx.getImageData(0, 0, 96, 54).data
        let hash = 2166136261
        for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 16777619)
        return hash >>> 0
    })

    await step('opens on the welcome screen with live template previews', async () => {
        await page.goto(base)
        await page.waitForSelector(q('welcome'))
        await page.waitForFunction(() => {
            const thumbs = [...document.querySelectorAll('.template-thumb')]
            return thumbs.length >= 6 && thumbs.every((thumb) => thumb.width > 300)
        }, null, { timeout: 30000 })
        await shot('01-welcome')
    })

    await step('starts a blank film', async () => {
        await page.click(q('blank'))
        await page.waitForSelector(q('welcome'), { state: 'detached' })
        assert.equal((await project()).objects.length, 0)
    })

    await step('adds an object by clicking the palette', async () => {
        await page.click('[data-palette="title"]')
        await settled()
        const { objects } = await project()
        assert.equal(objects.length, 1)
        assert.equal(objects[0].kind, 'text')
    })

    await step('adds an object by dragging from the palette to the canvas', async () => {
        const from = await box('[data-palette="circle"]')
        const [x, y] = await screenOf(-500, 200)
        await drag(from.x + from.width / 2, from.y + from.height / 2, x, y, 12)
        await settled()
        const circle = (await project()).objects.find((object) => object.kind === 'ellipse')
        assert.ok(circle, 'The drop should add a circle')
        assert.ok(Math.abs(circle.x + 500) < 3 && Math.abs(circle.y - 200) < 3, `Dropped at ${circle.x}, ${circle.y}`)
    })

    await step('adds an equation and edits it with live validation', async () => {
        await page.click('[data-palette="tex"]')
        await settled()
        const field = page.locator('[data-field="source"]')
        await field.fill('\\frac{')
        await page.waitForSelector('.tex-field .field-error:not([hidden])')
        assert.match(await page.textContent('.tex-field .field-error'), /TeX|Missing|close/i)
        await field.fill('a^2 + b^2 = c^2')
        await page.waitForFunction(() => document.querySelector('.tex-field .field-error').hidden)
        await settled()
        await shot('02-objects')
    })

    await step('moves an object by dragging it on the canvas', async () => {
        const circle = (await project()).objects.find((object) => object.kind === 'ellipse')
        await page.click(`[data-layer="${circle.id}"]`)
        // Grab the stroke away from the eight handles.
        const [x0, y0] = await screenOf(circle.x + 130 * Math.SQRT1_2, circle.y + 130 * Math.SQRT1_2)
        const [x1, y1] = await screenOf(circle.x + 130 * Math.SQRT1_2 + 300, circle.y + 130 * Math.SQRT1_2 - 120)
        await page.click(q('snap'))
        await drag(x0, y0, x1, y1)
        await page.click(q('snap'))
        await settled()
        const moved = (await project()).objects.find((object) => object.id === circle.id)
        assert.ok(Math.abs(moved.x - (circle.x + 300)) < 8, `x went to ${moved.x}`)
        assert.ok(Math.abs(moved.y - (circle.y - 120)) < 8, `y went to ${moved.y}`)
    })

    await step('resizes with a handle and rotates with the rotate handle', async () => {
        const before = (await project()).objects.find((object) => object.kind === 'ellipse')
        const [hx, hy] = await screenOf(before.x + before.props.rx, before.y + before.props.ry)
        const [tx, ty] = await screenOf(before.x + before.props.rx + 60, before.y + before.props.ry + 60)
        await drag(hx, hy, tx, ty)
        await settled()
        const resized = (await project()).objects.find((object) => object.id === before.id)
        assert.ok(resized.props.rx > before.props.rx + 20, `rx is ${resized.props.rx}`)
        const frame = await page.evaluate((id) => window.vizmaticStudio.view.frameOfObject(id), before.id)
        const [rx, ry] = await screenOf(frame.center[0], frame.center[1] - frame.halfHeight)
        const [ex, ey] = await screenOf(frame.center[0] + 200, frame.center[1] - 200)
        await drag(rx, ry - 24, ex, ey)
        await settled()
        const rotated = (await project()).objects.find((object) => object.id === before.id)
        assert.ok(Math.abs(rotated.rotation) > 10, `rotation is ${rotated.rotation}`)
    })

    await step('snaps a dragged object and shows a guide', async () => {
        const circle = (await project()).objects.find((object) => object.kind === 'ellipse')
        const frame = await page.evaluate((id) => window.vizmaticStudio.view.frameOfObject(id), circle.id)
        await page.click(`[data-layer="${circle.id}"]`)
        // Any point inside the selected box moves it.
        const [x0, y0] = await screenOf(frame.center[0], frame.center[1])
        await page.mouse.move(x0, y0)
        await page.mouse.down()
        // Aim near the center of the frame so the center line catches it.
        const [x1, y1] = await screenOf(3, frame.center[1] - 40)
        await page.mouse.move(x1, y1, { steps: 6 })
        await delay(60)
        const guides = await page.locator('.snap-guide').count()
        await page.mouse.up()
        await settled()
        assert.ok(guides > 0, 'A guide should show while snapping')
    })

    await step('multi-selects with a marquee and aligns', async () => {
        await page.keyboard.press('Escape')
        const [x0, y0] = await screenOf(-955, -535)
        const [x1, y1] = await screenOf(955, 535)
        await drag(x0, y0, x1, y1)
        await settled()
        const count = await page.evaluate(() => window.vizmaticStudio.store.selection.length)
        assert.ok(count >= 2, `Marquee selected ${count}`)
        await page.click(q('align-center'))
        await settled()
        const objects = (await project()).objects
        const centers = await page.evaluate((ids) => ids.map((id) => {
            const frame = window.vizmaticStudio.view.frameOfObject(id)
            return frame.aabb.x + frame.aabb.width / 2
        }), objects.map((object) => object.id))
        assert.ok(Math.max(...centers) - Math.min(...centers) < 2, `Centers: ${centers}`)
        await shot('03-aligned')
        await page.keyboard.press('Escape')
    })

    await step('adds beats from the picker and they appear as clips', async () => {
        const objects = (await project()).objects
        const title = objects.find((object) => object.kind === 'text')
        const tex = objects.find((object) => object.kind === 'tex')
        await page.evaluate(() => window.vizmaticStudio.seek(0))
        await page.click(`[data-layer="${title.id}"]`)
        await page.click(q('add-beat'))
        await page.waitForSelector(q('beat-picker'))
        await shot('04-beat-picker')
        await page.click('[data-beat-kind="write"]')
        await settled()
        await page.evaluate(() => window.vizmaticStudio.seek(1.2))
        await page.click(`[data-layer="${tex.id}"]`)
        await page.keyboard.press('n')
        await page.waitForSelector(q('beat-picker'))
        await page.click('[data-beat-kind="fadeIn"]')
        await settled()
        assert.equal((await project()).beats.length, 2)
        assert.equal(await page.locator('[data-beat]').count(), 2)
    })

    await step('entrance beats hide an object until they start', async () => {
        const first = (await project()).beats.find((beat) => beat.kind === 'write')
        await page.evaluate((time) => window.vizmaticStudio.seek(time), first.start)
        await settled()
        const empty = await frameHash()
        await page.evaluate((time) => window.vizmaticStudio.seek(time), first.start + first.duration)
        await settled()
        assert.notEqual(await frameHash(), empty)
    })

    await step('scrubs the ruler with instant seek', async () => {
        const ruler = await box(q('ruler'))
        await page.mouse.move(ruler.x + 10, ruler.y + 10)
        await page.mouse.down()
        const seen = []
        for (const fraction of [0.1, 0.3, 0.2, 0.05]) {
            await page.mouse.move(ruler.x + ruler.width * fraction, ruler.y + 10)
            seen.push(await page.evaluate(() => window.vizmaticStudio.time))
        }
        await page.mouse.up()
        assert.ok(seen[1] > seen[0] && seen[2] < seen[1] && seen[3] < seen[2], `Times: ${seen}`)
    })

    await step('moves a clip and retimes it with an edge', async () => {
        const before = (await project()).beats.find((beat) => beat.kind === 'fadeIn')
        const clip = await box(`[data-beat="${before.id}"]`)
        const pps = clip.width / before.duration
        await drag(clip.x + clip.width / 2, clip.y + clip.height / 2, clip.x + clip.width / 2 + pps * 1.5, clip.y + clip.height / 2)
        await settled()
        const moved = (await project()).beats.find((beat) => beat.id === before.id)
        assert.ok(Math.abs(moved.start - (before.start + 1.5)) < 0.12, `start is ${moved.start}`)
        assert.equal(moved.duration, before.duration)
        const edge = await box(`[data-beat="${before.id}"] [data-edge="right"]`)
        await drag(edge.x + edge.width / 2, edge.y + edge.height / 2, edge.x + edge.width / 2 + pps, edge.y + edge.height / 2)
        await settled()
        const stretched = (await project()).beats.find((beat) => beat.id === before.id)
        assert.ok(Math.abs(stretched.duration - (before.duration + 1)) < 0.12, `duration is ${stretched.duration}`)
        assert.equal(stretched.start, moved.start)
    })

    await step('picks an easing from curve previews', async () => {
        const beat = (await project()).beats.find((entry) => entry.kind === 'fadeIn')
        await page.click(`[data-beat="${beat.id}"]`)
        await page.click(q('ease-button'))
        await page.waitForSelector(q('ease-grid'))
        assert.ok(await page.locator('.ease-option').count() >= 10)
        await shot('05-ease')
        await page.click('[data-ease="overshoot"]')
        await settled()
        assert.equal((await project()).beats.find((entry) => entry.id === beat.id).ease, 'overshoot')
    })

    await step('adds a chapter, sets a loop region, and changes speed', async () => {
        await page.evaluate(() => window.vizmaticStudio.seek(1))
        await page.click(q('add-marker'))
        await settled()
        assert.equal((await project()).markers.length, 1)
        const ruler = await box(q('ruler'))
        await page.keyboard.down('Shift')
        await drag(ruler.x + ruler.width * 0.02, ruler.y + 10, ruler.x + ruler.width * 0.2, ruler.y + 10)
        await page.keyboard.up('Shift')
        await settled()
        const { loop } = await project()
        assert.ok(loop && loop.to > loop.from, 'A loop region should exist')
        await page.selectOption(q('speed'), '2')
        assert.equal(await page.evaluate(() => window.vizmaticStudio.transport.speed), 2)
        await page.selectOption(q('speed'), '1')
    })

    await step('plays in real time and stops at the end', async () => {
        await page.evaluate(() => window.vizmaticStudio.seek(0))
        await page.click(q('play'))
        await delay(400)
        const during = await page.evaluate(() => ({ time: window.vizmaticStudio.time, playing: window.vizmaticStudio.playing }))
        assert.ok(during.playing && during.time > 0.1, `Time ${during.time}`)
        await page.keyboard.press('Space')
        await delay(50)
        assert.equal(await page.evaluate(() => window.vizmaticStudio.playing), false)
    })

    await step('inspector fields scrub, validate functions, and pick look colors', async () => {
        await page.click('[data-palette="graph"]')
        await settled()
        const graph = (await project()).objects.find((object) => object.kind === 'graph')
        const expr = page.locator('[data-field="expr"]')
        await expr.fill('sin(')
        await page.waitForSelector('.expr-field .field-error:not([hidden])')
        assert.equal((await project()).objects.find((object) => object.id === graph.id).props.expr, 'sin(x)', 'A broken function must not reach the document')
        await expr.fill('fetch(1)')
        assert.match(await page.textContent('.expr-field .field-error'), /Unknown function/)
        await expr.fill('2 sin(x)')
        await page.waitForFunction(() => document.querySelector('.expr-field .field-error').hidden)
        await settled()
        assert.equal((await project()).objects.find((object) => object.id === graph.id).props.expr, '2 sin(x)')
        const label = page.locator('.field-label.is-scrub', { hasText: 'Weight' })
        const rect = await label.boundingBox()
        const before = (await project()).objects.find((object) => object.id === graph.id).props.width
        await drag(rect.x + 8, rect.y + 6, rect.x + 48, rect.y + 6)
        await settled()
        assert.ok((await project()).objects.find((object) => object.id === graph.id).props.width > before, 'Dragging a label should scrub the value')
        await page.click('[data-field="stroke"]')
        await page.click('[data-color="pink"]')
        await settled()
        assert.equal((await project()).objects.find((object) => object.id === graph.id).props.stroke, 'pink')
        await shot('05b-inspector')
        await page.click(`[data-layer="${graph.id}"]`)
        await page.keyboard.press('Delete')
        await settled()
    })

    await step('builds a story: variable tween, morph, follow path, and canvas-set move', async () => {
        const app = 'window.vizmaticStudio'
        // A variable that a curve and a readout both read.
        await page.keyboard.press('Escape')
        await page.fill(q('new-variable'), 'h')
        await page.keyboard.press('Enter')
        await settled()
        assert.deepEqual((await project()).variables.map((variable) => variable.name), ['h'])
        await page.click('[data-palette="readout"]')
        await settled()
        await page.locator('[data-field="expr"]').fill('2 + h')
        await settled()
        const readout = (await project()).objects.find((object) => object.kind === 'readout')
        await page.evaluate((id) => window.vizmaticStudio.store.select([id]), readout.id)
        await page.evaluate((id) => window.vizmaticStudio.addBeat('value', id), readout.id)
        await settled()
        const tween = (await project()).beats.find((beat) => beat.kind === 'value')
        assert.equal(tween.target, '@values')
        await page.locator('[data-field="to"]').fill('8')
        await page.keyboard.press('Enter')
        await settled()
        await page.evaluate((time) => window.vizmaticStudio.seek(time), tween.start)
        await settled()
        const low = await frameHash()
        await page.evaluate((time) => window.vizmaticStudio.seek(time), tween.start + tween.duration)
        await settled()
        assert.notEqual(await frameHash(), low, 'The readout should change as its variable moves')

        // Morph between two equations, with the picker defaulting to the other one.
        await page.keyboard.press('Escape')
        await page.click('[data-palette="tex"]')
        await settled()
        await page.locator('[data-field="source"]').fill('c = \\\\sqrt{a^2 + b^2}'.replace(/\\\\/g, '\\'))
        await settled()
        const objects = (await project()).objects
        const texA = objects.find((object) => object.kind === 'tex')
        const texB = objects.filter((object) => object.kind === 'tex').at(-1)
        await page.evaluate(([a, b]) => {
            const studio = window.vizmaticStudio
            studio.seek(studio.duration)
            studio.store.select([a])
            const beat = studio.addBeat('morph', a, { preview: false })
            studio.store.commit((draft) => { draft.beats.find((entry) => entry.id === beat.id).params.into = b })
        }, [texA.id, texB.id])
        await settled()
        assert.equal(await page.evaluate(() => window.vizmaticStudio.built.beatErrors.size), 0)

        // Follow the circle's outline, then drag a move beat's destination on the canvas.
        await page.click('[data-palette="dot"]')
        await settled()
        const dot = (await project()).objects.find((object) => object.kind === 'dot')
        const circle = (await project()).objects.find((object) => object.kind === 'ellipse')
        await page.evaluate(([d, c]) => {
            const studio = window.vizmaticStudio
            const beat = studio.addBeat('along', d, { preview: false })
            studio.store.commit((draft) => { draft.beats.find((entry) => entry.id === beat.id).params.path = c })
        }, [dot.id, circle.id])
        await settled()
        assert.equal(await page.evaluate(() => window.vizmaticStudio.built.beatErrors.size), 0)
        const move = await page.evaluate((d) => window.vizmaticStudio.addBeat('move', d, { preview: false }), dot.id)
        await settled()
        await page.evaluate((time) => window.vizmaticStudio.seek(time), move.start + move.duration)
        await page.evaluate((d) => window.vizmaticStudio.store.select([d]), dot.id)
        await settled()
        const frame = await page.evaluate((d) => window.vizmaticStudio.view.frameOfObject(d), dot.id)
        const [x0, y0] = await screenOf(frame.center[0], frame.center[1])
        const [x1, y1] = await screenOf(frame.center[0] + 160, frame.center[1] - 90)
        await page.click(q('snap'))
        await drag(x0, y0, x1, y1)
        await page.click(q('snap'))
        await settled()
        const edited = (await project()).beats.find((beat) => beat.id === move.id)
        assert.ok(Math.abs(Number(edited.params.x) - (Number(move.params.x) + 160)) < 6, `The drag should set the destination, x is ${edited.params.x}`)
        const dotAfter = (await project()).objects.find((object) => object.id === dot.id)
        assert.equal(dotAfter.x, dot.x, 'The start position stays when a move beat is being edited')
        await shot('05c-story')
        assert.ok(app)
    })

    await step('renames a layer by double click', async () => {
        const target = (await project()).objects[0]
        const row = await box(`[data-layer="${target.id}"]`)
        await page.mouse.dblclick(row.x + 60, row.y + row.height / 2)
        await page.waitForSelector('.layer-rename')
        await page.fill('.layer-rename', 'Renamed layer')
        await page.keyboard.press('Enter')
        await settled()
        assert.equal((await project()).objects[0].name, 'Renamed layer')
        await page.evaluate((name) => window.vizmaticStudio.store.commit((draft) => { draft.objects[0].name = name }), target.name)
        await settled()
    })

    await step('reorders tracks, renames and drags chapters', async () => {
        const order = (await project()).objects.map((object) => object.id)
        const top = order.at(-1), lower = order.at(-3)
        const grip = await box(`[data-grip="${top}"]`)
        const row = await box(`[data-row="${lower}"]`)
        await page.hover(`[data-track="${top}"]`)
        await drag(grip.x + 3, grip.y + 6, grip.x + 3, row.y + row.height / 2)
        await settled()
        const reordered = (await project()).objects.map((object) => object.id)
        assert.notDeepEqual(reordered, order, 'Dragging a track should change the stacking order')
        const marker = (await project()).markers[0]
        const ruler = await box(q('ruler'))
        const clip = await page.evaluate(() => {
            const scroller = document.querySelector('[data-test="timeline-scroller"]')
            return { left: scroller.scrollLeft }
        })
        const pps = await page.evaluate(() => {
            const beat = window.vizmaticStudio.store.project.beats[0]
            const element = document.querySelector(`[data-beat="${beat.id}"]`)
            return element.getBoundingClientRect().width / beat.duration
        })
        const markerX = ruler.x + marker.time * pps - clip.left
        await page.mouse.dblclick(markerX, ruler.y + 18)
        await page.waitForSelector(q('marker-title'))
        await page.fill(q('marker-title'), 'Renamed')
        await page.keyboard.press('Enter')
        await settled()
        assert.equal((await project()).markers[0].title, 'Renamed')
        await drag(markerX, ruler.y + 18, markerX + pps * 0.5, ruler.y + 18)
        await settled()
        assert.ok(Math.abs((await project()).markers[0].time - (marker.time + 0.5)) < 0.15)
    })

    await step('panels resize and remember their size', async () => {
        const before = (await box('.right-panel')).width
        const handle = await box('[data-resizer="right"]')
        await drag(handle.x, handle.y + 200, handle.x - 60, handle.y + 200)
        assert.ok(Math.abs((await box('.right-panel')).width - (before + 60)) < 3)
        const height = (await box('.timeline')).height
        const bottom = await box('[data-resizer="bottom"]')
        await drag(bottom.x + 300, bottom.y, bottom.x + 300, bottom.y - 40)
        assert.ok(Math.abs((await box('.timeline')).height - (height + 40)) < 3)
    })

    await step('undoes and redoes across the whole document', async () => {
        const start = await project()
        await page.click(`[data-layer="${start.objects[0].id}"]`)
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Delete')
        await settled()
        const removed = await project()
        assert.equal(removed.objects.length, start.objects.length - 1)
        await page.click(q('undo'))
        await settled()
        assert.equal((await project()).objects.length, start.objects.length)
        await page.keyboard.press('Control+z')
        await page.keyboard.press('Meta+z')
        await settled()
        await page.click(q('redo'))
        await settled()
        await page.keyboard.press('Shift+Control+z')
        await settled()
        const redone = await project()
        assert.ok(redone.objects.length <= start.objects.length)
        for (let i = 0; i < 6; i++) await page.click(q('undo')).catch(() => {})
        await page.keyboard.press('Control+Shift+Z')
        await settled()
    })

    await step('switches looks, which re-themes the film', async () => {
        await page.evaluate(() => window.vizmaticStudio.seek(window.vizmaticStudio.duration))
        await settled()
        const midnight = await frameHash()
        await page.selectOption(q('look'), 'paper')
        await settled()
        assert.equal((await project()).look, 'paper')
        assert.notEqual(await frameHash(), midnight)
        await shot('06-paper')
        await page.selectOption(q('look'), 'blueprint')
        await settled()
        await page.selectOption(q('look'), 'midnight')
        await settled()
        assert.equal(await frameHash(), midnight)
    })

    await step('changes the frame shape', async () => {
        await page.selectOption(q('aspect'), '9:16')
        await settled()
        const sheet = await box('.stage-sheet')
        assert.ok(sheet.height > sheet.width * 1.6, `${sheet.width} by ${sheet.height}`)
        await shot('07-portrait')
        await page.selectOption(q('aspect'), '16:9')
        await settled()
    })

    let savedName
    await step('autosaves and restores after a reload', async () => {
        await page.fill(q('project-name'), 'Journey film')
        await page.keyboard.press('Enter')
        await settled()
        savedName = await project()
        await page.evaluate(() => window.vizmaticStudio.saveNow())
        await page.reload()
        await page.waitForFunction(() => window.vizmaticStudio?.root.dataset.compiled)
        await settled()
        assert.equal(await page.locator(q('welcome')).count(), 0)
        const restored = await project()
        assert.equal(restored.name, 'Journey film')
        assert.deepEqual(restored.objects.map((object) => object.id), savedName.objects.map((object) => object.id))
        assert.deepEqual(restored.beats, savedName.beats)
    })

    let shareUrl
    await step('opens a shared link with the same project', async () => {
        await page.click(q('share'))
        const input = page.locator(q('share-url'))
        shareUrl = await input.inputValue()
        assert.ok(shareUrl.includes('#p='), shareUrl.slice(0, 80))
        await page.keyboard.press('Escape')
        const other = await context.newPage()
        other.on('pageerror', (error) => pageErrors.push(String(error)))
        await other.addInitScript(() => localStorage.clear())
        await other.goto(shareUrl)
        await other.waitForFunction(() => window.vizmaticStudio?.root.dataset.compiled)
        const opened = await other.evaluate(() => JSON.parse(JSON.stringify(window.vizmaticStudio.store.project)))
        assert.equal(opened.name, 'Journey film')
        assert.deepEqual(opened.objects, savedName.objects)
        assert.equal(await other.locator(q('welcome')).count(), 0)
        await other.close()
    })

    await step('rejects a damaged link and falls back gracefully', async () => {
        const other = await context.newPage()
        await other.goto(`${base}#p=%%%notreal`)
        await other.waitForSelector('#studioToast.is-error')
        assert.match(await other.textContent('#studioToast'), /damaged/)
        await other.close()
    })

    await step('command palette runs commands, and the shortcut sheet lists keys', async () => {
        await page.keyboard.press('Escape')
        await page.keyboard.press('Control+k')
        await page.waitForSelector(q('command-palette'))
        await shot('08-commands')
        await page.fill(q('command-input'), 'fit timeline')
        await page.keyboard.press('Enter')
        await page.waitForSelector(q('command-palette'), { state: 'detached' })
        await page.keyboard.press('Shift+?')
        await page.waitForSelector(q('shortcuts'))
        assert.ok((await page.locator('.shortcut-row').count()) > 15)
        await shot('09-shortcuts')
        await page.keyboard.press('Escape')
    })

    const exportFile = async (format, configure) => {
        await page.click(q('export'))
        await page.waitForSelector(q('export-dialog'))
        await page.click(`[data-format="${format}"]`)
        await configure?.()
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), page.click(q('export-start'))])
        const path = join(downloads, download.suggestedFilename())
        await download.saveAs(path)
        await page.waitForFunction((test) => {
            const status = document.querySelector(`[data-test="${test}"]`)
            return status?.dataset.done === 'true' || status?.dataset.error === 'true'
        }, 'export-status', { timeout: 180000 })
        const status = await page.textContent(q('export-status'))
        await shot(`10-export-${format}`)
        await page.keyboard.press('Escape')
        return { path, status }
    }

    await step('exports a PNG of the current frame', async () => {
        await page.evaluate(() => window.vizmaticStudio.seek(window.vizmaticStudio.duration))
        await settled()
        const { path } = await exportFile('png', () => page.selectOption(q('export-width'), { index: 0 }))
        const bytes = readFileSync(path)
        assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
        const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
        assert.equal(width, 1280)
        assert.equal(height, 720)
    })

    await step('exports SVG with outlined text', async () => {
        const { path } = await exportFile('svg')
        const svg = readFileSync(path, 'utf8')
        assert.match(svg, /^<svg /)
        assert.ok(!svg.includes('<text'), 'Text should be outlines')
    })

    await step('exports an MP4 that ffprobe can decode', async () => {
        const { path, status } = await exportFile('mp4', async () => {
            await page.selectOption(q('export-width'), { index: 0 })
            await page.selectOption(q('export-fps'), '30')
        })
        console.log(`      ${status}`)
        assert.ok(statSync(path).size > 1000)
        const extension = path.split('.').pop()
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate:format=duration,format_name', '-of', 'json', path]).toString())
        const stream = probe.streams[0]
        const seconds = await page.evaluate(() => window.vizmaticStudio.duration)
        assert.equal(stream.width, 1280)
        assert.equal(stream.height, 720)
        assert.equal(stream.r_frame_rate, '30/1')
        assert.equal(Number(stream.nb_read_frames), Math.round(seconds * 30))
        if (extension === 'mp4') {
            assert.match(probe.format.format_name, /mp4/)
            assert.ok(['h264', 'vp9'].includes(stream.codec_name), stream.codec_name)
        }
        execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'])
        if (shots) execFileSync('ffmpeg', ['-v', 'error', '-y', '-sseof', '-0.2', '-i', path, '-frames:v', '1', join(shots, '11-mp4-last-frame.png')])
    })

    await step('cancels a running export', async () => {
        await page.click(q('export'))
        await page.click('[data-format="mp4"]')
        await page.selectOption(q('export-width'), { index: 3 })
        await page.click(q('export-start'))
        await delay(250)
        await page.click(q('export-start'))
        await page.waitForFunction((test) => /cancel/i.test(document.querySelector(`[data-test="${test}"]`)?.textContent ?? ''), 'export-status', { timeout: 60000 })
        await page.keyboard.press('Escape')
    })

    await step('exports a GIF', async () => {
        const { path } = await exportFile('gif', async () => {
            await page.selectOption(q('export-width'), { index: 0 })
            await page.evaluate(() => {
                // A short loop region keeps this step quick.
                const select = document.querySelector('[data-test="export-range"]')
                if (select.querySelector('option[value="loop"]')) select.value = 'loop'
            })
        })
        assert.equal(readFileSync(path).subarray(0, 3).toString(), 'GIF')
    })

    await step('exports WebM that ffprobe can decode', async () => {
        const { path } = await exportFile('webm', async () => {
            await page.selectOption(q('export-width'), { index: 0 })
            await page.selectOption(q('export-fps'), '30')
            await page.selectOption(q('export-quality'), 'draft')
        })
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width:format=format_name', '-of', 'json', path]).toString())
        assert.match(probe.format.format_name, /webm|matroska/)
        assert.equal(probe.streams[0].width, 1280)
        execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'null', '-'])
    })

    await step('saves a project file and opens it again', async () => {
        const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')])
        const path = join(downloads, saved.suggestedFilename())
        await saved.saveAs(path)
        const onDisk = JSON.parse(readFileSync(path, 'utf8'))
        assert.equal(onDisk.name, 'Journey film')
        await page.evaluate(() => window.vizmaticStudio.store.commit((draft) => { draft.name = 'Changed' }))
        await settled()
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+o')])
        await chooser.setFiles(path)
        await page.waitForFunction(() => window.vizmaticStudio.store.project.name === 'Journey film')
        await settled()
        await page.click(q('file-menu'))
        await page.waitForSelector('[data-menu="restore"]')
        await page.keyboard.press('Escape')
    })

    await step('exports film.tsx that matches the visual project', async () => {
        const { path } = await exportFile('tsx')
        const source = readFileSync(path, 'utf8')
        assert.match(source, /from 'vizmatic\/stage'/)
        assert.match(source, /export default film\(/)
        assert.equal(source, await page.evaluate(() => window.vizmaticStudio.generatedSource()))
    })

    await step('shows live generated code', async () => {
        await page.click(q('code-tab'))
        const before = await page.inputValue(q('generated-code'))
        assert.match(before, /Journey film/)
        await page.click('[data-palette="dot"]')
        await settled()
        const after = await page.inputValue(q('generated-code'))
        assert.match(after, /dot\(/)
        await shot('12-code-view')
        await page.click('.tab[data-tab="inspect"]')
    })

    await step('present mode steps through chapters', async () => {
        await page.evaluate(() => {
            const app = window.vizmaticStudio
            app.store.commit((draft) => {
                draft.hold = 2
                draft.markers = [{ id: 'present-1', time: 0.6, title: 'First stop' }]
            })
        })
        await settled()
        await page.click(q('present'))
        await page.waitForSelector('.is-presenting')
        await page.waitForFunction(() => !window.vizmaticStudio.playing, null, { timeout: 30000 })
        await delay(100)
        await shot('13-present')
        const sheet = await box('.stage-sheet')
        const view = page.viewportSize()
        assert.ok(sheet.width > view.width * 0.95 || sheet.height > view.height * 0.95, `The film should fill the window, not ${sheet.width} by ${sheet.height}`)
        const first = await page.evaluate(() => window.vizmaticStudio.time)
        const end = await page.evaluate(() => window.vizmaticStudio.duration)
        try {
            assert.ok(Math.abs(first - 0.6) < 0.05, `The first step should stop at its chapter, not ${first}`)
            await page.keyboard.press('ArrowRight')
            await delay(120)
            await page.waitForFunction(() => !window.vizmaticStudio.playing, null, { timeout: 30000 })
            const second = await page.evaluate(() => window.vizmaticStudio.time)
            assert.ok(Math.abs(second - end) < 0.05, `The second step should reach the end, not ${second}`)
            await page.keyboard.press('ArrowLeft')
            await delay(50)
            assert.ok(Math.abs(await page.evaluate(() => window.vizmaticStudio.time) - 0.6) < 0.05)
        } finally {
            await page.keyboard.press('Escape')
        }
        await page.waitForSelector('.is-presenting', { state: 'detached' })
    })

    await step('code mode compiles live and points at the failing line', async () => {
        await page.click(q('mode-code'))
        await page.waitForFunction(() => Number(window.vizmaticStudio.root.dataset.codeCompiled) > 0, null, { timeout: 60000 })
        await shot('14-code-mode')
        const editor = page.locator(q('code-editor'))
        await editor.fill("import { film, text, write } from 'vizmatic/stage'\n\nexport default film((s) => {\n    const t = s.add(text('Code mode', { size: 90, font: 'serif' }))\n    s.play(write(t))\n})\n")
        await page.waitForFunction(() => window.vizmaticStudio.sandboxDuration > 0 && window.vizmaticStudio.root.dataset.codeError === undefined, null, { timeout: 30000 })
        const runs = await page.evaluate(() => Number(window.vizmaticStudio.root.dataset.codeCompiled))
        await editor.fill("import { film } from 'vizmatic/stage'\n\nexport default film((s) => {\n    const broken = = 1\n})\n")
        await page.waitForSelector(`${q('code-error')}:not([hidden])`, { timeout: 15000 })
        assert.match(await page.textContent(q('code-error')), /Line 4/)
        await shot('15-code-syntax-error')
        await editor.fill("import { film } from 'vizmatic/stage'\n\nexport default film((s) => {\n    s.wait(1)\n\n    throw new Error('Runtime trouble')\n})\n")
        await page.waitForFunction((test) => /Runtime trouble/.test(document.querySelector(`[data-test="${test}"]`)?.textContent ?? ''), 'code-error', { timeout: 15000 })
        assert.match(await page.textContent(q('code-error')), /Line 6/)
        assert.ok(runs > 0)
    })

    await step('the sandbox cannot reach the Studio origin', async () => {
        const editor = page.locator(q('code-editor'))
        const probe = `import { film, text } from 'vizmatic/stage'

const attempt = (fn) => { try { return String(fn()) } catch (error) { return 'blocked: ' + error.name } }
const report = {
    origin: self.origin,
    parentDocument: attempt(() => parent.document.title),
    parentLocation: attempt(() => parent.location.href),
    storage: attempt(() => localStorage.getItem('vizmatic-studio-autosave-v1')),
    cookie: attempt(() => document.cookie),
    topNavigation: attempt(() => { top.location.href = 'https://example.invalid/'; return 'navigated' }),
}
console.log(JSON.stringify(report))
fetch(${JSON.stringify(new URL('robots.txt', base).href)}).then(
    () => console.log('NETWORK_ALLOWED'),
    (error) => console.log('NETWORK_BLOCKED ' + error.name),
)

export default film((s) => {
    s.add(text('Sandbox probe', { size: 60 }))
    s.wait(1)
})
`
        await editor.fill(probe)
        await page.waitForFunction((test) => /NETWORK_/.test(document.querySelector(`[data-test="${test}"]`)?.textContent ?? ''), 'code-logs', { timeout: 30000 })
        const logs = await page.textContent(q('code-logs'))
        const report = JSON.parse(logs.slice(logs.indexOf('{'), logs.lastIndexOf('}') + 1))
        assert.equal(report.origin, 'null')
        assert.match(report.parentDocument, /^blocked/)
        assert.match(report.parentLocation, /^blocked/)
        assert.match(report.storage, /^blocked/)
        assert.match(report.cookie, /^blocked|^$/)
        assert.match(report.topNavigation, /^blocked/)
        assert.match(logs, /NETWORK_BLOCKED/)
        assert.ok(!logs.includes('NETWORK_ALLOWED'))
        assert.equal(page.url().includes('example.invalid'), false)
    })

    await step('code mode exports an MP4 from inside the sandbox', async () => {
        const editor = page.locator(q('code-editor'))
        await editor.fill("import { film, text, write } from 'vizmatic/stage'\n\nexport default film({ fps: 30 }, (s) => {\n    const t = s.add(text('Sandboxed export', { size: 90, font: 'serif' }))\n    s.play(write(t), { duration: 0.8 })\n    s.wait(0.2)\n})\n")
        await page.waitForFunction(() => window.vizmaticStudio.root.dataset.codeError === undefined && window.vizmaticStudio.sandboxDuration > 0.9 && window.vizmaticStudio.sandboxDuration < 1.1, null, { timeout: 30000 })
        const { path } = await exportFile('mp4', async () => {
            await page.selectOption(q('export-width'), { index: 0 })
            await page.selectOption(q('export-fps'), '30')
        })
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width', '-of', 'json', path]).toString())
        assert.equal(probe.streams[0].width, 1280)
        assert.equal(Number(probe.streams[0].nb_read_frames), 30)
    })

    await step('the look switcher re-themes a hand-written film', async () => {
        const runs = await page.evaluate(() => Number(window.vizmaticStudio.root.dataset.codeCompiled))
        await page.selectOption(q('look'), 'paper')
        await page.waitForFunction((count) => Number(window.vizmaticStudio.root.dataset.codeCompiled) > count, runs, { timeout: 30000 })
        assert.equal((await project()).codeLook, 'paper')
        await shot('14b-code-paper')
    })

    let codeShare
    await step('a shared code project stays paused until asked to run', async () => {
        await page.click(q('share'))
        codeShare = await page.locator(q('share-url')).inputValue()
        await page.keyboard.press('Escape')
        const other = await context.newPage()
        await other.addInitScript(() => localStorage.clear())
        await other.goto(codeShare)
        await other.waitForSelector(`${q('code-paused')}:not([hidden])`)
        await delay(300)
        assert.equal(await other.evaluate(() => window.vizmaticStudio.root.dataset.codeCompiled), undefined)
        await other.click(q('run-shared-code'))
        await other.waitForFunction(() => Number(window.vizmaticStudio.root.dataset.codeCompiled) > 0, null, { timeout: 60000 })
        await other.close()
    })

    await step('returns to visual editing with the project intact', async () => {
        await page.click(q('mode-visual'))
        await settled()
        await page.waitForFunction(() => window.vizmaticStudio.built !== null, null, { timeout: 15000 })
        assert.equal((await project()).mode, 'visual')
        assert.ok((await project()).objects.length >= 3)
        // Undo covers the mode switch too, and the panels follow.
        await page.click(q('undo'))
        await page.waitForSelector('.studio.is-code')
        assert.equal((await project()).mode, 'code')
        await page.click(q('redo'))
        await page.waitForSelector('.studio.is-code', { state: 'detached' })
        await settled()
        await page.waitForFunction(() => window.vizmaticStudio.built !== null, null, { timeout: 15000 })
    })

    await step('every template opens, and every palette kind builds', async () => {
        await page.evaluate(() => window.vizmaticStudio.newProject())
        await page.waitForSelector(q('welcome'))
        await page.click('[data-template="architecture"]')
        await page.waitForSelector(q('welcome'), { state: 'detached' })
        await settled()
        await page.evaluate(() => window.vizmaticStudio.seek(7))
        await settled()
        await shot('16-architecture')
        const kinds = await page.$$eval('[data-palette]', (items) => items.map((item) => item.dataset.palette))
        await page.evaluate(() => window.vizmaticStudio.newProject())
        await page.waitForSelector(q('welcome'))
        await page.click(q('blank'))
        await page.waitForSelector(q('welcome'), { state: 'detached' })
        for (const kind of kinds) await page.click(`[data-palette="${kind}"]`)
        await settled()
        await delay(400)
        const errors = await page.evaluate(() => [...window.vizmaticStudio.built.objectErrors])
        assert.deepEqual(errors, [])
        await shot('17-all-kinds')
    })

    await step('plays a dense template at a usable frame rate', async () => {
        await page.evaluate(() => window.vizmaticStudio.newProject())
        await page.waitForSelector(q('welcome'))
        await page.click('[data-template="explainer"]')
        await page.waitForSelector(q('welcome'), { state: 'detached' })
        await settled()
        const measured = await page.evaluate(() => new Promise((done) => {
            const studio = window.vizmaticStudio
            studio.seek(0)
            studio.togglePlay()
            let frames = 0
            const start = performance.now()
            const count = () => {
                frames += 1
                if (performance.now() - start < 2000) requestAnimationFrame(count)
                else {
                    studio.togglePlay()
                    done(frames / 2)
                }
            }
            requestAnimationFrame(count)
        }))
        console.log(`      ${measured.toFixed(1)} frames per second in this headless software renderer`)
        assert.ok(measured > 15, `Only ${measured} fps`)
    })

    await step('had no uncaught page errors along the way', async () => {
        // The sandbox probe logs the browser blocking it, which is the point of that step.
        const unexpected = pageErrors.filter((text) => !/ERR_ABORTED|net::|Failed to load resource|Unsafe attempt to initiate navigation|Content Security Policy/.test(text))
        assert.deepEqual(unexpected, [])
    })
} finally {
    await browser.close()
    server.kill()
    rmSync(downloads, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
    console.log(failures.map((name) => `  - ${name}`).join('\n'))
    process.exitCode = 1
}
if (!existsSync('docs/studio.html')) process.exitCode = 1
