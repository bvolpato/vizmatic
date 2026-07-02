/**
 * Vizmatic — Core Renderer
 *
 * Converts JSX elements to PNG images using Satori + Resvg.
 * This is the engine that powers all illustration generation.
 * Can apply an optional brand mark without making branding part of
 * the illustration source.
 *
 * Auto-crop: Renders once to detect content bounds, then re-renders at
 * tighter dimensions so illustrations fill the frame with no wasted space.
 * The brand is applied AFTER cropping so it's always positioned correctly.
 */

import satori, { type Font } from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { homedir } from 'os'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import type { ReactNode } from 'react'
import { wrapWithBrand } from './brand'
import { detectBackgroundColor, detectContentBounds, detectOverflow } from './autocrop'

// ─── Font Loading ────────────────────────────────────────────────────────────

interface FontData {
    name: string
    data: ArrayBuffer
    weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
    style: 'normal' | 'italic'
}

const FONT_DIR = process.env.VIZMATIC_FONT_DIR
    ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'vizmatic', 'fonts')

/**
 * Google Fonts gstatic CDN — TTF files for text rendering.
 * All fonts are auto-downloaded on first run and cached in the fonts/ directory.
 *
 * Font chain:
 * 1. Inter (Regular/SemiBold/Bold) — primary text font
 * 2. JetBrains Mono — monospace/code
 * 3. Noto Sans (544KB) — Phonetic Extensions: ᵀ (U+1D40), ᵢ (U+1D62), etc.
 * 4. Noto Sans Math (766KB) — Math operators: √, ≫, ∞, ≠, ×, arrows: →, ←
 */
const FONT_URLS = {
    interRegular: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf',
    interSemiBold: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf',
    interBold: 'https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf',
    jetbrainsMono: 'https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbY2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKxjPQ.ttf',
    // Noto Sans (544KB from gstatic): fallback for Phonetic Extensions
    // (ᵀ U+1D40, ᵢ U+1D62) and extended Latin/Greek not covered by Inter.
    notoSans: 'https://fonts.gstatic.com/s/notosans/v42/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjcz6L1SoM-jCpoiyD9A99d.ttf',
    // Noto Sans Math (766KB from gstatic): math operators (√, ∞, ≠, ×, ≫),
    // Greek letters (τ, Σ), and arrows (→, ←)
    notoSansMath: 'https://fonts.gstatic.com/s/notosansmath/v18/7Aump_cpkSecTWaHRlH2hyV5UHkG.ttf',
} as const

async function ensureFont(filename: string, url: string): Promise<Buffer> {
    const localPath = join(FONT_DIR, filename)
    if (existsSync(localPath)) {
        return readFile(localPath)
    }

    console.log(`  ↓ Downloading font: ${filename}`)
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`Failed to download font ${filename}: ${response.statusText}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await mkdir(FONT_DIR, { recursive: true })
    await writeFile(localPath, buffer)
    return buffer
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

async function loadFonts(): Promise<FontData[]> {
    await mkdir(FONT_DIR, { recursive: true })

    const fonts: FontData[] = []

    try {
        const [regular, semiBold, bold] = await Promise.all([
            ensureFont('Inter-Regular.ttf', FONT_URLS.interRegular),
            ensureFont('Inter-SemiBold.ttf', FONT_URLS.interSemiBold),
            ensureFont('Inter-Bold.ttf', FONT_URLS.interBold),
        ])

        fonts.push(
            { name: 'Inter', data: toArrayBuffer(regular), weight: 400, style: 'normal' },
            { name: 'Inter', data: toArrayBuffer(semiBold), weight: 600, style: 'normal' },
            { name: 'Inter', data: toArrayBuffer(bold), weight: 700, style: 'normal' },
        )
    } catch (e) {
        console.warn('Warning: Could not load Inter font:', e)
    }

    try {
        const jetbrains = await ensureFont('JetBrainsMono-Regular.ttf', FONT_URLS.jetbrainsMono)
        fonts.push({ name: 'JetBrains Mono', data: toArrayBuffer(jetbrains), weight: 400, style: 'normal' })
    } catch (e) {
        console.warn('Warning: Could not load JetBrains Mono font:', e)
    }

    // Noto Sans: fallback for Phonetic Extensions (ᵀ U+1D40, ᵢ U+1D62)
    // and extended Latin/Greek not covered by the gstatic Inter subset.
    //
    // IMPORTANT: Each fallback font must have a DISTINCT name. Satori ignores
    // duplicate (name, weight, style) entries but automatically searches all
    // registered font names when the primary font is missing a glyph.
    try {
        const notoSans = await ensureFont('NotoSans-Regular.ttf', FONT_URLS.notoSans)
        fonts.push(
            { name: 'Noto Sans', data: toArrayBuffer(notoSans), weight: 400, style: 'normal' },
        )
    } catch (e) {
        console.warn('Warning: Could not load Noto Sans font:', e)
    }

    // Noto Sans Math: fallback for mathematical operators (√, ∞, ≠, ×, ≫),
    // Greek letters (τ, Σ), and arrows (→, ←)
    try {
        const notoMath = await ensureFont('NotoSansMath-Regular.ttf', FONT_URLS.notoSansMath)
        fonts.push(
            { name: 'Noto Sans Math', data: toArrayBuffer(notoMath), weight: 400, style: 'normal' },
        )
    } catch (e) {
        console.warn('Warning: Could not load Noto Sans Math font:', e)
    }

    return fonts
}

// ─── Emoji Support ───────────────────────────────────────────────────────────

/**
 * Resolve emoji characters to Twemoji SVG images via jsDelivr CDN.
 * SVGs are cached locally in the fonts directory to avoid repeated downloads.
 * Satori calls this when it encounters an emoji grapheme.
 */
const EMOJI_CACHE_DIR = join(FONT_DIR, 'emoji')

async function loadEmoji(segment: string): Promise<string> {
    // Convert emoji to Twemoji-style codepoint filename (e.g. 1f4a1 or 1f3af)
    const codepoints = [...segment]
        .map(c => c.codePointAt(0)!.toString(16))
        .filter(cp => cp !== 'fe0f')  // Remove variation selector
        .join('-')

    const filename = `${codepoints}.svg`
    const localPath = join(EMOJI_CACHE_DIR, filename)

    // Return cached SVG if available
    if (existsSync(localPath)) {
        const svgData = await readFile(localPath, 'utf8')
        return `data:image/svg+xml;base64,${Buffer.from(svgData).toString('base64')}`
    }

    // Download from Twemoji CDN via jsDelivr
    const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codepoints}.svg`
    try {
        console.log(`  ↓ Downloading emoji: ${filename}`)
        const response = await fetch(url)
        if (!response.ok) {
            console.warn(`Warning: Could not download emoji ${filename}: ${response.statusText}`)
            return ''
        }
        const svgData = await response.text()
        await mkdir(EMOJI_CACHE_DIR, { recursive: true })
        await writeFile(localPath, svgData)
        return `data:image/svg+xml;base64,${Buffer.from(svgData).toString('base64')}`
    } catch (e) {
        console.warn(`Warning: Could not fetch emoji ${filename}:`, e)
        return ''
    }
}

