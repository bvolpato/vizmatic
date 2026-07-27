const KEYWORDS = new Set([
    'as',
    'async',
    'await',
    'const',
    'else',
    'export',
    'extends',
    'from',
    'function',
    'if',
    'import',
    'interface',
    'let',
    'new',
    'return',
    'satisfies',
    'type',
    'var',
])

const LITERALS = new Set(['false', 'null', 'true', 'undefined'])

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function token(kind: string, value: string): string {
    return `<span class="syntax-${kind}">${escapeHtml(value)}</span>`
}

function isIdentifierStart(value: string | undefined): boolean {
    return Boolean(value && /[A-Za-z_$]/.test(value))
}

function isIdentifierPart(value: string | undefined): boolean {
    return Boolean(value && /[\w$]/.test(value))
}

function nextNonSpace(source: string, index: number): string | undefined {
    while (/\s/.test(source[index] ?? '')) index += 1
    return source[index]
}

export function highlightPlaygroundSource(source: string): string {
    let output = ''
    let index = 0
    let inJsxTag = false
    let expectsTagName = false
    let jsxExpressionDepth = 0

    while (index < source.length) {
        const character = source[index]
        const next = source[index + 1]

        if (character === '/' && next === '/') {
            const end = source.indexOf('\n', index)
            const stop = end === -1 ? source.length : end
            output += token('comment', source.slice(index, stop))
            index = stop
            continue
        }

        if (character === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2)
            const stop = end === -1 ? source.length : end + 2
            output += token('comment', source.slice(index, stop))
            index = stop
            continue
        }

        if (character === '"' || character === "'" || character === '`') {
            const quote = character
            let stop = index + 1
            while (stop < source.length) {
                if (source[stop] === '\\') {
                    stop += 2
                    continue
                }
                if (source[stop] === quote) {
                    stop += 1
                    break
                }
                stop += 1
            }
            output += token('string', source.slice(index, stop))
            index = stop
            continue
        }

        if (character === '<' && (next === '/' || isIdentifierStart(next))) {
            inJsxTag = true
            expectsTagName = true
            output += token('operator', character)
            index += 1
            continue
        }

        if (inJsxTag && character === '{') {
            jsxExpressionDepth += 1
            output += token('operator', character)
            index += 1
            continue
        }

        if (inJsxTag && character === '}' && jsxExpressionDepth > 0) {
            jsxExpressionDepth -= 1
            output += token('operator', character)
            index += 1
            continue
        }

        if (inJsxTag && jsxExpressionDepth === 0 && character === '>') {
            inJsxTag = false
            output += token('operator', character)
            index += 1
            continue
        }

        if (isIdentifierStart(character)) {
            let stop = index + 1
            while (isIdentifierPart(source[stop])) stop += 1
            const value = source.slice(index, stop)
            const after = nextNonSpace(source, stop)

            if (expectsTagName) {
                output += token('tag', value)
                expectsTagName = false
            } else if (inJsxTag && after === '=') {
                output += token('attribute', value)
            } else if (KEYWORDS.has(value)) {
                output += token('keyword', value)
            } else if (LITERALS.has(value)) {
                output += token('literal', value)
            } else if (/^[A-Z]/.test(value)) {
                output += token('component', value)
            } else {
                output += escapeHtml(value)
            }
            index = stop
            continue
        }

        if (/\d/.test(character)) {
            let stop = index + 1
            while (/[\d._]/.test(source[stop] ?? '')) stop += 1
            output += token('number', source.slice(index, stop))
            index = stop
            continue
        }

        if ('{}[]=(),:;/>'.includes(character)) output += token('operator', character)
        else output += escapeHtml(character)
        index += 1
    }

    return output
}
