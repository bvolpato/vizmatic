#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { chromium } from 'playwright'

const docsRoot = resolve('docs')
const playgroundPath = join(docsRoot, 'playground.html')
const configuredURL = process.env.VIZMATIC_PLAYGROUND_URL
let pageURL
let origin

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

if (configuredURL) {
    const target = new URL(configuredURL)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('VIZMATIC_PLAYGROUND_URL must use HTTP or HTTPS.')
    pageURL = target.href
    origin = target.origin
} else {
    await access(playgroundPath).catch(() => { throw new Error('Build docs/playground.html first with `pnpm site:build`.') })
    await new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start the local docs server.')
    origin = `http://127.0.0.1:${address.port}`
    pageURL = `${origin}/playground.html`
}

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
    await context.addInitScript(() => {
        const nativeClipboard = navigator.clipboard
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: () => nativeClipboard.readText(),
                writeText: async () => { throw new Error('Clipboard API denied by the browser.') },
            },
        })
    })
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))

    const source = (target = page) => target.locator('#playgroundSource').inputValue()
    const downloadedBytes = async (button) => {
        const downloadStarted = page.waitForEvent('download', { timeout: 120_000 })
        await button.click()
        const download = await downloadStarted
        const path = await download.path()
        assert.ok(path, `${download.suggestedFilename()} should be saved.`)
        return readFile(path)
    }
    const ready = async (target = page) => {
        await target.waitForTimeout(400)
        await target.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('#playgroundStatus')?.dataset.state ?? ''), undefined, { timeout: 45_000 })
        const error = target.locator('#playgroundError')
        assert.equal(await target.locator('#playgroundStatus').getAttribute('data-state'), 'ready', await error.textContent())
        assert.equal(await error.isVisible(), false, await error.textContent())
        await target.waitForFunction(() => {
            const image = document.querySelector('#playgroundCanvas img')
            return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
        }, undefined, { timeout: 10_000 })
    }
    const renderedImageHash = async (target = page) => target.locator('#playgroundCanvas img').evaluate(async (image) => {
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not inspect the rendered preview pixels.')
        context.drawImage(image, 0, 0)
        const digest = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data)
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    })
    const selectInstance = async (name, pageTarget = page) => {
        const value = await pageTarget.locator('#explorerInstance').evaluate((select, target) => {
            const option = [...select.options].find((entry) => entry.textContent?.trim().startsWith(target))
            return option?.value
        }, name)
        assert.notEqual(value, undefined, `No scene instance named ${name} was available.`)
        await pageTarget.locator('#explorerInstance').selectOption(value)
    }
    const setSetting = async (selector, value) => {
        const control = page.locator(selector)
        if (await control.evaluate((element) => element.tagName === 'SELECT')) await control.selectOption(String(value))
        else {
            await control.fill(String(value))
            await control.press('Tab')
        }
        await ready()
    }
    const setField = async (locator, value) => {
        await locator.fill(String(value))
        await locator.press('Tab')
        await ready()
    }
    const undoTo = async (expected, description) => {
        await page.locator('#playgroundUndoButton').click()
        await ready()
        assert.equal(await source(), expected, description)
    }
    const drag = async (handle, dx, dy) => {
        const box = await handle.boundingBox()
        assert.ok(box, 'Canvas handle should be visible.')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 })
        await page.mouse.up()
    }

    await page.goto(pageURL)
    await ready()
    await page.locator('#playgroundNewCanvas').click()
    await ready()
    const initialCanvas = await source()
    assert.match(initialCanvas, /<Board\b/)
    assert.equal(await page.locator('.playground-canvas-item').count(), 3, 'The starter canvas should expose all three movable items.')

    await selectInstance('Board')
    const boardWidth = page.locator('[data-control-prop="width"]')
    assert.equal(await boardWidth.inputValue(), '1100', 'The root Board inspector should read the canvas frame width.')
    await setField(boardWidth, '1120')
    const inspectorWidthSource = await source()
    assert.match(inspectorWidthSource, /^width\s*=\s*1120$/m)
    assert.match(inspectorWidthSource, /<Board\s+width=\{1120\}/)
    assert.equal(await page.locator('#playgroundCanvasWidth').inputValue(), '1120', 'Editing a root Board dimension should keep frame settings synchronized.')
    await undoTo(initialCanvas, 'A root Board dimension edit should update source and frame metadata as one undo step.')

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
    await page.locator('.explorer-canvas-settings').evaluate((details) => { details.open = true })

    const beforeWidth = await source()
    await setSetting('#playgroundCanvasWidth', '1180')
    const widthSource = await source()
    assert.match(widthSource, /^width\s*=\s*1180$/m)
    assert.match(widthSource, /<Board\s+width=\{1180\}/)
    await undoTo(beforeWidth, 'Canvas width should be undoable as one source change.')

    const beforeHeight = await source()
    await setSetting('#playgroundCanvasHeight', '760')
    const heightSource = await source()
    assert.match(heightSource, /^height\s*=\s*760$/m)
    assert.match(heightSource, /<Board\s+width=\{1100\}\s+height=\{760\}/)
    await undoTo(beforeHeight, 'Canvas height should be undoable as one source change.')

    const beforePreset = await source()
    await setSetting('#playgroundCanvasPreset', 'engineering')
    const presetSource = await source()
    assert.match(presetSource, /^preset\s*=\s*["']engineering["']$/m)
    await undoTo(beforePreset, 'Theme preset should be undoable as one source change.')

    await page.locator('#playgroundPaletteToken').selectOption('primary')
    const beforePalette = await source()
    await setSetting('#playgroundPaletteValue', '#0f766e')
    const paletteValueSource = await source()
    assert.match(paletteValueSource, /themeColors\s*=\s*.*"primary"\s*:\s*"#0f766e"/)
    assert.equal(await page.locator('#playgroundPaletteColor').inputValue(), '#0f766e', 'The color picker should follow the editable CSS color value.')
    await undoTo(beforePalette, 'Palette value edits should update the source history.')

    await setSetting('#playgroundPaletteValue', '#0f766e')
    const beforePaletteTokenReset = await source()
    const resetToken = page.locator('#playgroundPaletteResetToken')
    assert.equal(await resetToken.isEnabled(), true, 'A customized palette token should be individually resettable.')
    await resetToken.click()
    await ready()
    assert.doesNotMatch(await source(), /"primary"\s*:\s*"#0f766e"/, 'Resetting one token should remove its custom value.')
    await undoTo(beforePaletteTokenReset, 'A single-token palette reset should be undoable.')

    const beforePaletteColor = await source()
    await setSetting('#playgroundPaletteColor', '#be123c')
    const paletteColorSource = await source()
    assert.match(paletteColorSource, /themeColors\s*=\s*.*"primary"\s*:\s*"#be123c"/)
    assert.equal(await page.locator('#playgroundPaletteValue').inputValue(), '#be123c', 'The editable CSS color value should follow the color picker.')
    await page.locator('#playgroundPaletteReset').click()
    await ready()
    assert.notEqual(await source(), paletteColorSource, 'Reset should clear custom palette metadata.')
    await undoTo(paletteColorSource, 'Palette reset should be undoable.')
    await undoTo(beforePaletteColor, 'Palette color edits should be undoable.')
    await undoTo(beforePalette, 'The first palette edit should return to the original source.')

    const beforeBackground = await source()
    await page.locator('#explorerBackground').selectOption('theme')
    await ready()
    const themeBackgroundSource = await source()
    assert.match(themeBackgroundSource, /^background\s*=\s*["']theme["']$/m)
    await undoTo(beforeBackground, 'Canvas fill selection should be undoable.')

    await page.locator('#explorerBackground').selectOption('custom')
    await ready()
    const defaultCustomBackground = await source()
    assert.match(defaultCustomBackground, /^background\s*=\s*["']#151620["']$/m)
    await setSetting('#playgroundCanvasBackgroundColor', '#102030')
    const customBackgroundSource = await source()
    assert.match(customBackgroundSource, /^background\s*=\s*["']#102030["']$/m)
    await undoTo(defaultCustomBackground, 'Custom canvas color edits should be undoable.')
    await undoTo(beforeBackground, 'Selecting a custom canvas fill should be undoable.')

    await page.locator('[data-playground-theme="light"]').click()
    await ready()
    await setSetting('#playgroundCanvasPreset', 'engineering')
    await page.locator('#playgroundPaletteToken').selectOption('primary')
    await setSetting('#playgroundPaletteValue', '#0f766e')
    await page.locator('#explorerBackground').selectOption('custom')
    await ready()
    await setSetting('#playgroundCanvasBackgroundColor', '#102030')
    const configuredFrame = await source()
    await page.locator('#playgroundShareButton').click()
    await page.waitForFunction(() => location.hash.startsWith('#vizmatic-playground='))
    assert.equal(decodeURIComponent(new URL(page.url()).hash.slice('#vizmatic-playground='.length)), configuredFrame,
        'Share links should preserve the editable frame settings metadata.')
    assert.equal(new URL(page.url()).searchParams.get('theme'), 'light', 'Share links should preserve the light output theme.')
    await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.textContent?.includes('Share link'))
    await page.locator('#playgroundCopyButton').click()
    await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.textContent === 'Source copied.')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), configuredFrame,
        'Copy source should preserve the editable frame settings metadata.')

    const chartHandle = page.locator('.playground-canvas-item .playground-canvas-move').nth(2)
    await drag(chartHandle, 22, 18)
    await ready()
    await selectInstance('BarChart')
    const fullBuilderSource = await source()
    const fullBuilderImage = await renderedImageHash()
    const chartGeometry = fullBuilderSource.match(/<CanvasItem\s+x=\{(\d+)\}\s+y=\{(\d+)\}\s+width=\{(\d+)\}\s+height=\{(\d+)\}>\s*<BarChart\b/)
    assert.ok(chartGeometry, 'The edited chart should remain inside its positioned canvas item.')
    const copyBlock = page.locator('#explorerCopyBlock')
    assert.equal(await copyBlock.isEnabled(), true, 'A selected chart should enable Copy block.')
    await copyBlock.click()
    await page.waitForFunction(() => /copied/i.test(document.querySelector('#playgroundStatus')?.textContent ?? ''))
    const copiedBlock = await page.evaluate(() => navigator.clipboard.readText())
    assert.match(copiedBlock, /^width\s*=\s*1100$/m)
    assert.match(copiedBlock, /^height\s*=\s*700$/m)
    assert.match(copiedBlock, /^preset\s*=\s*["']engineering["']$/m)
    assert.match(copiedBlock, /themeColors\s*=\s*.*"primary"\s*:\s*"#0f766e"/)
    assert.match(copiedBlock, /^background\s*=\s*["']#102030["']$/m)
    assert.match(copiedBlock, /<Board\s+width=\{1100\}\s+height=\{700\}/)
    assert.match(copiedBlock, /"label":"Item 4","value":1/)
    const copiedGeometry = copiedBlock.match(/<CanvasItem\s+x=\{(\d+)\}\s+y=\{(\d+)\}\s+width=\{(\d+)\}\s+height=\{(\d+)\}>\s*<BarChart\b/)
    assert.deepEqual(copiedGeometry?.slice(1, 5), chartGeometry.slice(1, 5), 'Copy block should retain the edited chart geometry.')

    await page.locator('#explorerCode').evaluate((details) => { details.open = true })
    await page.locator('#playgroundSource').fill(copiedBlock)
    await page.locator('#playgroundRunButton').click()
    await ready()
    assert.equal(await page.locator('.playground-canvas-item').count(), 1, 'The copied standalone frame should render only the selected chart block.')
    assert.match(await source(), /<BarChart\b/)
    const copiedRender = await renderedImageHash()
    assert.notEqual(copiedRender, fullBuilderImage, 'The copied frame should render only its selected chart rather than the full builder canvas.')

    const canvasFocusHandle = page.locator('.playground-canvas-item .playground-canvas-move').first()
    await canvasFocusHandle.focus()
    await canvasFocusHandle.press('Control+C')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), copiedBlock,
        'Ctrl+C on a focused canvas selection handle should copy the selected block.')

    const editor = page.locator('#playgroundSource')
    const editorText = await editor.inputValue()
    const selectedText = '<BarChart'
    const selectionStart = editorText.indexOf(selectedText)
    assert.notEqual(selectionStart, -1)
    await editor.evaluate((textarea, selection) => {
        textarea.focus()
        textarea.setSelectionRange(selection.start, selection.end)
    }, { start: selectionStart, end: selectionStart + selectedText.length })
    await editor.press('Control+C')
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selectedText,
        'Ctrl+C in the source editor should copy selected text instead of the canvas block.')

    const chartImages = new Map()
    for (const name of ['BarChart', 'PieChart', 'DonutChart', 'StackedBar', 'LineChart', 'ScatterPlot', 'ParetoBarChart', 'ParetoChart', 'QuadrantChart', 'IntervalPlot']) {
        await page.locator(`#component-${name}`).click()
        await ready()
        assert.match(await source(), new RegExp(`<${name}\\b`), `${name} should load and render from the component chooser.`)
        if (name === 'PieChart') {
            await selectInstance('PieChart')
            const addFooter = page.locator('[data-add-prop="footer"]')
            assert.equal(await addFooter.count(), 1, 'An absent optional footer should be available to add.')
            await addFooter.click()
            await ready()
            assert.match(await source(), /footer=\{""\}/, 'Adding the optional footer should create a literal source prop.')
            await setField(page.locator('[data-control-prop="footer"]'), 'Quarterly report')
            assert.match(await source(), /footer=\{"Quarterly report"\}/, 'The new optional footer should remain editable.')
            await page.locator('[data-remove-prop="footer"]').click()
            await ready()
            assert.doesNotMatch(await source(), /\bfooter\s*=/, 'Removing an optional footer should remove only that prop.')

            const addFormat = page.locator('[data-add-prop="format"]')
            assert.equal(await addFormat.count(), 1, 'A missing chart format should be available to add as a literal.')
            await addFormat.click()
            await ready()
            const format = page.locator('select[data-control-prop="format"]')
            const formatChoices = await format.locator('option').allTextContents()
            for (const choice of ['decimal', 'percent', 'integer', 'compact']) assert.ok(formatChoices.includes(choice), `Chart format ${choice} should be selectable.`)
            await format.selectOption({ label: 'compact' })
            await ready()
            assert.match(await source(), /format=\{"compact"\}/, 'The chart format choice should become a runnable source literal.')
            await page.locator('[data-remove-prop="format"]').click()
            await ready()
            assert.doesNotMatch(await source(), /\bformat\s*=/, 'The optional chart format should be removable.')
        }
        chartImages.set(name, await renderedImageHash())
    }
    assert.equal(new Set(chartImages.values()).size, chartImages.size, 'Each chart format should produce its own rendered preview.')

    await page.locator('#component-Row').click()
    await ready()
    await selectInstance('Row')
    const styleJson = page.locator('textarea[data-data-json="style"]')
    assert.equal(await styleJson.inputValue(), '{}', 'An absent optional React style should initialize as an editable empty object.')
    await styleJson.fill(JSON.stringify({ padding: 8, backgroundColor: '#f5f5f5' }, null, 2))
    await page.locator('[data-data-add="style"]').click()
    await ready()
    assert.match(await source(), /style=\{\{"padding":8,"backgroundColor":"#f5f5f5"\}\}/)
    await styleJson.fill(JSON.stringify({ padding: 12, backgroundColor: '#e0f2fe' }, null, 2))
    await page.locator('[data-apply-data-json="style"]').click()
    await ready()
    assert.match(await source(), /style=\{\{"padding":12,"backgroundColor":"#e0f2fe"\}\}/, 'Valid JSON style edits should update and render the selected component.')
    await page.locator('[data-data-remove="style"]').click()
    await ready()
    assert.doesNotMatch(await source(), /\bstyle\s*=/, 'Removing optional JSON style data should restore the source prop state.')

    await page.locator('#component-GraphDiagram').click()
    await ready()
    await page.locator('#explorerCode').evaluate((details) => { details.open = true })
    const graphSource = await source()
    const graphWithManyProps = graphSource.replace(/<GraphDiagram\b/, `<GraphDiagram
    title="Inspectable graph"
    description="Every literal property remains available."
    direction="LR"
    layout="auto"
    sizing="fixed"
    nodeWidth={140}
    nodeHeight={64}
    labelFontSize={14}
    detailFontSize={11}
    arrowSize={8}
    padding={18}
    nodeGap={34}
    rankGap={72}
    edgeGap={16}
    iconSize={15}`)
    assert.notEqual(graphWithManyProps, graphSource, 'The GraphDiagram example should accept its full literal property schema.')
    await page.locator('#playgroundSource').fill(graphWithManyProps)
    await page.locator('#playgroundRunButton').click()
    await ready()
    await selectInstance('GraphDiagram')
    const graphControls = page.locator('#explorerControls [data-control-prop]')
    assert.ok(await graphControls.count() > 8, 'The inspector should expose more than eight schema-backed literal properties.')
    const edgeGapControl = page.locator('[data-control-prop="edgeGap"]')
    assert.equal(await edgeGapControl.getAttribute('max'), null, 'Schema number editing should not inherit arbitrary display bounds.')
    await setField(edgeGapControl, '220')
    const expandedGraph = await source()
    assert.match(expandedGraph, /edgeGap=\{220\}/, 'Properties after the first eight should remain editable without clamping.')
    await undoTo(graphWithManyProps, 'Graph property edits should be undoable.')
    const routing = page.locator('[data-control-prop="routing"]')
    await routing.selectOption({ label: 'orthogonal' })
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
    await page.locator('.explorer-canvas-settings').evaluate((details) => { details.open = true })
    await setSetting('#playgroundCanvasWidth', '1240')
    await setSetting('#playgroundCanvasHeight', '800')
    await setSetting('#playgroundCanvasPreset', 'engineering')
    await page.locator('#playgroundPaletteToken').selectOption('primary')
    await setSetting('#playgroundPaletteValue', '#0f766e')
    await page.locator('#explorerBackground').selectOption('custom')
    await ready()
    await setSetting('#playgroundCanvasBackgroundColor', '#182838')
    const projectSource = await source()
    const downloadStarted = page.waitForEvent('download')
    await page.locator('#playgroundSaveProject').click()
    const projectDownload = await downloadStarted
    assert.match(projectDownload.suggestedFilename(), /^Release-rehearsal.*\.vizmatic\.json$/)
    const projectFilePath = await projectDownload.path()
    assert.ok(projectFilePath)
    const savedProject = JSON.parse(await readFile(projectFilePath, 'utf8'))
    assert.deepEqual(savedProject, {
        format: 'vizmatic', version: 1, name: 'Release rehearsal', source: projectSource, theme: 'light', background: 'transparent',
    }, 'The project should preserve legacy fallback fields alongside its richer TSX source metadata.')
    assert.match(savedProject.source, /^width\s*=\s*1240$/m)
    assert.match(savedProject.source, /^height\s*=\s*800$/m)
    assert.match(savedProject.source, /^preset\s*=\s*["']engineering["']$/m)
    assert.match(savedProject.source, /themeColors\s*=\s*.*"primary"\s*:\s*"#0f766e"/)
    assert.match(savedProject.source, /^background\s*=\s*["']#182838["']$/m)

    await page.locator('#playgroundNewCanvas').click()
    await ready()
    await page.locator('#playgroundOpenProject').click()
    await page.locator('#playgroundProjectFile').setInputFiles(projectFilePath)
    await ready()
    assert.equal(await source(), projectSource)
    assert.equal(await page.locator('#playgroundProjectName').inputValue(), 'Release rehearsal')
    assert.equal(await page.locator('#explorerBackground').inputValue(), 'custom', 'Source background metadata should take precedence over the legacy project fallback.')
    assert.equal(await page.locator('#playgroundCanvasBackgroundColor').inputValue(), '#182838')
    assert.equal(await page.locator('#playgroundCanvasWidth').inputValue(), '1240')
    assert.equal(await page.locator('#playgroundCanvasHeight').inputValue(), '800')
    assert.equal(await page.locator('#playgroundCanvasPreset').inputValue(), 'engineering')
    assert.equal(await page.locator('#playgroundPaletteValue').inputValue(), '#0f766e')
    assert.equal(await page.locator('[data-playground-theme="light"]').getAttribute('aria-pressed'), 'true')

    await selectInstance('BarChart')
    await ready()
    assert.equal(await page.locator('#explorerCopyBlock').isEnabled(), true, 'A valid selected chart should enable Copy block before syntax-error recovery.')
    const validSource = await source()
    await page.locator('#playgroundSource').fill(`${validSource}\n<`)
    await page.waitForFunction(() => !document.querySelector('#playgroundError')?.hidden, undefined, { timeout: 20_000 })
    assert.equal(await page.locator('#explorerCopyBlock').isEnabled(), false, 'Copy block should be disabled while the source has a syntax error.')
    await page.locator('#playgroundUndoButton').click()
    await ready()
    assert.equal(await source(), validSource, 'Undo should recover from a source syntax error.')
    assert.equal(await page.locator('#explorerCopyBlock').isEnabled(), true, 'Undo should restore the valid chart block copy action.')

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

    const customAnimationSource = (await source()).replace(
        'animationFps = 10\n',
        'animationFps = 10\nthemeColors = {"bg":"rgba(16, 32, 48, 0.5)"}\nbackground = "hsl(210, 50%, 20%)"\n',
    )
    assert.notEqual(customAnimationSource, await source(), 'The animation fixture should expose its settings preamble for CSS color overrides.')
    await page.locator('#playgroundSource').fill(customAnimationSource)
    await page.locator('#playgroundRunButton').click()
    await ready()
    const customColorGif = await downloadedBytes(page.locator('#playgroundGifButton'))
    assert.equal(customColorGif.subarray(0, 6).toString(), 'GIF89a', 'Animated export should accept HSL canvas matte and RGBA theme colors.')
    assert.ok(customColorGif.length > 5_000, `Custom-color GIF export should contain animation data, got ${customColorGif.length} bytes.`)
    assert.notDeepEqual(customColorGif, gifBytes, 'Custom HSL/RGBA animation colors should change the exported GIF pixels.')
    assert.equal(customColorGif.readUInt16LE(6), 960)
    assert.equal(customColorGif.readUInt16LE(8), 540)
    await page.waitForFunction(() => document.querySelector('#playgroundStatus')?.textContent?.includes('GIF exported'), undefined, { timeout: 120_000 })

    await page.setViewportSize({ width: 320, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'The builder should fit a 320px viewport.')
    assert.deepEqual(pageErrors, [], `Unexpected browser errors: ${pageErrors.join('; ')}`)

    console.log(JSON.stringify({
        result: 'PASS',
        checks: [
            'canvas item drag and resize with single-step undo, repeated keyboard move and resize', 'root Board inspector keeps frame metadata synchronized', 'inline text editing', 'chart data row edit and add',
            'canvas dimensions, preset, palette, and background metadata edits with undo', 'share and source copy preserve frame settings',
            'Copy block preserves edited chart data and geometry, renders when pasted, supports clipboard API fallback and focused Ctrl+C without intercepting editor copy',
            'all ten chart chooser examples render distinct image output, with optional chart format literals', 'orthogonal routing control',
            'share link and copied source', 'project save/open with canvas, palette, background, and theme source metadata',
            'syntax error recovery', 'animation scrub changes PNG output', 'GIF89a export with custom HSL matte and RGBA theme color',
            '320px responsive layout',
        ],
    }))
    await context.close()
} finally {
    await browser?.close()
    if (server.listening) await new Promise((resolveClose) => server.close(resolveClose))
}
