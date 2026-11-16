import { readFile } from 'node:fs/promises'
import { decode } from 'fast-png'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'

interface PreviewElement extends HTMLElement {
    complete(): void
    fail(): void
    controller: { isPlaying: boolean }
}

// Control first-frame readiness independently of module loading and compilation time.
const stage = `
customElements.define('vz-film', class extends HTMLElement {
    controller = { isPlaying: false, play() { this.isPlaying = true }, pause() { this.isPlaying = false } }
    connectedCallback() {
        this.attachShadow({ mode: 'open' }).innerHTML = '<canvas width="320" height="180" style="width:100%;height:100%"></canvas>'
    }
    complete() {
        const canvas = this.shadowRoot.querySelector('canvas')
        const context = canvas.getContext('2d')
        context.fillStyle = '#2878d0'
        context.fillRect(0, 0, canvas.width, canvas.height)
        if (this.hasAttribute('autoplay')) this.controller.play()
        this.dispatchEvent(new CustomEvent('ready', { detail: { player: this.controller } }))
    }
    fail() { this.dispatchEvent(new CustomEvent('error')) }
    disconnectedCallback() { this.controller.pause() }
})
`

async function openWall(page: Page, failStage = false) {
    const [script, css] = await Promise.all([
        readFile('docs/site.js', 'utf8'), readFile('docs/style.css', 'utf8'),
    ])
    const items = Array.from({ length: 30 }, (_, i) => `<a class="wall-item" data-topic="${i ? 'Other' : 'Physics'}" href="#film-${i}">
        <span class="wall-frame" data-live-src="film-${i}.js" data-poster-time="3"><img src="poster.svg" alt="" width="320" height="180"></span>
        <span>Film ${i}</span></a>`).join('')
    await page.route('http://preview.test/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/site.js') await route.fulfill({ contentType: 'text/javascript', body: script })
        else if (path === '/style.css') await route.fulfill({ contentType: 'text/css', body: css })
        else if (path === '/assets/stage/stage.js') {
            if (failStage) await route.abort()
            else await route.fulfill({ contentType: 'text/javascript', body: stage })
        } else if (path === '/poster.svg') await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="#26a269" d="M0 0h320v180H0z"/></svg>' })
        else if (path === '/') await route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-site-theme="dark"><head>
            <link rel="stylesheet" href="style.css"><style>.wall { display:block } .wall-item { width:320px; margin:20px }</style>
            <script type="module" src="site.js"></script></head><body>
            <button id="outside">Outside</button><section><div data-film-filters><div class="filter-pills"></div></div>
            <div class="wall">${items}</div></section></body></html>` })
        else await route.fulfill({ status: 204 })
    })
    await page.goto('http://preview.test/')
    await page.waitForFunction(() => document.documentElement.classList.contains('js'))
}

async function centerPixel(page: Page) {
    const png = decode(await page.locator('.wall-frame').first().screenshot())
    const offset = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2)) * png.channels
    return Array.from(png.data.slice(offset, offset + 3))
}

async function posterOpacity(page: Page) {
    return page.locator('.wall-frame img').first().evaluate(image => Number(getComputedStyle(image).opacity))
}

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('hands film previews to the first frame and back without exposing a blank host', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, colorScheme: 'dark' })
        await openWall(page)
        const card = page.locator('.wall-item').first()
        const preview = card.locator('vz-film')
        const poster = [38, 162, 105]
        await card.hover()
        await page.waitForFunction(() => customElements.get('vz-film'))
        expect.soft(await centerPixel(page), 'the poster covers the opaque host while its first frame loads').toEqual(poster)
        await preview.evaluate(film => (film as PreviewElement).complete())
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.wall-frame img')!).opacity === '0')
        expect.soft(await centerPixel(page), 'ready reveals the painted frame').toEqual([40, 120, 208])

        const playing = await preview.elementHandle()
        await card.focus()
        await page.mouse.move(790, 590)
        expect(await playing!.evaluate(film => film.isConnected), 'pointer exit retains the keyboard-focused player').toBe(true)
        await card.hover()
        await page.locator('#outside').focus()
        expect(await playing!.evaluate(film => film.isConnected), 'focus exit retains the hovered player').toBe(true)
        const exit = await card.evaluate(item => {
            item.dispatchEvent(new PointerEvent('pointerleave'))
            return { opacity: getComputedStyle(item.querySelector('img')!).opacity, players: item.querySelectorAll('vz-film').length }
        })
        expect.soft(exit, 'exit restores the poster in the same task that removes the canvas').toEqual({ opacity: '1', players: 0 })
        expect.soft(await centerPixel(page)).toEqual(poster)

        await card.dispatchEvent('pointerenter')
        const abandoned = await preview.elementHandle()
        await card.dispatchEvent('pointerleave')
        await card.dispatchEvent('pointerenter')
        await abandoned!.evaluate(film => (film as PreviewElement).complete())
        expect.soft(await posterOpacity(page), 'a detached load cannot hide the replacement poster').toBe(1)
        await preview.evaluate(film => (film as PreviewElement).fail())
        expect.soft(await posterOpacity(page), 'failed loads keep the poster').toBe(1)
        expect.soft(await preview.count(), 'failed players are disposed').toBe(0)

        await card.dispatchEvent('pointerleave')
        await card.dispatchEvent('pointerenter')
        const oldTheme = await preview.elementHandle()
        await page.evaluate(() => {
            document.documentElement.dataset.siteTheme = 'light'
            document.dispatchEvent(new CustomEvent('vizmatic-site-theme'))
        })
        await oldTheme!.evaluate(film => (film as PreviewElement).complete())
        expect.soft(await posterOpacity(page), 'a superseded theme load cannot reveal the old frame').toBe(1)
        expect.soft(await preview.getAttribute('look')).toBe('paper')
        await preview.evaluate(film => (film as PreviewElement).complete())
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.wall-frame img')!).opacity === '0')
        expect.soft(await centerPixel(page)).toEqual([40, 120, 208])

        await page.locator('[data-film-topic="Other"]').evaluate(button => (button as HTMLButtonElement).click())
        expect.soft(await preview.count(), 'filtering disposes hidden previews').toBe(0)
        expect.soft(await posterOpacity(page)).toBe(1)
        await page.locator('[data-film-topic="all"]').evaluate(button => (button as HTMLButtonElement).click())
        await card.dispatchEvent('pointerenter')
        expect.soft(await preview.count(), 'a filtered card can be previewed again').toBe(1)
        await card.dispatchEvent('pointerleave')

        const retained = await page.locator('.wall-item').evaluateAll(items => {
            for (const item of items) {
                item.dispatchEvent(new PointerEvent('pointerenter'))
                item.dispatchEvent(new PointerEvent('pointerleave'))
            }
            return document.querySelectorAll('.wall-frame vz-film').length
        })
        expect.soft(retained, 'visiting the gallery does not retain thirty live players').toBe(0)
    } finally {
        await browser.close()
    }
}, 30_000)

it.runIf(process.env.VIZMATIC_BROWSER_TESTS === '1')('keeps the poster when the preview engine cannot load', async () => {
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        await openWall(page, true)
        await page.locator('.wall-item').first().hover()
        expect(await centerPixel(page)).toEqual([38, 162, 105])
        await expect.poll(() => page.locator('vz-film').count()).toBe(0)
    } finally {
        await browser.close()
    }
})
