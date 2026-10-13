import { findBareRootJsxStart } from './bare-source'
import {
    isThemeColorsMetadataLine,
    isBackgroundMetadataLine,
    parseThemeColorsMetadataLine,
    parseBackgroundMetadataLine,
    serializeBackgroundMetadata,
    serializeThemeColorsMetadata,
    validatePlaygroundBackground,
    validatePlaygroundThemeColors,
    type PlaygroundThemeColors,
    type PlaygroundBackground,
} from './frame-theme'

export type PlaygroundPreset = 'default' | 'engineering'

export const DEFAULT_PLAYGROUND_WIDTH = 960
export const DEFAULT_PLAYGROUND_HEIGHT = 540

export interface PlaygroundSettings {
    width: number
    height: number
    preset: PlaygroundPreset
    themeColors?: PlaygroundThemeColors
    background?: PlaygroundBackground
}

export interface PlaygroundSettingsPatch {
    width?: number
    height?: number
    preset?: PlaygroundPreset
    themeColors?: PlaygroundThemeColors | null
    background?: string | null
}

interface SourceLine {
    start: number
    end: number
    text: string
    newline: string
}

interface MetadataLine {
    line: SourceLine
    name: 'width' | 'height' | 'preset' | 'themeColors' | 'background'
    value: number | PlaygroundPreset | PlaygroundThemeColors | PlaygroundBackground
}

interface MetadataScan {
    entries: MetadataLine[]
    insertionOffset: number
    newline: string
}

export function readPlaygroundSettings(source: string): PlaygroundSettings {
    const settings: PlaygroundSettings = { width: DEFAULT_PLAYGROUND_WIDTH, height: DEFAULT_PLAYGROUND_HEIGHT, preset: 'default' }
    for (const entry of scanMetadata(source).entries) {
        if (entry.name === 'width' || entry.name === 'height') settings[entry.name] = entry.value as number
        else if (entry.name === 'preset') settings.preset = entry.value as PlaygroundPreset
        else if (entry.name === 'themeColors') {
            if (Object.keys(entry.value).length > 0) settings.themeColors = entry.value as PlaygroundThemeColors
            else delete settings.themeColors
        } else settings.background = entry.value as PlaygroundBackground
    }
    return settings
}

export function updatePlaygroundSettings(source: string, patch: PlaygroundSettingsPatch): string {
    if (patch.width !== undefined) validDimension(patch.width, 'width')
    if (patch.height !== undefined) validDimension(patch.height, 'height')
    if (patch.preset !== undefined && patch.preset !== 'default' && patch.preset !== 'engineering') {
        throw new Error('preset must be "default" or "engineering".')
    }

    const hasPalettePatch = Object.hasOwn(patch, 'themeColors')
    const hasBackgroundPatch = Object.hasOwn(patch, 'background')
    const palette = hasPalettePatch && patch.themeColors != null ? validatePlaygroundThemeColors(patch.themeColors) : undefined
    const clearPalette = hasPalettePatch && (patch.themeColors == null || Object.keys(palette ?? {}).length === 0)
    const clearBackground = hasBackgroundPatch && patch.background == null
    const background = hasBackgroundPatch && patch.background != null ? validatePlaygroundBackground(patch.background) : undefined
    const scan = scanMetadata(source)
    const replacements = new Map<number, string>()
    const additions: string[] = []
    const requested: Partial<Record<'width' | 'height', number>> = {}
    if (patch.width !== undefined) requested.width = patch.width
    if (patch.height !== undefined) requested.height = patch.height

    for (const name of ['width', 'height', 'preset', 'themeColors', 'background'] as const) {
        const active = name === 'width' || name === 'height' ? requested[name] !== undefined
            : name === 'preset' ? patch.preset !== undefined
                : name === 'themeColors' ? hasPalettePatch : hasBackgroundPatch
        if (!active) continue
        const remove = name === 'themeColors' && clearPalette || name === 'background' && clearBackground
        const value: unknown = name === 'width' || name === 'height' ? requested[name]
            : name === 'preset' ? patch.preset
                : name === 'themeColors' ? palette : background
        const matches = scan.entries.filter((entry) => entry.name === name)
        if (matches.length === 0 && !remove) {
            additions.push(formatMetadataLine(name, value))
            continue
        }
        for (const entry of matches) {
            if (remove) {
                const comment = trailingComment(entry.line.text)
                replacements.set(entry.line.start, comment ? leadingIndent(entry.line.text) + comment : '')
            } else replacements.set(entry.line.start, rewriteMetadataLine(entry.line.text, name, value))
        }
    }

    let updated = replaceLines(source, replacements)
    if (additions.length > 0) {
        let insertionOffset = scan.insertionOffset
        for (const line of sourceLines(source)) {
            if (line.start >= scan.insertionOffset) break
            const replacement = replacements.get(line.start)
            if (replacement !== undefined) insertionOffset += replacement.length - line.text.length
        }
        const prefix = updated.slice(0, insertionOffset)
        const suffix = updated.slice(insertionOffset)
        const separator = prefix.length > 0 && !/[\r\n]$/.test(prefix) ? scan.newline : ''
        updated = prefix + separator + additions.join(scan.newline) + scan.newline + suffix
    }
    if (patch.width !== undefined || patch.height !== undefined) updated = syncRootBoard(updated, requested)
    return updated
}

