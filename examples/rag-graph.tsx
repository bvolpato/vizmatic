width = 1040;
height = 560;

<Scene title="RAG control graph" subtitle="retrieval is a graph, not a linear prompt append" align="center">
    <GraphDiagram
        width={820}
        height={390}
        nodeWidth={150}
        nodes={[
            { id: 'query', label: 'Query', detail: 'user intent', x: 0.08, y: 0.52, tone: 'blue' },
            { id: 'rewrite', label: 'Rewrite', detail: 'search form', x: 0.30, y: 0.25, tone: 'purple' },
            { id: 'retrieve', label: 'Retrieve', detail: 'top-k docs', x: 0.52, y: 0.25, tone: 'cyan' },
            { id: 'rerank', label: 'Rerank', detail: 'cross-encoder', x: 0.74, y: 0.25, tone: 'warm' },
            { id: 'answer', label: 'Answer', detail: 'grounded draft', x: 0.92, y: 0.52, tone: 'green' },
            { id: 'verify', label: 'Verify', detail: 'citations', x: 0.52, y: 0.78, tone: 'critical' },
        ]}
        edges={[
            { from: 'query', to: 'rewrite', label: 'normalize', tone: 'blue' },
            { from: 'rewrite', to: 'retrieve', label: 'search', tone: 'purple' },
            { from: 'retrieve', to: 'rerank', label: 'rank', tone: 'cyan' },
            { from: 'rerank', to: 'answer', label: 'context', tone: 'green' },
            { from: 'answer', to: 'verify', label: 'claims', tone: 'critical' },
            { from: 'verify', to: 'retrieve', label: 'retry', dashed: true, tone: 'warm' },
            { from: 'query', to: 'answer', label: 'direct?', muted: true },
        ]}
    />
</Scene>
