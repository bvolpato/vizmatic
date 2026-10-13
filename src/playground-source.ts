import { extractRootJsx, findBareRootJsxStart } from './bare-source'
import { validatePlaygroundAnimation, type PlaygroundAnimationMetadata } from './playground-animation'
import {
    isBackgroundMetadataLine,
    isThemeColorsMetadataLine,
    parseBackgroundMetadataLine,
    parseThemeColorsMetadataLine,
    type PlaygroundBackground,
    type PlaygroundThemeColors,
} from './frame-theme'
import {
    DEFAULT_PLAYGROUND_HEIGHT,
    DEFAULT_PLAYGROUND_WIDTH,
    readAnimationLine,
    readPresetLine,
    type PlaygroundPreset,
} from './playground-settings'

export type PlaygroundTheme = 'dark' | 'light'
export type { PlaygroundPreset } from './playground-settings'

export interface PlaygroundMetadata {
    width: number
    height: number
    preset: PlaygroundPreset
    warnings: string[]
    themeColors?: PlaygroundThemeColors
    background?: PlaygroundBackground
    animation?: PlaygroundAnimationMetadata
}

export interface PreparedPlaygroundSource {
    metadata: PlaygroundMetadata
    setup: string
    jsx: string
}

export { DEFAULT_PLAYGROUND_WIDTH, DEFAULT_PLAYGROUND_HEIGHT, readAnimationLine } from './playground-settings'
const DYNAMIC_IMPORT_PATTERN = /\bimport(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\(/m

function readDimensionLine(line: string): { name: 'width' | 'height'; value: number } | undefined {
    const candidate = line.replace(/^\s*\/\/\s*/, '').replace(/\s*\/\/.*$/, '')
    const match = candidate.match(/^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?(width|height)\s*[:=]\s*(\d+)\s*;?\s*$/i)
    if (!match?.[1] || !match[2]) return undefined
    return { name: match[1].toLowerCase() as 'width' | 'height', value: Number(match[2]) }
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
    let animationDuration: number | undefined
    let animationFps: number | undefined
    let themeColors: PlaygroundThemeColors | undefined
    let background: PlaygroundBackground | undefined
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

        const animation = metadataPreamble ? readAnimationLine(line) : undefined
        if (animation) {
            if (animation.name === 'animationDuration') animationDuration = animation.value
            else animationFps = animation.value
            continue
        }

        if (metadataPreamble && isThemeColorsMetadataLine(line)) {
            themeColors = parseThemeColorsMetadataLine(line)
            continue
        }

        if (metadataPreamble && isBackgroundMetadataLine(line)) {
            background = parseBackgroundMetadataLine(line)
            continue
        }

        if (trimmed && !trimmed.startsWith('//')) metadataPreamble = false
        setupLines.push(line)
    }

    const setup = setupLines.join('\n').replace(/^\s*export\s+/gm, '')
    const jsx = extractRootJsx(body.slice(jsxStart).trim().replace(/^export\s+default\s+/, ''))

    if (!jsx) throw new Error('Add a root Vizmatic JSX element.')

    if (animationFps !== undefined && animationDuration === undefined) {
        throw new Error('animationFps requires animationDuration in the metadata preamble.')
    }
    const animation = animationDuration === undefined ? undefined
        : validatePlaygroundAnimation({ duration: animationDuration, fps: animationFps ?? 10 })

    return {
        metadata: {
            width,
            height,
            preset,
            warnings,
            ...(themeColors ? { themeColors } : {}),
            ...(background ? { background } : {}),
            ...(animation ? { animation } : {}),
        },
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

export function getLegacyPlaygroundRedirectUrl(href: string): string | undefined {
    const url = new URL(href)
    if (!getPlaygroundHashSource(url.hash) || url.pathname.endsWith('/playground.html')) return undefined

    url.pathname = new URL('playground.html', url).pathname
    return url.href
}
