/**
 * Vizmatic — Auto-Crop
 *
 * Detects the content bounding box in a rendered illustration
 * and returns the crop region needed to trim blank space.
 *
 * Works by scanning the raw RGBA pixel buffer from resvg to find
 * rows/columns that differ from the background color.
 */

export interface CropRegion {
    /** Left edge of content (px from left, in source pixel space) */
    x: number
    /** Top edge of content (px from top, in source pixel space) */
    y: number
    /** Width of the content region */
    width: number
    /** Height of the content region */
    height: number
}

/**
 * Detect background color from top-left corner pixel.
 *
 * Transparent canvases are tracked separately so opaque black content is not
 * mistaken for a transparent background.
 */
export function detectBackgroundColor(pixels: Uint8Array): string {
    const r = pixels[0]
    const g = pixels[1]
    const b = pixels[2]
    const a = pixels[3]

    if (a < 10) {
        return 'transparent'
    }

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Parse a hex color string (#RRGGBB) into [R, G, B].
 */
function parseHexColor(hex: string): [number, number, number] {
    const h = hex.startsWith('#') ? hex.slice(1) : hex
    return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
    ]
}

/**
 * Check if a pixel (RGBA) matches the background color within a tolerance.
 * This accounts for anti-aliasing and sub-pixel rendering.
 */
function createBackgroundMatcher(bgColor: string, tolerance: number = 6) {
    if (bgColor === 'transparent') {
        return (_r: number, _g: number, _b: number, a: number) => a < 10
    }

    const [bgR, bgG, bgB] = parseHexColor(bgColor)

    return (r: number, g: number, b: number, a: number): boolean => {
        if (a < 10) return true

        return (
            Math.abs(r - bgR) <= tolerance &&
            Math.abs(g - bgG) <= tolerance &&
            Math.abs(b - bgB) <= tolerance
        )
    }
}

/**
 * Detect the bounding box of non-background content in an RGBA pixel buffer.
 *
 * @param pixels  - Raw RGBA pixel data (Uint8Array, 4 bytes per pixel)
 * @param width   - Image width in pixels
 * @param height  - Image height in pixels
 * @param bgColor - Background color as hex string (e.g., '#0f1117')
 * @param padding - Extra padding to add around the detected content
 * @returns CropRegion with the content bounding box (including padding)
 */
export function detectContentBounds(
    pixels: Uint8Array,
    width: number,
    height: number,
    bgColor: string,
    padding: number = 20,
): CropRegion {
    const isBackground = createBackgroundMatcher(bgColor)

    let minX = width
    let minY = height
    let maxX = 0
    let maxY = 0

    // Scan all pixels to find the content bounding box
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4
            const r = pixels[idx]
            const g = pixels[idx + 1]
            const b = pixels[idx + 2]
            const a = pixels[idx + 3]

            if (!isBackground(r, g, b, a)) {
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
    }

    // No content found — return the full image
    if (minX > maxX || minY > maxY) {
        return { x: 0, y: 0, width, height }
    }

    // Add padding and clamp to image bounds
    const cropX = Math.max(0, minX - padding)
    const cropY = Math.max(0, minY - padding)
    const cropRight = Math.min(width, maxX + 1 + padding)
    const cropBottom = Math.min(height, maxY + 1 + padding)

    return {
        x: cropX,
        y: cropY,
        width: cropRight - cropX,
        height: cropBottom - cropY,
    }
}

/**
 * Crop an RGBA pixel buffer to a given region.
 *
 * @param pixels - Source RGBA pixel data
 * @param srcWidth - Source image width
 * @param region - Region to crop to
 * @returns New RGBA pixel buffer with just the cropped region
 */
export function cropPixels(
    pixels: Uint8Array,
    srcWidth: number,
    region: CropRegion,
): Uint8Array {
    const out = new Uint8Array(region.width * region.height * 4)

    for (let y = 0; y < region.height; y++) {
        const srcOffset = ((region.y + y) * srcWidth + region.x) * 4
        const dstOffset = y * region.width * 4
        out.set(
            pixels.subarray(srcOffset, srcOffset + region.width * 4),
            dstOffset,
        )
    }

    return out
}

// ─── Overflow Detection ──────────────────────────────────────────────────────

export interface OverflowResult {
    /** True if content is likely being clipped by the canvas */
    overflows: boolean
    /** Which edges have content touching them */
    edges: {
        top: boolean
        right: boolean
        bottom: boolean
        left: boolean
    }
    /** Human-readable description of the overflow */
    message: string
}

/**
 * Detect if illustration content overflows the canvas.
 *
 * Content that touches the very edge of the canvas (within `edgeTolerance` px)
 * likely extends beyond it and is being clipped. This function scans the edge
 * rows/columns for non-background pixels.
 *
 * To avoid false positives from decorative elements that intentionally touch
 * the border (e.g. full-width bars), we require at least `minDensity` % of
 * the edge to contain content pixels.
 *
 * @param pixels       - Raw RGBA pixel data
 * @param width        - Image width in pixels
 * @param height       - Image height in pixels
 * @param bgColor      - Background color as hex string
 * @param edgeTolerance - Number of pixels from the edge to check (default 3)
 * @param minDensity   - Minimum fraction of edge with content to flag (default 0.05)
 */
export function detectOverflow(
    pixels: Uint8Array,
    width: number,
    height: number,
    bgColor: string,
    edgeTolerance: number = 3,
    minDensity: number = 0.05,
    alphaThreshold: number = 128,
): OverflowResult {
    const isBackground = createBackgroundMatcher(bgColor)

    function isContentPixel(x: number, y: number): boolean {
        const idx = (y * width + x) * 4
        const a = pixels[idx + 3]
        // Ignore semi-transparent pixels (shadows, anti-aliasing) at edges.
        // Only substantially opaque pixels (alpha >= threshold) count as content.
        if (a < alphaThreshold) return false
        return !isBackground(pixels[idx], pixels[idx + 1], pixels[idx + 2], a)
    }

    function checkEdge(
        scanFn: (i: number, offset: number) => [number, number],
        length: number,
    ): boolean {
        // For each offset row/col within tolerance, count content pixels
        for (let offset = 0; offset < edgeTolerance; offset++) {
            let contentCount = 0
            for (let i = 0; i < length; i++) {
                const [x, y] = scanFn(i, offset)
                if (x >= 0 && x < width && y >= 0 && y < height && isContentPixel(x, y)) {
                    contentCount++
                }
            }
            if (contentCount / length >= minDensity) {
                return true
            }
        }
        return false
    }

    const bottom = checkEdge((i, off) => [i, height - 1 - off], width)
    const right = checkEdge((i, off) => [width - 1 - off, i], height)
    const top = checkEdge((i, off) => [i, off], width)
    const left = checkEdge((i, off) => [off, i], height)

    const overflowEdges: string[] = []
    if (top) overflowEdges.push('top')
    if (right) overflowEdges.push('right')
    if (bottom) overflowEdges.push('bottom')
    if (left) overflowEdges.push('left')

    const overflows = overflowEdges.length > 0
    const message = overflows
        ? `Content overflows canvas at: ${overflowEdges.join(', ')}. Increase the illustration dimensions.`
        : ''

    return {
        overflows,
        edges: { top, right, bottom, left },
        message,
    }
}
