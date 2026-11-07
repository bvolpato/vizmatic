import { decode, type DecodedPng } from 'fast-png'
import { Unzlib } from 'fflate'
import { Node, type StageImage } from './node'

/** Encoded bytes and intrinsic dimensions, validated before a film uses them. */
export interface ImageAsset {
    readonly id?: string
    readonly src: string
    readonly mediaType: 'image/png' | 'image/jpeg' | 'image/gif'
    readonly width: number
    readonly height: number
    readonly sha256: string
}

export interface ImageAssetOptions {
    id?: string
    mediaType?: string
    sha256?: string
    /** Resolve a local filename relative to this directory in Node. */
    baseDir?: string
    /** Expected intrinsic dimensions, such as those declared in an asset manifest. */
    width?: number
    height?: number
}

export interface ImageCrop {
    x: number
    y: number
    width: number
    height: number
}

export interface ImageFitOptions {
    width?: number
    height?: number
    fit?: 'contain' | 'cover'
    /** A region in intrinsic image pixels, before fitting the destination box. */
    crop?: ImageCrop
}

export class ImageAssetError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ImageAssetError'
    }
}

const MAX_BYTES = 16 * 1024 * 1024
const MAX_PIXELS = 16 * 1024 * 1024
const PREFIX = 'data:image/png;base64,'
const prepared = new WeakSet<ImageAsset>()
const browserSources = new WeakMap<ImageAsset, CanvasImageSource>()
type Visibility = boolean | { width: number; height: number; mask: Uint8Array; crops: Map<string, boolean> }
const visibility = new WeakMap<ImageAsset, Visibility>()

function fail(message: string): never {
    throw new ImageAssetError(message)
}

function dataUri(bytes: Uint8Array, mediaType = 'image/png'): string {
    const chunks: string[] = []
    for (let at = 0; at < bytes.length; at += 8192) chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
    return `data:${mediaType};base64,` + btoa(chunks.join(''))
}

