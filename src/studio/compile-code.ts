/** Turn hand-written film source into plain JavaScript. Nothing runs here. */
export interface CodeCompileResult {
    code?: string
    error?: { message: string; line?: number; column?: number }
}

type Transform = (source: string) => string

interface ParseProblem {
    message: string
    line: number
    column: number
}

function problemOf(error: unknown): ParseProblem {
    const message = error instanceof Error ? error.message : String(error)
    const match = /\((\d+):(\d+)\)/.exec(message)
    return { message: message.replace(/\s*\(\d+:\d+\)\s*$/, ''), line: Number(match?.[1] ?? 0), column: Number(match?.[2] ?? 0) }
}

function indexOf(source: string, line: number, column: number): number {
    let at = 0
    for (let current = 1; current < line; current++) {
        const next = source.indexOf('\n', at)
        if (next < 0) return source.length
        at = next + 1
    }
    return at + column
}

/**
 * When a parser cannot read an arrow function it backs up, then blames the arrow
 * instead of the real mistake inside its body. Rewriting that arrow as a plain
 * function on the same line lets it report the true line. A film's whole body is
 * usually one arrow function, so this matters on almost every syntax error.
 */
function locateInsideArrows(transform: Transform, source: string, first: ParseProblem): ParseProblem {
    let text = source
    let problem = first
    for (let attempt = 0; attempt < 16; attempt++) {
        const at = indexOf(text, problem.line, problem.column)
        const arrow = text.indexOf('=>', Math.max(0, at - 2))
        if (arrow < 0 || arrow > at + 2 || !/^=>\s*\{/.test(text.slice(arrow))) return problem
        let open = arrow - 1
        while (open >= 0 && /\s/.test(text[open]!)) open--
        if (text[open] !== ')') return problem
        let depth = 0
        let start = open
        for (; start >= 0; start--) {
            if (text[start] === ')') depth++
            else if (text[start] === '(' && --depth === 0) break
        }
        if (start < 0) return problem
        text = `${text.slice(0, start)}function ${text.slice(start, arrow)}  ${text.slice(arrow + 2)}`
        try {
            transform(text)
            return problem
        } catch (error) {
            problem = problemOf(error)
        }
    }
    return problem
}

export async function compileSource(source: string): Promise<CodeCompileResult> {
    const { transform } = await import('sucrase')
    // Sucrase keeps line numbers, so runtime errors point at the right line in the editor.
    const run: Transform = (text) => transform(text, { transforms: ['typescript', 'imports'], production: true, disableESTransforms: true }).code
    try {
        return { code: run(source) }
    } catch (error) {
        const located = locateInsideArrows(run, source, problemOf(error))
        return { error: { message: located.message, ...(located.line ? { line: located.line } : {}) } }
    }
}