function scanMetadata(source: string): MetadataScan {
    const lines = sourceLines(source)
    const root = findBareRootJsxStart(source)
    const rootLine = root < 0 ? source.length : lineStartAt(lines, root)
    const entries: MetadataLine[] = []
    let preamble = true
    let inBlockComment = false
    let insertionOffset = rootLine
    for (const line of lines) {
        if (line.start >= rootLine) break
        const text = line.text.replace(/^\uFEFF/, '')
        const trimmed = text.trim()
        if (inBlockComment) {
            if (trimmed.includes('*/')) inBlockComment = false
            continue
        }
        if (trimmed.startsWith('/*')) {
            inBlockComment = !trimmed.slice(2).includes('*/')
            continue
        }
        if (!preamble) continue

        const dimension = readDimensionLine(text)
        if (dimension) {
            entries.push({ line, name: dimension.name, value: validDimension(dimension.value, dimension.name) })
            continue
        }
        const preset = readPresetLine(text)
        if (preset) {
            if (preset.preset) entries.push({ line, name: 'preset', value: preset.preset })
            continue
        }
        if (readAnimationLine(text)) continue
        if (isThemeColorsMetadataLine(text)) {
            const colors = parseThemeColorsMetadataLine(text)
            if (colors) entries.push({ line, name: 'themeColors', value: colors })
            continue
        }
        if (isBackgroundMetadataLine(text)) {
            const background = parseBackgroundMetadataLine(text)
            if (background) entries.push({ line, name: 'background', value: background })
            continue
        }
        if (!trimmed || trimmed.startsWith('//')) continue
        preamble = false
        insertionOffset = line.start
    }
    return { entries, insertionOffset, newline: lines.find((line) => line.newline)?.newline ?? '\n' }
}

function sourceLines(source: string): SourceLine[] {
    const lines: SourceLine[] = []
    let start = 0
    while (start < source.length) {
        let contentEnd = start
        while (contentEnd < source.length && source[contentEnd] !== '\n' && source[contentEnd] !== '\r') contentEnd += 1
        let end = contentEnd
        if (source[end] === '\r' && source[end + 1] === '\n') end += 2
        else if (source[end] === '\n' || source[end] === '\r') end += 1
        lines.push({ start, end, text: source.slice(start, contentEnd), newline: source.slice(contentEnd, end) })
        start = end
    }
    if (source.length === 0 || /[\r\n]$/.test(source)) lines.push({ start: source.length, end: source.length, text: '', newline: '' })
    return lines
}

function lineStartAt(lines: SourceLine[], offset: number): number {
    return lines.find((line) => line.start <= offset && offset < line.end)?.start ?? offset
}

function readDimensionLine(line: string): { name: 'width' | 'height'; value: number } | undefined {
    const candidate = stripLineComment(line.replace(/^\s*\/\/\s*/, ''))
    const match = candidate.match(/^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?(width|height)\s*[:=]\s*(\d+)\s*;?\s*$/i)
    if (!match?.[1] || !match[2]) return undefined
    return { name: match[1].toLowerCase() as 'width' | 'height', value: Number(match[2]) }
}

export function readPresetLine(line: string): { preset?: PlaygroundPreset; requested: string } | undefined {
    const candidate = stripLineComment(line.replace(/^\s*\/\/\s*/, '')).trim()
    const match = candidate.match(/^(?:export\s+)?(?:(?:const|let|var)\s+)?preset(?:\s*:\s*ThemePreset)?\s*[:=]\s*(.+)$/i)
    if (!match?.[1]) return undefined
    const expression = match[1].trim().replace(/;\s*$/, '').trim()
    const quoted = expression.match(/^(['"])(.*)\1$/)
    const requested = (quoted?.[2] ?? expression).trim()
    const normalized = requested.toLowerCase()
    const preset = quoted && (normalized === 'default' || normalized === 'engineering')
        ? normalized as PlaygroundPreset
        : undefined
    return { preset, requested }
}

export function readAnimationLine(line: string): { name: 'animationDuration' | 'animationFps'; value: number } | undefined {
    const match = line.match(/^\s*(?:\/\/\s*)?(?:export\s+)?(?:(?:const|let|var)\s+)?(animationDuration|animationFps)\s*[:=]\s*(.*?)\s*;?\s*(?:\/\/.*)?$/)
    if (!match) return undefined
    const expression = match[2].replace(/;\s*$/, '').trim()
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(expression)) {
        throw new Error(`${match[1]} must be a numeric literal.`)
    }
    return { name: match[1] as 'animationDuration' | 'animationFps', value: Number(expression) }
}

function stripLineComment(line: string): string {
    let quote: '"' | "'" | undefined
    let escaped = false
    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index]
        if (quote) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === quote) quote = undefined
        } else if (character === '"' || character === "'") quote = character
        else if (character === '/' && line[index + 1] === '/') return line.slice(0, index)
    }
    return line
}