async function sourceBytes(source: string | Uint8Array, options: ImageAssetOptions): Promise<Uint8Array> {
    if (source instanceof Uint8Array) {
        if (source.byteLength > MAX_BYTES) fail(`Image asset exceeds ${MAX_BYTES} encoded bytes.`)
        return source.slice()
    }
    if (typeof source !== 'string' || !source) fail('Image asset needs encoded bytes, a PNG data URI, or a local filename.')
    if (source.startsWith('data:')) {
        if (!source.startsWith(PREFIX)) fail('Image assets currently support only image/png base64 data URIs.')
        const encoded = source.slice(PREFIX.length)
        if (!encoded.length || encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || encoded.length % 4
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('Image asset contains invalid or oversized base64 data.')
        const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
        if (bytes.length > MAX_BYTES) fail(`Image asset exceeds ${MAX_BYTES} encoded bytes.`)
        return bytes
    }
    if (/^[a-z][\w+.-]*:/i.test(source) || source.startsWith('//')) fail('Image assets must use local files or embedded bytes; remote URLs are not loaded.')
    if (typeof process === 'undefined' || !process.versions?.node) fail('Resolve browser image assets from embedded bytes or a data URI before compiling.')
    const fsModule = 'node:fs/promises', pathModule = 'node:path'
    const [fs, path] = await Promise.all([import(fsModule), import(pathModule)])
    const filename = path.resolve(options.baseDir ?? process.cwd(), source)
    try {
        if ((await fs.stat(filename)).size > MAX_BYTES) fail(`Image asset exceeds ${MAX_BYTES} encoded bytes: ${filename}`)
        const bytes = await fs.readFile(filename)
        if (bytes.length > MAX_BYTES) fail(`Image asset exceeds ${MAX_BYTES} encoded bytes: ${filename}`)
        return Uint8Array.from(bytes)
    } catch (error) {
        if (error instanceof ImageAssetError) throw error
        fail(`Could not read image asset ${JSON.stringify(filename)}: ${(error as Error).message}`)
    }
}

/** Check scanline bounds before the general decoder allocates its output. */
function inspectPng(bytes: Uint8Array, strict = true): { width: number; height: number } {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (bytes.length < 33 || signature.some((value, i) => bytes[i] !== value)) fail('Image asset is not a PNG.')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const name = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    if (view.getUint32(8) !== 13 || name(8) !== 'IHDR') fail('Image PNG must begin with one IHDR chunk.')
    const width = view.getUint32(16), height = view.getUint32(20)
    if (!width || !height || width * height > MAX_PIXELS) fail(`Image PNG must contain at most ${MAX_PIXELS} pixels with positive dimensions.`)
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]]
    const depth = bytes[24], interlace = bytes[28]
    if (strict && (depth !== 8 || interlace !== 0)) {
        fail('Image assets support noninterlaced 8-bit PNGs, including RGB, RGBA, grayscale and palette images.')
    }
    const depths = bytes[25] === 0 ? [1, 2, 4, 8, 16] : bytes[25] === 3 ? [1, 2, 4, 8] : [8, 16]
    if (!channels || !depths.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) fail('Image PNG has unsupported header fields.')
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
    const expected = passes.reduce((sum, [x, y, dx, dy]) => {
        const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy))
        return sum + (w && h ? h * (1 + Math.ceil(w * channels * depth / 8)) : 0)
    }, 0)
    let expanded = 0, data = false, dataEnded = false, ended = false
    const inflater = new Unzlib(chunk => {
        expanded += chunk.length
        if (expanded > expected) fail('Image PNG expands beyond its declared dimensions.')
    })
    for (let at = 8; at + 12 <= bytes.length;) {
        const length = view.getUint32(at), type = name(at), end = at + length + 12
        if (end > bytes.length) fail('Image PNG chunk exceeds the encoded bytes.')
        if (type === 'IHDR' && at !== 8) fail('Image PNG has more than one IHDR chunk.')
        if (strict && ['iCCP', 'acTL', 'fcTL', 'fdAT'].includes(type)) fail('Image assets do not support compressed color profiles or animated PNGs.')
        if (type === 'iCCP') {
            let start = at + 8
            while (start < end - 4 && bytes[start] !== 0) start++
            if (start + 2 >= end - 4 || bytes[start + 1] !== 0) fail('Image PNG color profile is invalid.')
            let profileSize = 0
            const profile = new Unzlib(chunk => { profileSize += chunk.length; if (profileSize > MAX_BYTES) fail('Image PNG color profile exceeds the decoded byte limit.') })
            for (let part = start + 2; part < end - 4; part += 1024) profile.push(bytes.subarray(part, Math.min(part + 1024, end - 4)), false)
            profile.push(new Uint8Array(0), true)
        }
        if (type === 'IDAT') {
            if (dataEnded) fail('Image PNG data chunks must be consecutive.')
            data = true
            for (let part = at + 8; part < end - 4; part += 1024) inflater.push(bytes.subarray(part, Math.min(part + 1024, end - 4)), false)
        } else if (data) dataEnded = true
        if (type === 'IEND') {
            if (length || end !== bytes.length) fail('Image PNG has an invalid end chunk.')
            ended = true
            break
        }
        at = end
    }
    if (!data || !ended) fail('Image PNG is missing its data or end chunk.')
    inflater.push(new Uint8Array(0), true)
    if (expanded !== expected) fail('Image PNG scanlines do not match its dimensions.')
    return { width, height }
}

