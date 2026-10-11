#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const docsRoot = resolve('docs')
const playgroundPath = join(docsRoot, 'playground.html')
await access(playgroundPath).catch(() => { throw new Error('Build docs/playground.html first with `pnpm site:build`.') })

const contentTypes = new Map([
    ['.css', 'text/css; charset=utf-8'], ['.gif', 'image/gif'], ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
    ['.md', 'text/plain; charset=utf-8'], ['.png', 'image/png'], ['.svg', 'image/svg+xml'],
    ['.ttf', 'font/ttf'], ['.txt', 'text/plain; charset=utf-8'], ['.wasm', 'application/wasm'], ['.woff2', 'font/woff2'],
])

const server = createServer(async (request, response) => {
    let file
    try {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
        const candidate = resolve(docsRoot, `.${pathname}`)
        if (candidate !== docsRoot && !candidate.startsWith(`${docsRoot}/`)) throw new Error('Path outside docs.')
        const info = await stat(candidate).catch(() => undefined)
        file = info?.isDirectory() ? join(candidate, 'index.html') : info?.isFile() ? candidate : join(docsRoot, 'index.html')
        const fileInfo = await stat(file)
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': fileInfo.size,
            'Content-Type': contentTypes.get(extname(file)) ?? 'application/octet-stream',
        })
        createReadStream(file).pipe(response)
    } catch {
        response.writeHead(404)
        response.end('Not found')
    }
})

await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
})
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Could not start the local docs server.')
const origin = `http://127.0.0.1:${address.port}`

let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
if (!executablePath && process.platform === 'linux') {
    const localChrome = '/usr/bin/google-chrome'
    executablePath = await access(localChrome).then(() => localChrome).catch(() => undefined)
}

