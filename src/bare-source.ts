interface JsxTag {
    closing: boolean
    end: number
    selfClosing: boolean
}

function readJsxTag(source: string, start: number): JsxTag | undefined {
    if (source.startsWith('<>', start)) return { closing: false, end: start + 2, selfClosing: false }
    if (source.startsWith('</>', start)) return { closing: true, end: start + 3, selfClosing: false }

    const head = source.slice(start).match(/^<\s*(\/\s*)?[A-Za-z][\w.:$-]*/)
    if (!head) return undefined

    const closing = Boolean(head[1])
    let quote: '"' | "'" | '`' | undefined
    let braces = 0
    let escaped = false

    for (let index = start + head[0].length; index < source.length; index += 1) {
        const character = source[index]
        if (quote) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === quote) quote = undefined
            continue
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character
            continue
        }
        if (character === '{') {
            braces += 1
            continue
        }
        if (character === '}') {
            braces = Math.max(0, braces - 1)
            continue
        }
        if (character !== '>' || braces > 0) continue

        const beforeClose = source.slice(start, index).trimEnd()
        return {
            closing,
            end: index + 1,
            selfClosing: !closing && beforeClose.endsWith('/'),
        }
    }

    return undefined
}

function skipJsxExpression(source: string, start: number): number | undefined {
    let depth = 0
    let quote: '"' | "'" | '`' | undefined
    let escaped = false
    let blockComment = false
    let lineComment = false

    for (let index = start; index < source.length; index += 1) {
        const character = source[index]
        const next = source[index + 1]
        if (lineComment) {
            if (character === '\n') lineComment = false
            continue
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false
                index += 1
            }
            continue
        }
        if (quote) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === quote) quote = undefined
            continue
        }
        if (character === '/' && next === '/') {
            lineComment = true
            index += 1
            continue
        }
        if (character === '/' && next === '*') {
            blockComment = true
            index += 1
            continue
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character
            continue
        }
        if (character === '{') depth += 1
        else if (character === '}' && --depth === 0) return index + 1
    }

    return undefined
}

function findJsxEnd(source: string, start: number): number | undefined {
    let depth = 0
    for (let index = start; index < source.length; index += 1) {
        if (source[index] === '{') {
            const expressionEnd = skipJsxExpression(source, index)
            if (expressionEnd == null) return undefined
            index = expressionEnd - 1
            continue
        }
        if (source[index] !== '<') continue
        const tag = readJsxTag(source, index)
        if (!tag) continue

        if (tag.closing) depth -= 1
        else if (!tag.selfClosing) depth += 1
        index = tag.end - 1
        if (depth === 0) return tag.end
    }
    return undefined
}

function hasOnlyTrailingSyntax(source: string): boolean {
    let index = 0
    while (index < source.length) {
        const rest = source.slice(index)
        const whitespace = rest.match(/^[\s;)]*/)?.[0].length ?? 0
        index += whitespace
        if (source.startsWith('//', index)) {
            const newline = source.indexOf('\n', index + 2)
            index = newline < 0 ? source.length : newline + 1
            continue
        }
        if (source.startsWith('/*', index)) {
            const end = source.indexOf('*/', index + 2)
            if (end < 0) return false
            index = end + 2
            continue
        }
        return index >= source.length
    }
    return true
}

export function findBareRootJsxStart(source: string): number {
    const candidates = source.matchAll(/(^|\n)([\t ]*)(?:(?:export\s+default\s+)?(?:\(\s*)*)(<(?:[A-Z]|>))/g)
    for (const candidate of candidates) {
        if (candidate.index == null) continue
        const lineStart = candidate.index + (candidate[1]?.length ?? 0)
        const expressionStart = lineStart + (candidate[2]?.length ?? 0)
        const jsxStart = candidate.index + candidate[0].lastIndexOf(candidate[3] ?? '<')
        const jsxEnd = findJsxEnd(source, jsxStart)
        if (jsxEnd != null && hasOnlyTrailingSyntax(source.slice(jsxEnd))) return expressionStart
    }
    return -1
}
