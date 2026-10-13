import parseCssColor from 'parse-css-color'
import { getThemeColors, type ThemeColors, type ThemeMode, type ThemePreset } from './theme'

export type ThemeColorKey = Exclude<keyof ThemeColors, 'preset' | 'fontSans' | 'fontMono'>
export type PlaygroundThemeColors = Partial<Record<ThemeColorKey, string>>
export type PlaygroundBackground = 'theme' | 'transparent' | string

export const themeColorKeys: readonly ThemeColorKey[] = Object.freeze(
    Object.keys(getThemeColors('dark')).filter((key) => key !== 'preset' && key !== 'fontSans' && key !== 'fontMono') as ThemeColorKey[],
)
const themeColorKeySet = new Set<string>(themeColorKeys)

export function validatePlaygroundThemeColors(value: unknown): PlaygroundThemeColors {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('themeColors must be a JSON object of CSS colors.')
    }

    const colors: PlaygroundThemeColors = {}
    for (const [key, color] of Object.entries(value)) {
        if (!themeColorKeySet.has(key)) {
            throw new Error(`Unknown themeColors key ${JSON.stringify(key)}.`)
        }
        if (typeof color !== 'string' || !parseCssColor(color.trim())) {
            throw new Error(`themeColors.${key} must be a valid CSS color.`)
        }
        colors[key as ThemeColorKey] = color.trim()
    }
    return colors
}

export function parseThemeColorsMetadataLine(line: string): PlaygroundThemeColors | undefined {
    const withoutComment = stripTrailingLineComment(line.replace(/^\s*\/\/\s*/, '')).trim()
    const match = withoutComment.match(/^(?:\/\/\s*)?(?:export\s+)?(?:(?:const|let|var)\s+)?themeColors\s*[:=]\s*(.*?)\s*;?$/)
    if (!match) return undefined
    if (!match[1]?.trim()) throw new Error('themeColors must be a single-line JSON object of CSS colors.')

    let parsed: unknown
    try {
        parsed = JSON.parse(match[1])
    } catch {
        throw new Error('themeColors must be a single-line JSON object of CSS colors.')
    }
    return validatePlaygroundThemeColors(parsed)
}

export function parseBackgroundMetadataLine(line: string): PlaygroundBackground | undefined {
    const withoutComment = stripTrailingLineComment(line.replace(/^\s*\/\/\s*/, '')).trim()
    const match = withoutComment.match(/^(?:export\s+)?(?:(?:const|let|var)\s+)?background\s*[:=]\s*(.*?)\s*;?$/)
    if (!match) return undefined
    if (!match[1]?.trim()) throw new Error('background must be a single-line JSON string set to "theme", "transparent", or a CSS color.')
    let parsed: unknown
    try {
        parsed = JSON.parse(match[1])
    } catch {
        throw new Error('background must be a single-line JSON string set to "theme", "transparent", or a CSS color.')
    }
    return validatePlaygroundBackground(parsed)
}

export function isBackgroundMetadataLine(line: string): boolean {
    return /^(?:\s*\/\/\s*)?(?:export\s+)?(?:(?:const|let|var)\s+)?background\s*[:=]/.test(line)
}

export function validatePlaygroundBackground(value: unknown): PlaygroundBackground {
    if (typeof value !== 'string') {
        throw new Error('background must be "theme", "transparent", or a valid CSS color.')
    }
    const background = value.trim()
    if (background === 'theme' || background === 'transparent' || parseCssColor(background)) return background
    throw new Error('background must be "theme", "transparent", or a valid CSS color.')
}

export function isThemeColorsMetadataLine(line: string): boolean {
    return /^(?:\s*\/\/\s*)?(?:export\s+)?(?:(?:const|let|var)\s+)?themeColors\s*[:=]/.test(line)
}

export function mergePlaygroundThemeColors(
    mode: ThemeMode,
    preset: ThemePreset,
    overrides?: PlaygroundThemeColors,
): ThemeColors {
    return { ...getThemeColors(mode, preset), ...overrides }
}

export function serializeThemeColorsMetadata(colors: PlaygroundThemeColors): string {
    const validated = validatePlaygroundThemeColors(colors)
    return `themeColors = ${JSON.stringify(validated)}`
}

export function serializeBackgroundMetadata(background: PlaygroundBackground): string {
    return 'background = ' + JSON.stringify(validatePlaygroundBackground(background))
}

function stripTrailingLineComment(line: string): string {
    let quoted = false
    let escaped = false
    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index]
        if (quoted) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') quoted = false
            continue
        }
        if (character === '"') quoted = true
        else if (character === '/' && line[index + 1] === '/') return line.slice(0, index)
    }
    return line
}