let browser
try {
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const source = () => page.locator('#playgroundSource').inputValue()
    const downloadedBytes = async (button) => {
        const downloadStarted = page.waitForEvent('download', { timeout: 120_000 })
        await button.click()
        const download = await downloadStarted
        const path = await download.path()
        assert.ok(path, `${download.suggestedFilename()} should be saved.`)
        return readFile(path)
    }
    const ready = async () => {
        await page.waitForTimeout(400)
        await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.dataset.state === 'ready', undefined, { timeout: 45_000 })
        const error = page.locator('#playgroundError')
        assert.equal(await error.isVisible(), false, await error.textContent())
        await page.waitForFunction(() => {
            const image = document.querySelector('#playgroundCanvas img')
            return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
        }, undefined, { timeout: 10_000 })
    }
    const selectInstance = async (name) => {
        const value = await page.locator('#explorerInstance').evaluate((select, target) => {
            const option = [...select.options].find((entry) => entry.textContent?.trim().startsWith(target))
            return option?.value
        }, name)
        assert.notEqual(value, undefined, `No scene instance named ${name} was available.`)
        await page.locator('#explorerInstance').selectOption(value)
    }
    const drag = async (handle, dx, dy) => {
        const box = await handle.boundingBox()
        assert.ok(box, 'Canvas handle should be visible.')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 })
        await page.mouse.up()
    }

    await page.goto(`${origin}/playground.html`)
    await ready()
    await page.locator('#playgroundNewCanvas').click()
    await ready()
    const initialCanvas = await source()
    assert.match(initialCanvas, /<Board\b/)
    assert.equal(await page.locator('.playground-canvas-item').count(), 3, 'The starter canvas should expose all three movable items.')

    const moveHandle = page.locator('.playground-canvas-item .playground-canvas-move').nth(1)
    await drag(moveHandle, 22, 18)
    await ready()
    const movedCanvas = await source()
    assert.notEqual(movedCanvas, initialCanvas, 'Dragging an item should update its source coordinates.')
    assert.match(movedCanvas, /x=\{\d+\} y=\{\d+\}/)
    await page.locator('#playgroundUndoButton').click()
    await ready()
    assert.equal(await source(), initialCanvas, 'One drag should be one undo step.')

    let keyboardMove = page.locator('.playground-canvas-item .playground-canvas-move').nth(1)
    await keyboardMove.focus()
    const beforeNudges = await source()
    await keyboardMove.press('ArrowRight')
    await ready()
    keyboardMove = page.locator('.playground-canvas-item .playground-canvas-move').nth(1)
    await keyboardMove.press('ArrowRight')
    await ready()
    assert.notEqual(await source(), beforeNudges, 'Repeated keyboard moves should remain available after the preview rerenders.')

    let keyboardResize = page.locator('.playground-canvas-item .playground-canvas-resize').nth(1)
    await keyboardResize.focus()
    const beforeKeyboardResize = await source()
    await keyboardResize.press('ArrowRight')
    await ready()
    keyboardResize = page.locator('.playground-canvas-item .playground-canvas-resize').nth(1)
    await keyboardResize.press('ArrowDown')
    await ready()
    assert.notEqual(await source(), beforeKeyboardResize, 'Repeated keyboard resizes should remain available after the preview rerenders.')

    await page.locator('#playgroundNewCanvas').click()
    await ready()
    const freshCanvas = await source()

    const resizeHandle = page.locator('.playground-canvas-item .playground-canvas-resize').nth(1)
    await drag(resizeHandle, 28, 22)
    await ready()
    const resizedCanvas = await source()
    assert.notEqual(resizedCanvas, freshCanvas, 'Resizing an item should update its source dimensions.')
    assert.match(resizedCanvas, /width=\{\d+\} height=\{\d+\}/)
    await page.locator('#playgroundUndoButton').click()
    await ready()
    assert.equal(await source(), freshCanvas, 'One resize should be one undo step.')

    await page.getByRole('button', { name: 'Edit text: Build your visual', exact: true }).dblclick()
    await page.locator('.playground-text-input').fill('My visual')
    await page.locator('.playground-text-input').press('Enter')
    await ready()
    assert.match(await source(), /My visual/)

    await selectInstance('BarChart')
    const firstBarValue = page.getByLabel('Data row 1 value', { exact: true })
    await firstBarValue.fill('905')
    await firstBarValue.press('Tab')
    await ready()
    assert.match(await source(), /"value":905/)
    await page.getByRole('button', { name: 'Add data row', exact: true }).click()
    await ready()
    assert.equal(await page.locator('.explorer-data-row').count(), 4)
    assert.match(await source(), /"label":"Item 4","value":1/)

    for (const name of ['PieChart', 'ParetoBarChart', 'ScatterPlot']) {
        await page.locator(`#component-${name}`).click()
        await ready()
        assert.match(await source(), new RegExp(`<${name}\\b`), `${name} should load and render from the component chooser.`)
    }

    await page.locator('#component-GraphDiagram').click()
    await ready()
    await page.locator('#explorerCode').evaluate((details) => { details.open = true })
    const graphSource = await source()
    const graphWithRouting = graphSource.includes('routing=')
        ? graphSource : graphSource.replace('<GraphDiagram ', '<GraphDiagram routing="dagre" ')
    assert.match(graphWithRouting, /routing=['"]dagre['"]/)
    if (graphWithRouting !== graphSource) {
        await page.locator('#playgroundSource').fill(graphWithRouting)
        await page.locator('#playgroundRunButton').click()
        await ready()
    }
    await selectInstance('GraphDiagram')
    const routing = page.locator('[data-control-prop="routing"]')
    await routing.selectOption('orthogonal')
    await ready()
    assert.match(await source(), /routing=\{?["']orthogonal["']\}?/)
    assert.equal(await page.locator('#playgroundError').isVisible(), false)

    await page.locator('#playgroundShareButton').click()
    await page.waitForFunction(() => location.hash.startsWith('#vizmatic-playground='))
    const sharedSource = decodeURIComponent(new URL(page.url()).hash.slice('#vizmatic-playground='.length))
    assert.equal(sharedSource, await source(), 'The share URL should preserve the editable TSX.')
    await page.locator('#playgroundCopyButton').click()
    await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.textContent === 'Source copied.')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await source())

    await page.locator('#playgroundNewCanvas').click()
    await ready()
    await page.locator('#playgroundProjectName').fill('Release rehearsal')
    await page.locator('[data-playground-theme="light"]').click()
    await ready()
    await page.locator('#explorerBackground').selectOption('theme')
    await ready()
    const projectSource = await source()
    const downloadStarted = page.waitForEvent('download')
    await page.locator('#playgroundSaveProject').click()
    const projectDownload = await downloadStarted
    assert.match(projectDownload.suggestedFilename(), /^Release-rehearsal.*\.vizmatic\.json$/)
    const projectFilePath = await projectDownload.path()
    assert.ok(projectFilePath)
    const savedProject = JSON.parse(await readFile(projectFilePath, 'utf8'))
    assert.deepEqual(savedProject, {
        format: 'vizmatic', version: 1, name: 'Release rehearsal', source: projectSource, theme: 'light', background: 'theme',
    })

    await page.locator('#playgroundNewCanvas').click()
    await ready()
    await page.locator('#playgroundOpenProject').click()
    await page.locator('#playgroundProjectFile').setInputFiles(projectFilePath)
    await ready()
    assert.equal(await source(), projectSource)
    assert.equal(await page.locator('#playgroundProjectName').inputValue(), 'Release rehearsal')
    assert.equal(await page.locator('#explorerBackground').inputValue(), 'theme')
    assert.equal(await page.locator('[data-playground-theme="light"]').getAttribute('aria-pressed'), 'true')

    const validSource = await source()
    await page.locator('#playgroundSource').fill(`${validSource}\n<`)
    await page.waitForFunction(() => !document.querySelector('#playgroundError')?.hidden, undefined, { timeout: 20_000 })
    await page.locator('#playgroundUndoButton').click()
    await ready()
    assert.equal(await source(), validSource, 'Undo should recover from a source syntax error.')

    await page.locator('#explorerCode').evaluate((details) => { details.open = true })
    await page.locator('#playgroundTemplate').selectOption('animation')
    await ready()
    assert.equal(await page.locator('#playgroundAnimation').isVisible(), true, 'The animation template should enable playback controls.')
    const firstFrame = await downloadedBytes(page.locator('#playgroundPngButton'))
    await page.locator('#playgroundTime').evaluate((input) => {
        input.value = '1.5'
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await ready()
    const scrubbedFrame = await downloadedBytes(page.locator('#playgroundPngButton'))
    assert.notDeepEqual(scrubbedFrame, firstFrame, 'Scrubbing should render a different animated frame.')

    const gifBytes = await downloadedBytes(page.locator('#playgroundGifButton'))
    assert.equal(gifBytes.subarray(0, 6).toString(), 'GIF89a', 'GIF export should have a valid GIF89a header.')
    assert.ok(gifBytes.length > 5_000, `GIF export should contain animation data, got ${gifBytes.length} bytes.`)
    assert.equal(gifBytes.readUInt16LE(6), 960)
    assert.equal(gifBytes.readUInt16LE(8), 540)
    await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.textContent?.includes('GIF exported'), undefined, { timeout: 120_000 })

    await page.setViewportSize({ width: 320, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'The builder should fit a 320px viewport.')
    assert.deepEqual(pageErrors, [], `Unexpected browser errors: ${pageErrors.join('; ')}`)

    console.log(JSON.stringify({
        result: 'PASS',
        checks: [
            'canvas item drag and resize with single-step undo, repeated keyboard move and resize', 'inline text editing', 'chart data row edit and add',
            'PieChart, ParetoBarChart, and ScatterPlot chooser renders', 'orthogonal routing control',
            'share link and copied source', 'project save/open with source, theme, and background',
            'syntax error recovery', 'animation scrub changes PNG output', 'GIF89a export with 960x540 frames and nontrivial size',
            '320px responsive layout',
        ],
    }))
    await context.close()
} finally {
    await browser?.close()
    await new Promise((resolveClose) => server.close(resolveClose))
}
