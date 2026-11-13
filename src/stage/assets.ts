/**
 * Loads bundled fonts in both environments. Node reads them from the package.
 * Browsers fetch them relative to `setAssetBase`, or to the module by default.
 */
let assetBase: string | null = null

/** Tell the browser build where fonts live. The URL must end with a slash. */
export function setAssetBase(url: string): void {
    assetBase = url
}

function isNodeRuntime(): boolean {
    return typeof process !== 'undefined' && process.release?.name === 'node'
}

export function filePathToUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/')
    const encoded = encodeURI(normalized).replace(/#/g, '%23').replace(/\?/g, '%3F')
    return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

function moduleUrl(): string {
    // The CommonJS build defines import.meta.url as undefined, and __filename exists instead.
    const url: string | undefined = import.meta.url
    if (url) return url
    return typeof __filename !== 'undefined' ? filePathToUrl(__filename) : 'file:///'
}

async function nodeRead(relative: string): Promise<ArrayBuffer> {
    // A computed specifier keeps browser bundlers from following Node modules.
    const fsName = 'node:fs/promises', pathName = 'node:path', urlName = 'node:url'
    const [fs, path, url] = await Promise.all([import(fsName), import(pathName), import(urlName)])
    const currentFile: string = import.meta.url
        ? url.fileURLToPath(import.meta.url)
        : typeof __filename !== 'undefined'
            ? url.fileURLToPath(url.pathToFileURL(__filename).href)
            : url.fileURLToPath(moduleUrl())
    let directory: string = path.dirname(currentFile)
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
    if (isNodeRuntime() && (assetBase === null || assetBase.startsWith('file:'))) return nodeRead(relative)
    const base = assetBase ?? new URL('./assets/', moduleUrl()).href
    const response = await fetch(new URL(relative, base))
    // Static hosts often answer a missing file with an HTML page and a 200 status.
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || type.includes('text/html')) {
        throw new Error(`Could not load ${relative} from ${response.url} (HTTP ${response.status}, ${type || 'no content type'}). Call setAssetBase() with the folder that holds fonts/.`)
    }
    return response.arrayBuffer()
}