/** Load once before authoring. No network request or file read occurs while painting. */
export async function resolveImageAsset(source: string | Uint8Array, options: ImageAssetOptions = {}): Promise<ImageAsset> {
    if (options.mediaType !== undefined && options.mediaType !== 'image/png') fail(`Unsupported image asset media type: ${options.mediaType}. Use image/png.`)
    if (options.sha256 !== undefined && (typeof options.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(options.sha256))) fail('Image asset SHA-256 must contain 64 hexadecimal digits.')
    if (options.id !== undefined && (typeof options.id !== 'string' || !options.id.trim())) fail('Image asset ID must be a nonempty string.')
    const bytes = await sourceBytes(source, options)
    let dimensions: { width: number; height: number }
    let visible: Visibility
    try {
        dimensions = inspectPng(bytes)
        const decoded = decode(bytes, { checkCrc: true })
        visible = pngVisibility(decoded)
        if (decoded.width !== dimensions.width || decoded.height !== dimensions.height) fail('Decoded image dimensions differ from the PNG header.')
    } catch (error) {
        if (error instanceof ImageAssetError) throw error
        fail(`Could not decode image asset: ${(error as Error).message}`)
    }
    for (const key of ['width', 'height'] as const) {
        if (options[key] !== undefined && options[key] !== dimensions[key]) fail(`Image asset ${key} is ${dimensions[key]}, not the declared ${options[key]}.`)
    }
    const hash = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    if (options.sha256 !== undefined && sha256 !== options.sha256.toLowerCase()) fail(`Image asset SHA-256 mismatch: expected ${options.sha256.toLowerCase()}, received ${sha256}.`)
    const asset: ImageAsset = Object.freeze({ ...(options.id ? { id: options.id } : {}), src: dataUri(bytes), mediaType: 'image/png', ...dimensions, sha256 })
    visibility.set(asset, visible)
    await preloadBrowserImage(asset, bytes)
    prepared.add(asset)
    return asset
}

async function preloadBrowserImage(asset: ImageAsset, bytes: Uint8Array): Promise<void> {
    // A GIF is a still stage node. Snapshot its first frame, matching SVG export.
    if (asset.mediaType === 'image/gif' && typeof createImageBitmap !== 'undefined') {
        try {
            const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer], { type: asset.mediaType }))
            if (bitmap.width !== asset.width || bitmap.height !== asset.height) fail('Browser image dimensions differ from the validated asset.')
            browserSources.set(asset, bitmap)
        } catch (error) {
            if (error instanceof ImageAssetError) throw error
            fail(`Browser could not decode image asset: ${(error as Error).message}`)
        }
    } else if (typeof Image !== 'undefined') {
        const element = new Image()
        element.src = asset.src
        try {
            await element.decode()
        } catch (error) {
            fail(`Browser could not decode image asset: ${(error as Error).message}`)
        }
        if (element.naturalWidth !== asset.width || element.naturalHeight !== asset.height) fail('Browser image dimensions differ from the validated asset.')
        if (asset.mediaType === 'image/gif') {
            const canvas = document.createElement('canvas')
            canvas.width = asset.width; canvas.height = asset.height
            canvas.getContext('2d')!.drawImage(element, 0, 0)
            browserSources.set(asset, canvas)
        } else browserSources.set(asset, element)
    } else if (typeof createImageBitmap !== 'undefined') {
        try {
            const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes).buffer], { type: asset.mediaType }))
            if (bitmap.width !== asset.width || bitmap.height !== asset.height) fail('Browser image dimensions differ from the validated asset.')
            browserSources.set(asset, bitmap)
        } catch (error) {
            if (error instanceof ImageAssetError) throw error
            fail(`Browser could not decode image asset: ${(error as Error).message}`)
        }
    }
}