function validDimension(value: number, name: 'width' | 'height'): number {
    if (!Number.isInteger(value) || value < 1 || value > 8192) throw new Error(name + ' must be an integer from 1 to 8192.')
    return value
}

function formatMetadataLine(name: 'width' | 'height' | 'preset' | 'themeColors' | 'background', value: unknown): string {
    if (name === 'preset') return 'preset = ' + JSON.stringify(value)
    if (name === 'themeColors') return serializeThemeColorsMetadata(value as PlaygroundThemeColors)
    if (name === 'background') return serializeBackgroundMetadata(value as PlaygroundBackground)
    return name + ' = ' + String(value)
}

function rewriteMetadataLine(line: string, name: 'width' | 'height' | 'preset' | 'themeColors' | 'background', value: unknown): string {
    const uncommented = line.replace(/^(\s*)\/\/\s*/, '$1')
    const assignment = uncommented.match(new RegExp('^(\\s*(?:export\\s+)?(?:(?:const|let|var)\\s+)?' + name + '(?:\\s*:\\s*ThemePreset)?\\s*[:=]\\s*)([\\s\\S]*?)(\\s*;?\\s*)(//.*)?$', 'i'))
    if (!assignment?.[1]) return formatMetadataLine(name, value)
    const indent = leadingIndent(line)
    const commentPrefix = /^\s*\/\//.test(line) ? indent + '// ' : indent
    const prefix = assignment[1].replace(/^\s*/, '')
    const terminator = assignment[3]?.includes(';') ? ';' : ''
    const suffix = assignment[4] ? ' ' + assignment[4].trim() : ''
    const expression = name === 'preset' ? JSON.stringify(value)
        : name === 'themeColors' || name === 'background' ? JSON.stringify(value) : String(value)
    return commentPrefix + prefix + expression + terminator + suffix
}

function trailingComment(line: string): string | undefined {
    const uncommented = line.replace(/^\s*\/\/\s*/, '')
    const index = lineCommentIndex(uncommented)
    return index < 0 ? undefined : uncommented.slice(index).trim()
}

function lineCommentIndex(line: string): number {
    let quoted = false
    let escaped = false
    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index]
        if (quoted) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') quoted = false
        } else if (character === '"') quoted = true
        else if (character === '/' && line[index + 1] === '/') return index
    }
    return -1
}

function leadingIndent(line: string): string { return line.match(/^\s*/)?.[0] ?? '' }

function replaceLines(source: string, replacements: Map<number, string>): string {
    if (replacements.size === 0) return source
    return sourceLines(source).map((line) => {
        const replacement = replacements.get(line.start)
        return replacement === '' ? '' : (replacement ?? line.text) + line.newline
    }).join('')
}