/**
 * Satori `loadAdditionalAsset` callback.
 * Called when a glyph is missing from configured fonts.
 * For emoji segments, returns a Twemoji SVG data URI.
 */
export async function loadAdditionalAsset(code: string, segment: string): Promise<string | Font[]> {
    if (code === 'emoji') {
        return loadEmoji(segment)
    }
    return []
}

// ─── Cached fonts ────────────────────────────────────────────────────────────

let cachedFonts: FontData[] | null = null

export async function getFonts(): Promise<FontData[]> {
    if (!cachedFonts) {
        cachedFonts = await loadFonts()
    }
    return cachedFonts
}

// ─── SVG Sanitization ────────────────────────────────────────────────────────

/**
 * Sanitize SVG output from Satori to prevent resvg crashes.
 * Satori sometimes generates zero-dimension rects (e.g., from flexGrow
 * collapsing) that cause resvg to panic. Replace 0-dimension with 1px.
 */
function sanitizeSvg(svg: string): string {
    return svg
        .replace(/width="0"/g, 'width="1"')
        .replace(/height="0"/g, 'height="1"')
}

// ─── Auto-Crop Render ────────────────────────────────────────────────────────

/**
 * Minimum padding around content (in source pixels, before 2x scaling).
 * This ensures illustrations don't feel claustrophobic after cropping.
 */
const AUTOCROP_PADDING = 24

/**
 * Minimum width for cropped illustrations to maintain readability.
 */


/**
 * If the crop saves less than this percentage of area, skip it.
 * Prevents unnecessary re-rendering for images that are already well-fitted.
 */
const CROP_THRESHOLD_PERCENT = 10

// ─── Core Render Function ────────────────────────────────────────────────────

export interface RenderOptions {
    width: number
    height: number
    /** Output path for the PNG file */
    outputPath: string
    /** Optional bottom-right brand mark. Use true for "Vizmatic", string for a custom label. */
    brand?: boolean | string
    /** Disable height autocrop for fixed-size frames. */
    crop?: boolean
    /** Retina output scale. */
    scale?: number
}

/**
 * Render a JSX element to a PNG file, with auto-crop and optional brand.
 *
 * Pipeline:
 * 1. Render WITHOUT brand at declared dimensions
 * 2. Detect content bounding box (scan pixels for non-background)
 * 3. If significant blank space detected, re-render at tighter dimensions
 * 4. Apply brand to final render unless disabled
 * 5. Write PNG to disk
 *
 * @param element - React JSX element (must be pure, no hooks/state)
 * @param options - Width, height, and output path
 * @param createFn - Optional create(theme) function for themed re-rendering
 * @param theme - Theme mode for re-rendering (if createFn provided)
 */