/** Legacy string images retain JPEG, GIF and URL support; prepared assets never fetch. */
export async function resolveLegacyImage(source: string, allowNetwork: boolean): Promise<ImageAsset> {
    let bytes: Uint8Array, declared: string | undefined
    if (source.startsWith('data:')) {
        const match = /^data:(image\/(?:png|jpe?g|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source)
        if (!match || match[2].length % 4 || match[2].length > Math.ceil(MAX_BYTES / 3) * 4) fail('Image contains invalid, unsupported or oversized base64 data.')
        declared = match[1] === 'image/jpg' ? 'image/jpeg' : match[1]
        bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0))
    } else if (/^https?:\/\//i.test(source) || source.startsWith('//') || typeof window !== 'undefined') {
        const offline = typeof process !== 'undefined' && (process.env?.VIZMATIC_DISABLE_NETWORK === '1' || process.env?.VIZMATIC_OFFLINE === '1')
        if (!allowNetwork || offline) fail('Network image loading is disabled by imageNetwork: deny or the offline environment.')
        try {
            const url = typeof document !== 'undefined' ? new URL(source, document.baseURI).href : source
            if (!/^https?:\/\//i.test(url)) fail('Network images require an HTTP or HTTPS URL.')
            const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
            if (!response.ok) fail(`Image request failed with HTTP ${response.status}: ${url}`)
            const length = response.headers.get('content-length')
            if (length && Number(length) > MAX_BYTES) fail(`Image exceeds ${MAX_BYTES} encoded bytes.`)
            declared = response.headers.get('content-type')?.split(';')[0].trim()
            const reader = response.body?.getReader()
            if (!reader) fail('Image request returned no body.')
            const chunks: Uint8Array[] = []
            let total = 0
            for (;;) {
                const { value, done } = await reader.read()
                if (done) break
                total += value.length
                if (total > MAX_BYTES) { await reader.cancel(); fail(`Image exceeds ${MAX_BYTES} encoded bytes.`) }
                chunks.push(value)
            }
            bytes = new Uint8Array(total)
            let at = 0
            for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
        } catch (error) {
            if (error instanceof ImageAssetError) throw error
            fail(`Could not load image ${JSON.stringify(source)}: ${(error as Error).message}`)
        }
    } else bytes = await sourceBytes(source, {})

    const { visible, ...info } = legacyImageHeader(bytes)
    if (declared?.startsWith('image/') && declared !== info.mediaType) fail(`Image MIME type ${declared} does not match ${info.mediaType} bytes.`)
    const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
    const sha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const asset: ImageAsset = Object.freeze({ src: dataUri(bytes, info.mediaType), sha256, ...info })
    if (visible !== undefined) visibility.set(asset, visible)
    if (typeof process !== 'undefined' && process.versions?.node) {
        // Use the same decoder as SVG export, rather than a second raster backend.
        const moduleName = '@resvg/resvg-js'
        const { Resvg } = await import(moduleName)
        try {
            const raster = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}"><image width="${asset.width}" height="${asset.height}" href="${asset.src}"/></svg>`, { font: { loadSystemFonts: false } })
            if (!raster.innerBBox()) fail('Image decoder rejected the encoded image.')
            const rendered = raster.render()
            if (asset.mediaType === 'image/jpeg' && !rendered.pixels.some((alpha: number, i: number) => i % 4 === 3 && alpha > 0)) fail('Image decoder rejected the JPEG pixel data.')
        } catch (error) {
            if (error instanceof ImageAssetError) throw error
            fail(`Could not decode image: ${(error as Error).message}`)
        }
    }
    await preloadBrowserImage(asset, bytes)
    prepared.add(asset)
    return asset
}

