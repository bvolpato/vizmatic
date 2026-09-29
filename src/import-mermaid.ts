import type { GraphDiagramEdge, GraphDiagramGroup, GraphDiagramNode } from './primitives/diagrams'
import {
    addImportDiagnostic,
    graphImportResult,
    type GraphImportDiagnostic,
    type GraphImportDirection,
    type GraphImportResult,
} from './import-types'

interface MermaidEndpoint {
    id: string
    label: string
    shape: 'rectangle' | 'lossy'
    next: number
}

interface MermaidImportState {
    nodes: GraphDiagramNode[]
    nodeIndexes: Map<string, number>
    groups: GraphDiagramGroup[]
    groupIds: Set<string>
    edges: GraphDiagramEdge[]
    edgeReferences: Array<{ id: string; line: number }>
    warnedShapes: Set<string>
}

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*/
const CONNECTORS = ['-.->', '-->', '---'] as const

function skipWhitespace(line: string, index: number): number {
    while (index < line.length && /\s/.test(line[index] ?? '')) index++
    return index
}

function readDelimited(line: string, start: number, close: string): { value: string; next: number } | undefined {
    let inDoubleQuote = false
    let escaped = false
    for (let index = start; index < line.length; index++) {
        const character = line[index]
        if (inDoubleQuote) {
            if (escaped) escaped = false
            else if (character === '\\') escaped = true
            else if (character === '"') inDoubleQuote = false
            continue
        }
        if (character === '"') {
            inDoubleQuote = true
            continue
        }
        if (line.startsWith(close, index)) {
            return { value: line.slice(start, index), next: index + close.length }
        }
    }
    return undefined
}

function decodeLabel(raw: string): string | undefined {
    const value = raw.trim()
    if (!value.startsWith('"')) return value
    if (!value.endsWith('"')) return undefined
    try {
        const decoded = JSON.parse(value) as unknown
        return typeof decoded === 'string' ? decoded : undefined
    } catch {
        return undefined
    }
}

