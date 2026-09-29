import { describe, expect, it } from 'vitest'
import { importD2Graph } from '../src/import-d2'
import { importMermaidGraph } from '../src/import-mermaid'

describe('diagram import adapters', () => {
    it('imports Mermaid nodes, labeled edges, direction, and one-level subgraphs', () => {
        const result = importMermaidGraph(`flowchart LR
A[Client] -->|request| B[(Database)]
subgraph workers [Workers]
  C[Queue] -.-> D{Ready?}
end`)

        expect(result.ok).toBe(true)
        expect(result.graph).toMatchObject({
            direction: 'LR',
            nodes: [
                { id: 'A', label: 'Client' },
                { id: 'B', label: 'Database' },
                { id: 'C', label: 'Queue', group: 'workers' },
                { id: 'D', label: 'Ready?', group: 'workers' },
            ],
            edges: [
                { from: 'A', to: 'B', label: 'request', arrow: 'forward' },
                { from: 'C', to: 'D', arrow: 'forward', style: 'dotted' },
            ],
            groups: [{ id: 'workers', label: 'Workers' }],
        })
        expect(result.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'import.lossy_semantics', severity: 'warning', line: 2 }),
            expect.objectContaining({ code: 'import.lossy_semantics', severity: 'warning', line: 4 }),
        ]))
    })

    it('imports the D2 connection forms and maps direction', () => {
        const result = importD2Graph(`direction: down
web: Web client
api: API
db: Database
web -> api: request
api <- db: response
web <-> db
db -- cache
db.shape: cylinder`)

        expect(result.ok).toBe(true)
        expect(result.graph).toMatchObject({
            direction: 'TB',
            nodes: [
                { id: 'web', label: 'Web client' },
                { id: 'api', label: 'API' },
                { id: 'db', label: 'Database' },
                { id: 'cache', label: 'cache' },
            ],
            edges: [
                { from: 'web', to: 'api', label: 'request', arrow: 'forward' },
                { from: 'api', to: 'db', label: 'response', arrow: 'backward' },
                { from: 'web', to: 'db', arrow: 'both' },
                { from: 'db', to: 'cache', arrow: 'none' },
            ],
            groups: [],
        })
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.lossy_semantics',
            severity: 'warning',
            message: expect.stringContaining('cylinder'),
        }))

        expect(importD2Graph('a -> b').graph?.direction).toBe('TB')
        expect(importD2Graph('api-gateway->db-primary').graph).toMatchObject({
            nodes: [{ id: 'api-gateway' }, { id: 'db-primary' }],
            edges: [{ from: 'api-gateway', to: 'db-primary', arrow: 'forward' }],
        })
        expect(importD2Graph('db.shape: cylinder\ndb.shape: rectangle').diagnostics).toEqual([])
    })

    it('does not return a partial Mermaid graph for unsupported semantics', () => {
        const result = importMermaidGraph(`flowchart LR
A --> B
classDef service fill:#fff`)

        expect(result.ok).toBe(false)
        expect(result.graph).toBeUndefined()
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.unsupported_semantics',
            severity: 'error',
            line: 3,
        }))
    })

    it('does not flatten D2 containers or formatted labels silently', () => {
        const container = importD2Graph(`cloud: Cloud {
  api: API
}`)
        expect(container.ok).toBe(false)
        expect(container.graph).toBeUndefined()
        expect(container.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.unsupported_semantics',
        }))

        const formatted = importD2Graph('service: "**bold**"')
        expect(formatted.ok).toBe(false)
        expect(formatted.graph).toBeUndefined()
        expect(formatted.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.unsupported_semantics',
        }))
    })

    it('does not return a partial D2 graph for chained or styled statements', () => {
        const chained = importD2Graph('a -> b -> c')
        expect(chained.ok).toBe(false)
        expect(chained.graph).toBeUndefined()
        expect(chained.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.unsupported_syntax',
            severity: 'error',
            line: 1,
        }))

        const styled = importD2Graph('api.style.fill: "#ffffff"')
        expect(styled.ok).toBe(false)
        expect(styled.graph).toBeUndefined()
        expect(styled.diagnostics).toContainEqual(expect.objectContaining({
            code: 'import.unsupported_semantics',
            severity: 'error',
        }))
    })
})