function legacyImageHeader(bytes: Uint8Array): { width: number; height: number; mediaType: ImageAsset['mediaType']; visible?: Visibility } {
    if (!bytes.length || bytes.length > MAX_BYTES) fail('Image bytes are empty or oversized.')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let width = 0, height = 0, mediaType: ImageAsset['mediaType']
    let visible: Visibility | undefined
    if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
        mediaType = 'image/png'
        try {
            ;({ width, height } = inspectPng(bytes, false))
            visible = pngVisibility(decode(bytes, { checkCrc: true }))
        } catch (error) {
            if (error instanceof ImageAssetError) throw error
            fail(`Could not decode image PNG: ${(error as Error).message}`)
        }
    } else if (bytes.length >= 14 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.subarray(0, 6)))) {
        width = view.getUint16(6, true); height = view.getUint16(8, true); mediaType = 'image/gif'
        let at = 13 + ((bytes[10] & 128) ? 3 * (2 ** ((bytes[10] & 7) + 1)) : 0), frames = 0, ended = false
        const blocks = (capture = false): Uint8Array => {
            const chunks: Uint8Array[] = []
            let total = 0
            for (;;) {
                if (at >= bytes.length) fail('Image GIF data is truncated.')
                const length = bytes[at++]
                if (!length) break
                if (capture) { chunks.push(bytes.subarray(at, at + length)); total += length }
                at += length
                if (at > bytes.length) fail('Image GIF block exceeds the encoded bytes.')
            }
            const out = new Uint8Array(total)
            let offset = 0
            for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
            return out
        }
        while (at < bytes.length) {
            const tag = bytes[at++]
            if (tag === 0x3b) { ended = true; break }
            if (tag === 0x21) { at++; blocks() }
            else if (tag === 0x2c) {
                if (at + 9 > bytes.length) fail('Image GIF descriptor is truncated.')
                const fw = view.getUint16(at + 4, true), fh = view.getUint16(at + 6, true), flags = bytes[at + 8]
                if (!fw || !fh || fw * fh > MAX_PIXELS) fail('Image GIF frame dimensions are invalid.')
                at += 9 + ((flags & 128) ? 3 * (2 ** ((flags & 7) + 1)) : 0)
                if (bytes[at] < 2 || bytes[at] > 8) fail('Image GIF compression code size is invalid.')
                const codeSize = bytes[at++]
                validateGifData(blocks(true), codeSize, fw * fh)
                frames++
            } else fail('Image GIF contains an invalid block.')
        }
        if (!frames || !ended) fail('Image GIF is missing its frame data or trailer.')
    } else if (bytes[0] === 255 && bytes[1] === 216) {
        mediaType = 'image/jpeg'
        for (let at = 2; at + 3 < bytes.length;) {
            if (bytes[at++] !== 255) fail('Image JPEG contains an invalid marker.')
            while (bytes[at] === 255) at++
            if (at + 3 > bytes.length) fail('Image JPEG marker is truncated.')
            const marker = bytes[at++]
            if (marker === 0xda || marker === 0xd9) break
            const length = view.getUint16(at)
            if (length < 2 || at + length > bytes.length) fail('Image JPEG segment is truncated.')
            if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
                if (length < 8) fail('Image JPEG frame is truncated.')
                height = view.getUint16(at + 3); width = view.getUint16(at + 5)
            }
            at += length
        }
        if (!bytes.some((value, i) => i > 0 && value === 217 && bytes[i - 1] === 255)) fail('Image JPEG is missing its end marker.')
    } else fail('Image bytes are not a supported PNG, JPEG or GIF.')
    if (!width || !height || width * height > MAX_PIXELS) fail(`Image must contain at most ${MAX_PIXELS} pixels with positive dimensions.`)
    return { width, height, mediaType, visible }
}

function pngVisibility(png: DecodedPng): Visibility {
    const { width, height, channels, depth, data, palette, transparency } = png
    if (channels !== 2 && channels !== 4 && !palette && !transparency) return true
    const mask = new Uint8Array(Math.ceil(width * height / 8))
    const sample = (x: number, y: number, channel = 0): number => depth >= 8 ? data[(y * width + x) * channels + channel]
        : (data[y * Math.ceil(width * depth / 8) + (x * depth >> 3)] >> (8 - depth - x * depth % 8)) & ((1 << depth) - 1)
    let count = 0
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        let visible: boolean
        if (channels === 2 || channels === 4) visible = sample(x, y, channels - 1) > 0
        else if (palette) {
            const color = palette[sample(x, y)]
            if (!color) fail('Image PNG references a missing palette color.')
            visible = (color[3] ?? 255) > 0
        } else visible = !transparency!.every((value, channel) => sample(x, y, channel) === value)
        if (visible) { const index = y * width + x; mask[index >> 3] |= 1 << (index & 7); count++ }
    }
    return count === 0 ? false : count === width * height ? true : { width, height, mask, crops: new Map() }
}

/** Alpha-aware presence for blank checks; raster text remains outside text diagnostics. */
export function imageHasVisiblePixels(asset: ImageAsset | undefined, crop?: ImageCrop): boolean {
    const value = asset ? visibility.get(asset) : undefined
    if (value === undefined) return true
    if (typeof value === 'boolean') return value
    if (!crop || crop.x === 0 && crop.y === 0 && crop.width === value.width && crop.height === value.height) return true
    const key = `${crop.x},${crop.y},${crop.width},${crop.height}`, cached = value.crops.get(key)
    if (cached !== undefined) return cached
    for (let y = Math.floor(crop.y); y < Math.ceil(crop.y + crop.height); y++) for (let x = Math.floor(crop.x); x < Math.ceil(crop.x + crop.width); x++) {
        const index = y * value.width + x
        if (value.mask[index >> 3] & (1 << (index & 7))) { value.crops.set(key, true); return true }
    }
    value.crops.set(key, false)
    return false
}

