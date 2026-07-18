import { findBareRootJsxStart } from './bare-source'

export type PlaygroundTheme = 'dark' | 'light'
export type PlaygroundPreset = 'default' | 'engineering'

export interface PlaygroundMetadata {
    width: number
    height: number
    preset: PlaygroundPreset
    warnings: string[]
}

export interface PreparedPlaygroundSource {
    metadata: PlaygroundMetadata
    setup: string
    jsx: string
}

export const DEFAULT_PLAYGROUND_WIDTH = 960
export const DEFAULT_PLAYGROUND_HEIGHT = 540
const DYNAMIC_IMPORT_PATTERN = /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\(/m

function readDimensionLine(line: string): { name: 'width' | 'height'; value: number } | undefined {
    const match = line.match(/^\s*(?:(?:\/\/\s*)?)(?:export\s+)?(?:(?:const|let|var)\s+)?(width|height)\s*[:=]\s*(\d+)\s*;?\s*$/i)
    if (!match?.[1] || !match[2]) return undefined
    return { name: match[1].toLowerCase() as 'width' | 'height', value: Number(match[2]) }
}

function readPresetLine(line: string): { preset?: PlaygroundPreset; requested: string } | undefined {
    const withoutComment = line.replace(/\s*\/\/.*$/, '').trim()
    const match = withoutComment.match(/^(?:export\s+)?(?:(?:const|let|var)\s+)?preset\s*[:=]\s*(.+)$/i)
    if (!match?.[1]) return undefined

    const expression = match[1].trim().replace(/;\s*$/, '').trim()
    const quoted = expression.match(/^(["'])(.*)\1$/)
    const requested = (quoted?.[2] ?? expression).trim()
    const normalized = requested.toLowerCase()
    const preset = quoted && (normalized === 'default' || normalized === 'engineering')
        ? normalized as PlaygroundPreset
        : undefined

    return { preset, requested }
}

function validDimension(value: number, name: 'width' | 'height'): number {
    if (!Number.isInteger(value) || value < 1 || value > 8192) {
        throw new Error(`${name} must be an integer from 1 to 8192.`)
    }
    return value
}

/**
 * Mirrors CLI bare-frame metadata without allowing browser imports. User code
 * stays in a worker, where it is transpiled and evaluated for one render.
 */
export function preparePlaygroundSource(source: string): PreparedPlaygroundSource {
    let width = DEFAULT_PLAYGROUND_WIDTH
    let height = DEFAULT_PLAYGROUND_HEIGHT
    let preset: PlaygroundPreset = 'default'
    const warnings: string[] = []
    const body = source.replace(/^\uFEFF/, '')
    if (/^\s*import\s/m.test(body)) {
        throw new Error('Bare playground snippets cannot use imports. Vizmatic primitives are injected automatically.')
    }
    if (DYNAMIC_IMPORT_PATTERN.test(body)) {
        throw new Error('Bare playground snippets cannot load dynamic imports.')
    }

    const jsxStart = findBareRootJsxStart(body)
    if (jsxStart < 0) {
        throw new Error('Add one root Vizmatic JSX element, such as <Scene>…</Scene>.')
    }

    const setupLines: string[] = []
    let metadataPreamble = true
    let metadataBlockComment = false
    for (const line of body.slice(0, jsxStart).split(/\r?\n/)) {
        const trimmed = line.trim()
        if (metadataBlockComment) {
            if (trimmed.includes('*/')) metadataBlockComment = false
            setupLines.push(line)
            continue
        }
        if (trimmed.startsWith('/*')) {
            metadataBlockComment = !trimmed.slice(2).includes('*/')
            setupLines.push(line)
            continue
        }

        const dimension = metadataPreamble ? readDimensionLine(line) : undefined
        if (dimension) {
            if (dimension.name === 'width') width = validDimension(dimension.value, 'width')
            if (dimension.name === 'height') height = validDimension(dimension.value, 'height')
            continue
        }

        const parsedPreset = metadataPreamble ? readPresetLine(line) : undefined
        if (parsedPreset) {
            if (parsedPreset.preset) preset = parsedPreset.preset
            else warnings.push(`Unknown preset ${JSON.stringify(parsedPreset.requested)}. Using "default".`)
            continue
        }

        if (trimmed && !trimmed.startsWith('//')) metadataPreamble = false
        setupLines.push(line)
    }

    const setup = setupLines.join('\n').replace(/^\s*export\s+/gm, '')
    const jsx = body.slice(jsxStart).trim()
        .replace(/^export\s+default\s+/, '')
        .replace(/;\s*$/, '')

    if (!jsx) throw new Error('Add a root Vizmatic JSX element.')

    return {
        metadata: { width, height, preset, warnings },
        setup,
        jsx,
    }
}

export function getPlaygroundHashSource(hash = window.location.hash): string | undefined {
    const match = hash.match(/^#(?:vizmatic-playground|playground)=([\s\S]*)$/)
    if (!match?.[1]) return undefined

    try {
        return decodeURIComponent(match[1])
    } catch {
        return undefined
    }
}

export function setPlaygroundHashSource(source: string): void {
    const url = new URL(window.location.href)
    url.hash = `vizmatic-playground=${encodeURIComponent(source)}`
    window.history.replaceState(null, '', url)
}