export async function renderToPng(
    element: ReactNode,
    options: RenderOptions,
    createFn?: (theme: 'dark' | 'light') => ReactNode,
    theme?: 'dark' | 'light',
): Promise<void> {
    const fonts = await getFonts()

    // Step 1: Render WITHOUT brand to detect content bounds
    let svg = await satori(element as React.ReactElement, {
        width: options.width,
        height: options.height,
        fonts,
        loadAdditionalAsset,
    })
    svg = sanitizeSvg(svg)

    // Render at 1x for content detection (faster than 2x)
    const detectResvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: options.width },
        background: 'rgba(0, 0, 0, 0)',
    })
    const detectResult = detectResvg.render()
    const detectPixels = detectResult.pixels

    // Step 2: Detect content bounds using alpha-based background detection
    // With transparent backgrounds, we rely on the autocrop's alpha check (a < 10)
    const pixelData = new Uint8Array(detectPixels.buffer)
    const detectedBg = detectBackgroundColor(pixelData)
    const bounds = detectContentBounds(
        pixelData,
        options.width,
        detectResult.height,
        detectedBg,
        AUTOCROP_PADDING,
    )

    // Step 2b: Check for content overflow (clipping)

    const overflow = detectOverflow(
        pixelData,
        options.width,
        detectResult.height,
        detectedBg,
    )
    if (overflow.overflows) {
        throw new Error(
            `Canvas overflow detected (${options.width}×${options.height}): ${overflow.message}`
        )
    }

    // Step 3: Determine if we should crop height only.
    // We never shrink the width because Satori flex layouts are responsive —
    // a narrower canvas causes text to wrap and bars to shrink, which makes
    // content taller and can overflow the cropped height.  Keeping the
    // original width avoids layout reflow entirely.
    const finalWidth = options.width
    let finalHeight = options.height
    let finalElement: ReactNode = element

    const heightSaved = options.height - bounds.height
    const heightSavedPercent = (heightSaved / options.height) * 100

    if (options.crop !== false && heightSavedPercent >= CROP_THRESHOLD_PERCENT) {
        // Significant vertical blank space: crop height only.
        finalHeight = bounds.height

        // Re-create the illustration element if possible (for responsive resize)
        // The illustration's CSS uses width/height: 100% so it adapts automatically
        if (createFn && theme) {
            finalElement = createFn(theme)
        }
    }

    // Step 4: Final render with optional brand at the cropped dimensions
    const outputElement = options.brand
        ? wrapWithBrand(
            finalElement,
            finalWidth,
            finalHeight,
            (theme as 'dark' | 'light') || 'dark',
            typeof options.brand === 'string' ? options.brand : 'Vizmatic',
        )
        : finalElement

    let finalSvg = await satori(outputElement as React.ReactElement, {
        width: finalWidth,
        height: finalHeight,
        fonts,
        loadAdditionalAsset,
    })
    finalSvg = sanitizeSvg(finalSvg)

    // Step 5: SVG → PNG at 2x for retina (with transparent background)
    const resvg = new Resvg(finalSvg, {
        fitTo: {
            mode: 'width',
            value: finalWidth * (options.scale ?? 2),
        },
        background: 'rgba(0, 0, 0, 0)',
    })

    const pngData = resvg.render()
    const pngBuffer = pngData.asPng()

    // Step 6: Write to disk
    await mkdir(dirname(options.outputPath), { recursive: true })
    await writeFile(options.outputPath, pngBuffer)
}

/**
 * Render a JSX element to a PNG buffer (useful for testing).
 */
export async function renderToBuffer(
    element: ReactNode,
    width: number,
    height: number,
    options: Pick<RenderOptions, 'brand' | 'scale'> = {},
): Promise<Buffer> {
    const fonts = await getFonts()

    const outputElement = options.brand
        ? wrapWithBrand(
            element,
            width,
            height,
            'dark',
            typeof options.brand === 'string' ? options.brand : 'Vizmatic',
        )
        : element

    let svg = await satori(outputElement as React.ReactElement, {
        width,
        height,
        fonts,
        loadAdditionalAsset,
    })

    svg = sanitizeSvg(svg)

    const resvg = new Resvg(svg, {
        fitTo: { mode: 'width', value: width * (options.scale ?? 2) },
    })

    const pngData = resvg.render()
    return Buffer.from(pngData.asPng())
}

/**
 * Render a JSX element to SVG markup without rasterization.
 */
export async function renderToSvg(
    element: ReactNode,
    width: number,
    height: number,
    options: Pick<RenderOptions, 'brand'> = {},
): Promise<string> {
    const fonts = await getFonts()
    const outputElement = options.brand
        ? wrapWithBrand(
            element,
            width,
            height,
            'dark',
            typeof options.brand === 'string' ? options.brand : 'Vizmatic',
        )
        : element

    const svg = await satori(outputElement as React.ReactElement, {
        width,
        height,
        fonts,
        loadAdditionalAsset,
    })

    return sanitizeSvg(svg)
}