/** Validate code references and decoded length without implementing another pixel renderer. */
function validateGifData(data: Uint8Array, minimum: number, pixels: number): void {
    const clear = 1 << minimum, end = clear + 1, lengths = new Uint16Array(4096)
    let bits = minimum + 1, next = end + 1, previous = 0, offset = 0, written = 0
    for (;;) {
        if (offset + bits > data.length * 8) fail('Image GIF compressed data is truncated.')
        let code = 0
        for (let bit = 0; bit < bits; bit++) code |= ((data[(offset + bit) >> 3] >> ((offset + bit) & 7)) & 1) << bit
        offset += bits
        if (code === clear) { bits = minimum + 1; next = end + 1; previous = 0; continue }
        if (code === end) {
            if (written !== pixels) fail('Image GIF decoded length does not match its frame dimensions.')
            return
        }
        const length = code < clear ? 1 : code < next ? lengths[code] : code === next && previous ? previous + 1 : 0
        if (!length) fail('Image GIF contains an invalid compression reference.')
        written += length
        if (written > pixels) fail('Image GIF expands beyond its frame dimensions.')
        if (previous && next < 4096) {
            lengths[next++] = previous + 1
            if (next === 1 << bits && bits < 12) bits++
        }
        previous = length
    }
}

export function isImageAsset(value: unknown): value is ImageAsset {
    return !!value && typeof value === 'object' && prepared.has(value as ImageAsset)
}

/** Internal renderer lookup. Assets have finished decoding before they reach a frame. */
export function browserImageSource(asset: ImageAsset | undefined): CanvasImageSource | undefined {
    return asset ? browserSources.get(asset) : undefined
}

export function validateStageImage(value: StageImage, asset: ImageAsset): void {
    if (![value.width, value.height].every(n => Number.isFinite(n) && n > 0)) fail('Image destination dimensions must be positive finite numbers.')
    const crop = value.crop
    if (crop && (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0
        || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > asset.width || crop.y + crop.height > asset.height)) {
        fail('Image crop must be a nonempty region inside the intrinsic image pixels.')
    }
}

/** A centered image node. Fit preserves proportions; crop uses intrinsic pixel coordinates. */
export function imageFromAsset(asset: ImageAsset, options: ImageFitOptions = {}): Node {
    if (!isImageAsset(asset)) fail('Call and await resolveImageAsset before creating an image node.')
    if (options.fit !== undefined && options.fit !== 'contain' && options.fit !== 'cover') fail('Image fit must be contain or cover.')
    let crop = { ...(options.crop ?? { x: 0, y: 0, width: asset.width, height: asset.height }) }
    let width = options.width ?? (options.height === undefined ? crop.width : options.height * crop.width / crop.height)
    let height = options.height ?? width * crop.height / crop.width
    validateStageImage({ src: asset.src, width, height, crop }, asset)
    if (options.fit === 'cover') {
        const ratio = width / height, sourceRatio = crop.width / crop.height
        if (sourceRatio > ratio) {
            const next = crop.height * ratio
            crop = { ...crop, x: crop.x + (crop.width - next) / 2, width: next }
        } else {
            const next = crop.width / ratio
            crop = { ...crop, y: crop.y + (crop.height - next) / 2, height: next }
        }
    } else {
        const scale = Math.min(width / crop.width, height / crop.height)
        width = crop.width * scale
        height = crop.height * scale
    }
    const node = new Node().set('image', Object.freeze({ src: asset.src, width, height, crop: Object.freeze(crop), asset }))
    node.set('px', width / 2).set('py', height / 2)
    node.label = asset.id ?? 'image'
    return node
}
