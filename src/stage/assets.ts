/**
 * Loads bundled fonts in both environments. Node reads them from the package.
 * Browsers fetch them relative to `setAssetBase`, or to the module by default.
 */
let assetBase: string | null = null

/** Tell the browser build where fonts live. The URL must end with a slash. */
export function setAssetBase(url: string): void {
    assetBase = url
}

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof (globalThis as { document?: unknown }).document === 'undefined'

function moduleUrl(): string {
    // The CommonJS build defines import.meta.url as undefined, and __filename exists instead.
    const url: string | undefined = import.meta.url
    if (url) return url
    return `file://${typeof __filename !== 'undefined' ? __filename : ''}`
}

async function nodeRead(relative: string): Promise<ArrayBuffer> {
    // A computed specifier keeps browser bundlers from following Node modules.
    const fsName = 'node:fs/promises', pathName = 'node:path', urlName = 'node:url'
    const [fs, path, url] = await Promise.all([import(fsName), import(pathName), import(urlName)])
    let directory: string = path.dirname(url.fileURLToPath(moduleUrl()))
    for (let depth = 0; depth < 6; depth++) {
        const candidate = path.join(directory, 'assets', relative)
        try {
            const bytes: Uint8Array = await fs.readFile(candidate)
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        directory = path.dirname(directory)
    }
    throw new Error(`Bundled asset not found: assets/${relative}`)
}

export async function loadBinaryAsset(relative: string): Promise<ArrayBuffer> {
    if (isNode) return nodeRead(relative)
    const base = assetBase ?? new URL('./assets/', moduleUrl()).href
    const response = await fetch(new URL(relative, base))
    // Static hosts often answer a missing file with an HTML page and a 200 status.
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || type.includes('text/html')) {
        throw new Error(`Could not load ${relative} from ${response.url} (HTTP ${response.status}, ${type || 'no content type'}). Call setAssetBase() with the folder that holds fonts/.`)
    }
    return response.arrayBuffer()
}