function syncRootBoard(source: string, dimensions: Partial<Record<'width' | 'height', number>>): string {
    const root = findBareRootJsxStart(source)
    if (root < 0) return source
    const rootTag = source.slice(root).match(/^\s*(?:export\s+default\s+)?(?:\(\s*)*(<Board(?=\s|\/|>))/)
    if (!rootTag?.[1]) return source
    const tagStart = root + rootTag[0].indexOf(rootTag[1])
    const tagEnd = findTagEnd(source, tagStart)
    if (tagEnd < 0) return source
    const tag = source.slice(tagStart, tagEnd)
    const attributes = readBoardAttributes(tag)
    const edits: Array<{ start: number; end: number; text: string }> = []
    const additions: string[] = []
    for (const name of ['width', 'height'] as const) {
        const target = dimensions[name]
        if (target === undefined) continue
        if (attributes.duplicates.has(name)) {
            throw new Error('Cannot safely sync root Board ' + name + ': it appears more than once. Keep one numeric literal prop first.')
        }
        if (attributes.spreads.length > 0) {
            throw new Error('Cannot safely sync root Board ' + name + ': its value may be supplied or overridden by prop spread ' + attributes.spreads.join(', ') + '.')
        }
        const attribute = attributes.dimensions.get(name)
        if (!attribute) { additions.push(name + '={' + target + '}'); continue }
        if (attribute.literal === undefined) {
            throw new Error('Cannot safely sync root Board ' + name + ': its value is computed as ' + attribute.expression + '. Set it to a numeric literal first.')
        }
        edits.push({ start: tagStart + attribute.valueStart, end: tagStart + attribute.valueEnd, text: String(target) })
    }
    let result = source
    for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
    if (additions.length > 0) {
        const originalCloseAt = tagEnd - (source[tagEnd - 2] === '/' ? 2 : 1)
        let originalInsertAt = originalCloseAt
        while (/\s/.test(source[originalInsertAt - 1] ?? '')) originalInsertAt -= 1
        const closingWhitespace = source.slice(originalInsertAt, originalCloseAt)
        const shift = edits.reduce((total, edit) => total + (edit.text.length - (edit.end - edit.start)), 0)
        const insertAt = originalInsertAt + shift
        const closeAt = originalCloseAt + shift
        result = result.slice(0, insertAt) + ' ' + additions.join(' ') + closingWhitespace + result.slice(closeAt)
    }
    return result
}

interface BoardAttribute { literal?: number; expression: string; valueStart: number; valueEnd: number }
interface BoardAttributes {
    dimensions: Map<'width' | 'height', BoardAttribute>
    duplicates: Set<'width' | 'height'>
    spreads: string[]
}

function readBoardAttributes(tag: string): BoardAttributes {
    const dimensions = new Map<'width' | 'height', BoardAttribute>()
    const duplicates = new Set<'width' | 'height'>()
    const spreads: string[] = []
    let index = tag.indexOf('Board') + 5
    while (index < tag.length) {
        while (/\s/.test(tag[index] ?? '')) index += 1
        if (tag[index] === '>' || tag[index] === '/') break
        if (tag[index] === '{') {
            const close = matchingBrace(tag, index)
            if (close < 0) break
            const expression = tag.slice(index + 1, close).trim()
            if (expression.startsWith('...')) spreads.push('{'+ expression + '}')
            index = close + 1
            continue
        }
        const nameStart = index
        while (/[$\w:-]/.test(tag[index] ?? '')) index += 1
        if (nameStart === index) { index += 1; continue }
        const name = tag.slice(nameStart, index)
        while (/\s/.test(tag[index] ?? '')) index += 1
        if (tag[index] !== '=') continue
        index += 1
        while (/\s/.test(tag[index] ?? '')) index += 1
        let contentStart = index
        let contentEnd: number
        if (tag[index] === '{') {
            const close = matchingBrace(tag, index)
            if (close < 0) break
            contentStart = index + 1
            contentEnd = close
            index = close + 1
        } else if (tag[index] === '"' || tag[index] === "'") {
            const quote = tag[index++]
            contentStart = index
            while (index < tag.length && tag[index] !== quote) index += 1
            contentEnd = index
            if (tag[index] === quote) index += 1
        } else {
            while (index < tag.length && !/[\s>]/.test(tag[index] ?? '')) index += 1
            contentEnd = index
        }
        if (name !== 'width' && name !== 'height') continue
        const expression = tag.slice(contentStart, contentEnd).trim()
        const literal = /^\d+$/.test(expression) && Number(expression) >= 1 && Number(expression) <= 8192
            ? Number(expression) : undefined
        if (dimensions.has(name)) duplicates.add(name)
        dimensions.set(name, { literal, expression, valueStart: contentStart, valueEnd: contentEnd })
    }
    return { dimensions, duplicates, spreads }
}

function findTagEnd(source: string, start: number): number {
    let quote: '"' | "'" | '`' | undefined
    let escaped = false
    let braces = 0
    for (let index = start + 1; index < source.length; index += 1) {
        const char = source[index]
        if (quote) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === quote) quote = undefined
        } else if (char === '"' || char === "'" || char === '`') quote = char
        else if (char === '{') braces += 1
        else if (char === '}') braces = Math.max(0, braces - 1)
        else if (char === '>' && braces === 0) return index + 1
    }
    return -1
}

function matchingBrace(source: string, start: number): number {
    let depth = 0
    let quote: '"' | "'" | '`' | undefined
    let escaped = false
    for (let index = start; index < source.length; index += 1) {
        const char = source[index]
        if (quote) {
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === quote) quote = undefined
        } else if (char === '"' || char === "'" || char === '`') quote = char
        else if (char === '{') depth += 1
        else if (char === '}' && --depth === 0) return index
    }
    return -1
}
