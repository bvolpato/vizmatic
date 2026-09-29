import type {
    GraphDiagramEdge,
    GraphDiagramGroup,
    GraphDiagramNode,
} from './primitives/diagrams'

export type GraphImportSource = 'mermaid' | 'd2'

export type GraphImportDirection = 'LR' | 'RL' | 'TB' | 'BT'

export type GraphImportDiagnosticCode =
    | 'import.empty'
    | 'import.lossy_semantics'
    | 'import.parse_error'
    | 'import.unsupported_semantics'
    | 'import.unsupported_syntax'

export interface GraphImportDiagnostic {
    code: GraphImportDiagnosticCode
    severity: 'error' | 'warning'
    message: string
    line: number
    column: number
    excerpt: string
}

export interface GraphImportGraph {
    nodes: GraphDiagramNode[]
    edges: GraphDiagramEdge[]
    groups: GraphDiagramGroup[]
    direction: GraphImportDirection
}

/**
 * A parse result is renderable only when `ok` is true and `graph` is present.
 * Warnings describe explicit, accepted losses; errors omit the graph so callers
 * cannot accidentally render a partial interpretation.
 */
export interface GraphImportResult {
    source: GraphImportSource
    ok: boolean
    graph?: GraphImportGraph
    diagnostics: GraphImportDiagnostic[]
}

export function graphImportResult(
    source: GraphImportSource,
    graph: GraphImportGraph,
    diagnostics: GraphImportDiagnostic[],
): GraphImportResult {
    if (graph.nodes.length === 0 && diagnostics.every(({ severity }) => severity !== 'error')) {
        diagnostics.push({
            code: 'import.empty',
            severity: 'error',
            message: 'The source contains no graph nodes to import.',
            line: 1,
            column: 1,
            excerpt: '',
        })
    }

    const ok = diagnostics.every(({ severity }) => severity !== 'error')
    return ok
        ? { source, ok, graph, diagnostics }
        : { source, ok, diagnostics }
}

export function addImportDiagnostic(
    diagnostics: GraphImportDiagnostic[],
    sourceLines: string[],
    line: number,
    code: GraphImportDiagnosticCode,
    severity: GraphImportDiagnostic['severity'],
    message: string,
    column = 1,
): void {
    diagnostics.push({
        code,
        severity,
        message,
        line,
        column,
        excerpt: (sourceLines[line - 1] ?? '').trim().slice(0, 180),
    })
}
