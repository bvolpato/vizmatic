import type { GraphDiagramEdge, GraphDiagramNode } from './primitives/diagrams'
import {
    addImportDiagnostic,
    graphImportResult,
    type GraphImportDiagnostic,
    type GraphImportDirection,
    type GraphImportResult,
} from './import-types'

interface D2NodeState {
    node: GraphDiagramNode
}

function decodeD2Label(raw: string): string | undefined {
    const value = raw.trim()
    if (value.startsWith('"')) {
        if (!value.endsWith('"')) return undefined
        try {
            const decoded = JSON.parse(value) as unknown
            return typeof decoded === 'string' ? decoded : undefined
        } catch {
            return undefined
        }
    }
    if (value.startsWith("'")) {
        if (!value.endsWith("'")) return undefined
        return value.slice(1, -1).replace(/\\(['\\])/g, '$1')
    }
    return value
}

function hasMarkdownFormatting(label: string): boolean {
    return /<[^>]*>|`|\*\*|__|~~|(^|\s)\*[^*]|\b_[^_]+_\b|\[[^\]]+\]\(|(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s)/.test(label)
}

function hasUnquotedHash(line: string): boolean {
    let quote: '"' | "'" | undefined
    let escaped = false
    for (const character of line) {
        if (quote) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === quote) quote = undefined
            continue
        }
        if (character === '"' || character === "'") quote = character
        else if (character === '#') return true
    }
    return false
}

function addNode(
    nodes: Map<string, D2NodeState>,
    id: string,
    label: string,
    line: number,
    sourceLines: string[],
    diagnostics: GraphImportDiagnostic[],
    explicitLabel: boolean,
): boolean {
    if (hasMarkdownFormatting(label)) {
        addImportDiagnostic(
            diagnostics,
            sourceLines,
            line,
            'import.unsupported_semantics',
            'error',
            `D2 label for "${id}" uses Markdown or HTML formatting that GraphDiagram cannot preserve.`,
        )
        return false
    }

    const existing = nodes.get(id)
    if (existing) {
        if (explicitLabel) {
            existing.node.label = label
        }
    } else {
        nodes.set(id, { node: { id, label } })
    }
    return true
}

function reportUnsupported(
    diagnostics: GraphImportDiagnostic[],
    sourceLines: string[],
    line: number,
    message: string,
    code: 'import.parse_error' | 'import.unsupported_semantics' | 'import.unsupported_syntax' = 'import.unsupported_syntax',
    column = 1,
): void {
    addImportDiagnostic(diagnostics, sourceLines, line, code, 'error', message, column)
}

/**
 * Import a safe subset of D2 text diagrams. The accepted syntax and explicit
 * reductions are documented in docs/import.md; unsupported blocks and fields
 * suppress `graph` rather than returning a partial diagram.
 */
export function importD2Graph(source: string): GraphImportResult {
    const sourceLines = source.split(/\r?\n/)
    const diagnostics: GraphImportDiagnostic[] = []
    const nodesById = new Map<string, D2NodeState>()
    const edges: GraphDiagramEdge[] = []
    const shapes = new Map<string, { value: string; line: number }>()
    let direction: GraphImportDirection = 'TB'
    let containerDepth = 0

    for (let index = 0; index < sourceLines.length; index++) {
        const lineNumber = index + 1
        const rawLine = sourceLines[index] ?? ''
        const line = rawLine.trim()
        if (!line) continue
        if (containerDepth > 0) {
            const opens = (rawLine.match(/\{/g) ?? []).length
            const closes = (rawLine.match(/\}/g) ?? []).length
            containerDepth = Math.max(0, containerDepth + opens - closes)
            continue
        }
        if (line.startsWith('#')) continue
        if (hasUnquotedHash(line)) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 inline comments and unquoted # text are not supported; use a comment line or quote the label.')
            continue
        }
        if (line.includes(';')) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 semicolon-separated statements are not supported; place one statement on each line.')
            continue
        }
        if (line.includes('{') || line.includes('}')) {
            reportUnsupported(
                diagnostics,
                sourceLines,
                lineNumber,
                'D2 containers and object-property blocks are not imported. Their contents are skipped to avoid treating nested shapes as top-level nodes.',
                'import.unsupported_semantics',
            )
            const opens = (rawLine.match(/\{/g) ?? []).length
            const closes = (rawLine.match(/\}/g) ?? []).length
            containerDepth = Math.max(0, opens - closes)
            continue
        }

        const directionMatch = line.match(/^direction\s*:\s*(right|left|down|up)\s*$/i)
        if (directionMatch) {
            const value = directionMatch[1]?.toLowerCase()
            direction = value === 'left' ? 'RL' : value === 'down' ? 'TB' : value === 'up' ? 'BT' : 'LR'
            continue
        }
        if (/^direction\b/i.test(line)) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 direction must be right, left, down, or up.', 'import.parse_error')
            continue
        }

        const shapeMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\.shape\s*:\s*(.*?)\s*$/)
        if (shapeMatch) {
            const id = shapeMatch[1]
            const shape = decodeD2Label(shapeMatch[2] ?? '')
            if (!id || shape === undefined || shape === '') {
                reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 shape declaration needs a simple identifier and a shape value.', 'import.parse_error')
                continue
            }
            if (!nodesById.has(id)) addNode(nodesById, id, id, lineNumber, sourceLines, diagnostics, false)
            shapes.set(id, { value: shape, line: lineNumber })
            continue
        }

        const edgeMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*?)\s*(<->|->|<-|--)\s*([A-Za-z_][A-Za-z0-9_-]*?)(?:\s*:\s*(.*))?\s*$/)
        if (edgeMatch) {
            const from = edgeMatch[1]
            const connector = edgeMatch[2]
            const to = edgeMatch[3]
            const rawLabel = edgeMatch[4]
            if (!from || !connector || !to) continue
            let label: string | undefined
            if (rawLabel !== undefined) {
                label = decodeD2Label(rawLabel)
                if (label === undefined) {
                    reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 connection label has invalid quotes.', 'import.parse_error')
                    continue
                }
                if (hasMarkdownFormatting(label)) {
                    reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 connection labels with Markdown or HTML formatting cannot be represented as plain GraphDiagram labels.', 'import.unsupported_semantics')
                    continue
                }
            }
            addNode(nodesById, from, from, lineNumber, sourceLines, diagnostics, false)
            addNode(nodesById, to, to, lineNumber, sourceLines, diagnostics, false)
            edges.push({
                from,
                to,
                ...(label !== undefined ? { label } : {}),
                arrow: connector === '<->' ? 'both' : connector === '<-' ? 'backward' : connector === '--' ? 'none' : 'forward',
            })
            continue
        }

        const nodeMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)(?:\s*:\s*(.*))?$/)
        if (nodeMatch) {
            const id = nodeMatch[1]
            const rawLabel = nodeMatch[2]
            if (!id) continue
            let label = id
            let explicitLabel = false
            if (rawLabel !== undefined) {
                const decoded = decodeD2Label(rawLabel)
                if (decoded === undefined) {
                    reportUnsupported(diagnostics, sourceLines, lineNumber, `D2 label for "${id}" has invalid quotes.`, 'import.parse_error')
                    continue
                }
                label = decoded
                explicitLabel = true
            }
            addNode(nodesById, id, label, lineNumber, sourceLines, diagnostics, explicitLabel)
            continue
        }

        if (line.includes('.style') || line.includes('.width') || line.includes('.height') || line.includes('.near')) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 styling, sizing, and positioning fields are not imported.', 'import.unsupported_semantics')
        } else if (/^[A-Za-z_][A-Za-z0-9_-]*\./.test(line)) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'D2 dotted paths and shape properties are not supported outside the simple `.shape` declaration.')
        } else if (/(?:<->|->|<-|--)/.test(line)) {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'Only one D2 connection between two simple identifiers per line is supported; chaining and connection properties are not imported.')
        } else {
            reportUnsupported(diagnostics, sourceLines, lineNumber, 'Could not parse this D2 statement in the supported subset.', 'import.parse_error')
        }
    }

    if (containerDepth > 0) {
        reportUnsupported(diagnostics, sourceLines, sourceLines.length, 'D2 object-property block has no matching closing brace.', 'import.parse_error')
    }
    for (const [id, { value, line }] of shapes) {
        if (value.toLowerCase() === 'rectangle') continue
        addImportDiagnostic(
            diagnostics,
            sourceLines,
            line,
            'import.lossy_semantics',
            'warning',
            `D2 shape "${value}" on "${id}" is reduced to a generic GraphDiagram node.`,
        )
    }

    return graphImportResult('d2', {
        nodes: [...nodesById.values()].map(({ node }) => node),
        edges,
        groups: [],
        direction,
    }, diagnostics)
}