function labelHasUnsupportedMarkup(label: string): boolean {
    return /<[^>]*>|`|\*\*|__|~~|(^|\s)\*[^*]|\b_[^_]+_\b|\n|\r/.test(label)
}

function readEndpoint(line: string, from: number): MermaidEndpoint | undefined {
    let index = skipWhitespace(line, from)
    const id = line.slice(index).match(ID_PATTERN)?.[0]
    if (!id) return undefined
    index += id.length
    const afterId = skipWhitespace(line, index)
    if (afterId >= line.length) return { id, label: id, shape: 'rectangle', next: afterId }

    const rest = line.slice(afterId)
    const delimiters: Array<{ open: string; close: string; lossy: boolean }> = [
        { open: '[(', close: ')]', lossy: true },
        { open: '([', close: '])', lossy: true },
        { open: '((', close: '))', lossy: true },
        { open: '{{', close: '}}', lossy: true },
        { open: '[', close: ']', lossy: false },
        { open: '(', close: ')', lossy: true },
        { open: '{', close: '}', lossy: true },
    ]
    const delimiter = delimiters.find(({ open }) => rest.startsWith(open))
    if (!delimiter) return { id, label: id, shape: 'rectangle', next: index }
    const content = readDelimited(line, afterId + delimiter.open.length, delimiter.close)
    if (!content) return undefined
    const label = decodeLabel(content.value)
    if (label === undefined) return undefined
    return {
        id,
        label,
        shape: delimiter.lossy ? 'lossy' : 'rectangle',
        next: content.next,
    }
}

function addNode(
    state: MermaidImportState,
    endpoint: MermaidEndpoint,
    groupId: string | undefined,
    line: number,
    sourceLines: string[],
    diagnostics: GraphImportDiagnostic[],
    explicitlyDeclared: boolean,
): boolean {
    if (state.groupIds.has(endpoint.id)) {
        addImportDiagnostic(
            diagnostics,
            sourceLines,
            line,
            'import.unsupported_semantics',
            'error',
            `Mermaid id "${endpoint.id}" is already used by a subgraph and cannot also be a node.`,
        )
        return false
    }
    if (labelHasUnsupportedMarkup(endpoint.label)) {
        addImportDiagnostic(
            diagnostics,
            sourceLines,
            line,
            'import.unsupported_semantics',
            'error',
            `Mermaid label for node "${endpoint.id}" uses HTML or Markdown formatting that GraphDiagram cannot preserve.`,
        )
        return false
    }

    const existingIndex = state.nodeIndexes.get(endpoint.id)
    if (existingIndex !== undefined) {
        const existing = state.nodes[existingIndex]
        if (!existing) return false
        if (groupId && existing.group && existing.group !== groupId) {
            addImportDiagnostic(
                diagnostics,
                sourceLines,
                line,
                'import.unsupported_semantics',
                'error',
                `Mermaid node "${endpoint.id}" is assigned to more than one subgraph; GraphDiagram nodes support one group.`,
            )
            return false
        }
        if (groupId && !existing.group) {
            addImportDiagnostic(
                diagnostics,
                sourceLines,
                line,
                'import.unsupported_semantics',
                'error',
                `Mermaid node "${endpoint.id}" is referenced both inside and outside a subgraph; its group membership is ambiguous.`,
            )
            return false
        }
        if (explicitlyDeclared) existing.label = endpoint.label
    } else {
        state.nodeIndexes.set(endpoint.id, state.nodes.length)
        state.nodes.push({
            id: endpoint.id,
            label: endpoint.label,
            ...(groupId ? { group: groupId } : {}),
        })
    }

    if (endpoint.shape === 'lossy' && !state.warnedShapes.has(endpoint.id)) {
        state.warnedShapes.add(endpoint.id)
        addImportDiagnostic(
            diagnostics,
            sourceLines,
            line,
            'import.lossy_semantics',
            'warning',
            `Mermaid node "${endpoint.id}" uses a non-rectangular shape; it will render as a generic GraphDiagram node.`,
        )
    }
    return true
}

function parseNodeOrEdgeLine(
    line: string,
    groupId: string | undefined,
    lineNumber: number,
    sourceLines: string[],
    state: MermaidImportState,
    diagnostics: GraphImportDiagnostic[],
): void {
    const first = readEndpoint(line, 0)
    if (!first) {
        addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.parse_error', 'error', 'Could not parse this Mermaid node or edge statement.')
        return
    }
    const connectorStart = skipWhitespace(line, first.next)
    const hasConnector = CONNECTORS.some((connector) => line.startsWith(connector, connectorStart))
    if (!addNode(state, first, groupId, lineNumber, sourceLines, diagnostics, !hasConnector)) return

    let previous = first
    let cursor = first.next
    while (true) {
        cursor = skipWhitespace(line, cursor)
        if (cursor >= line.length) return
        const connector = CONNECTORS.find((candidate) => line.startsWith(candidate, cursor))
        if (!connector) {
            addImportDiagnostic(
                diagnostics,
                sourceLines,
                lineNumber,
                'import.unsupported_syntax',
                'error',
                'Only Mermaid -->, ---, and -.-> connections are supported; chained or styled statements must be split or simplified.',
                cursor + 1,
            )
            return
        }
        cursor += connector.length
        cursor = skipWhitespace(line, cursor)

        let edgeLabel: string | undefined
        if (line[cursor] === '|') {
            const end = line.indexOf('|', cursor + 1)
            if (end < 0) {
                addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.parse_error', 'error', 'Mermaid edge label is missing its closing |.', cursor + 1)
                return
            }
            edgeLabel = line.slice(cursor + 1, end).trim()
            cursor = skipWhitespace(line, end + 1)
            if (labelHasUnsupportedMarkup(edgeLabel)) {
                addImportDiagnostic(
                    diagnostics,
                    sourceLines,
                    lineNumber,
                    'import.unsupported_semantics',
                    'error',
                    'Mermaid edge labels with HTML or Markdown formatting cannot be represented as plain GraphDiagram labels.',
                    cursor + 1,
                )
                return
            }
        }

        const next = readEndpoint(line, cursor)
        if (!next) {
            addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.parse_error', 'error', 'Mermaid connection has no supported target node.', cursor + 1)
            return
        }
        if (!addNode(state, next, groupId, lineNumber, sourceLines, diagnostics, false)) return

        const edge: GraphDiagramEdge = {
            from: previous.id,
            to: next.id,
            ...(edgeLabel !== undefined ? { label: edgeLabel } : {}),
            ...(connector === '---'
                ? { arrow: 'none' as const }
                : connector === '-.->'
                    ? { arrow: 'forward' as const, style: 'dotted' as const }
                    : { arrow: 'forward' as const }),
        }
        state.edges.push(edge)
        state.edgeReferences.push({ id: previous.id, line: lineNumber }, { id: next.id, line: lineNumber })
        previous = next
        cursor = next.next
    }
}

/**
 * Import the conservative Mermaid flowchart subset documented in docs/import.md.
 * Unsupported constructs produce errors and suppress `graph`; accepted shape
 * reductions produce warnings that callers can show before rendering.
 */
export function importMermaidGraph(source: string): GraphImportResult {
    const sourceLines = source.split(/\r?\n/)
    const diagnostics: GraphImportDiagnostic[] = []
    const state: MermaidImportState = {
        nodes: [],
        nodeIndexes: new Map(),
        groups: [],
        groupIds: new Set(),
        edges: [],
        edgeReferences: [],
        warnedShapes: new Set(),
    }
    let direction: GraphImportDirection = 'TB'
    let currentGroup: string | undefined
    let sawHeader = false

    for (let index = 0; index < sourceLines.length; index++) {
        const lineNumber = index + 1
        const rawLine = sourceLines[index] ?? ''
        const line = rawLine.trim()
        if (!line) continue
        if (line.startsWith('%%{')) {
            addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_semantics', 'error', 'Mermaid directives and embedded configuration are not imported.')
            continue
        }
        if (line.startsWith('%%')) continue

        if (!sawHeader) {
            const header = line.match(/^(?:flowchart|graph)(?:\s+(LR|RL|TB|TD|BT))?$/i)
            if (!header) {
                addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.parse_error', 'error', 'Expected a Mermaid flowchart or graph header such as "flowchart LR".')
                sawHeader = true
                continue
            }
            sawHeader = true
            const sourceDirection = header[1]?.toUpperCase()
            direction = sourceDirection === 'TD' ? 'TB' : sourceDirection as GraphImportDirection | undefined ?? 'TB'
            continue
        }

        const subgraph = line.match(/^subgraph\s+([A-Za-z_][A-Za-z0-9_-]*)(?:\s+\[([^\]]*)\])?\s*$/i)
        if (subgraph) {
            if (currentGroup) {
                addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_semantics', 'error', 'Nested Mermaid subgraphs are not imported.')
                continue
            }
            const id = subgraph[1]
            if (!id) continue
            if (state.groupIds.has(id) || state.nodeIndexes.has(id)) {
                addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_semantics', 'error', `Mermaid subgraph id "${id}" conflicts with an existing group or node.`)
                continue
            }
            const rawLabel = subgraph[2]
            const label = rawLabel === undefined ? id : decodeLabel(rawLabel)
            if (label === undefined || labelHasUnsupportedMarkup(label)) {
                addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_semantics', 'error', `Mermaid subgraph "${id}" uses a label format that cannot be preserved.`)
                continue
            }
            currentGroup = id
            state.groupIds.add(id)
            state.groups.push({ id, label })
            continue
        }

        if (/^subgraph\b/i.test(line)) {
            addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_syntax', 'error', 'Use a simple Mermaid subgraph declaration with an identifier and optional bracketed label.')
            continue
        }

        if (/^end\s*$/i.test(line)) {
            if (!currentGroup) addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.parse_error', 'error', 'Mermaid end has no matching subgraph.')
            else currentGroup = undefined
            continue
        }

        if (/^direction\b/i.test(line)) {
            addImportDiagnostic(
                diagnostics,
                sourceLines,
                lineNumber,
                currentGroup ? 'import.unsupported_semantics' : 'import.parse_error',
                'error',
                currentGroup
                    ? 'Per-subgraph Mermaid direction cannot be represented by GraphDiagram.'
                    : 'Set Mermaid graph direction in the flowchart or graph header.',
            )
            continue
        }

        if (/^(?:click|class|classDef|style|linkStyle|accTitle|accDescr)\b/i.test(line)) {
            addImportDiagnostic(diagnostics, sourceLines, lineNumber, 'import.unsupported_semantics', 'error', 'Mermaid classes, styling, accessibility directives, and click actions are not imported.')
            continue
        }

        parseNodeOrEdgeLine(line, currentGroup, lineNumber, sourceLines, state, diagnostics)
    }

    if (!sawHeader) {
        addImportDiagnostic(diagnostics, sourceLines, 1, 'import.parse_error', 'error', 'Missing Mermaid flowchart or graph header.')
    }
    if (currentGroup) {
        addImportDiagnostic(diagnostics, sourceLines, sourceLines.length, 'import.parse_error', 'error', `Mermaid subgraph "${currentGroup}" has no matching end.`)
    }
    for (const reference of state.edgeReferences) {
        if (state.groupIds.has(reference.id)) {
            addImportDiagnostic(
                diagnostics,
                sourceLines,
                reference.line,
                'import.unsupported_semantics',
                'error',
                `Mermaid edges to or from subgraph "${reference.id}" cannot be represented as GraphDiagram node edges.`,
            )
        }
    }

    const graph = {
        nodes: state.nodes,
        edges: state.edges,
        groups: state.groups,
        direction,
    }
    return graphImportResult('mermaid', graph, diagnostics)
}
