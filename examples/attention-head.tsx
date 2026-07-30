width = 1040;
height = 560;

<Scene title="One attention head, one context vector" subtitle="QKᵀ scores keys, then softmax weights their value vectors" align="center">
    <GraphDiagram
        width={900}
        height={360}
        nodeWidth={150}
        nodeHeight={66}
        labelFontSize={16}
        nodes={[
            { id: 'query', label: 'q_model', detail: 'query vector', x: 0.07, y: 0.50, tone: 'blue' },
            { id: 'scores', label: 'QKᵀ', detail: 'score all keys', x: 0.30, y: 0.50, tone: 'purple' },
            { id: 'weights', label: 'softmax', detail: '[0.08, 0.74, 0.18]', x: 0.52, y: 0.50, tone: 'cyan' },
            { id: 'v-the', label: 'V_the', detail: 'α = 0.08', x: 0.72, y: 0.22, tone: 'blue', muted: true },
            { id: 'v-model', label: 'V_model', detail: 'α = 0.74', x: 0.72, y: 0.50, tone: 'green' },
            { id: 'v-routes', label: 'V_routes', detail: 'α = 0.18', x: 0.72, y: 0.78, tone: 'cyan', muted: true },
            { id: 'context', label: 'context', detail: 'Σ αᵢVᵢ', x: 0.95, y: 0.50, tone: 'green', width: 138 },
        ]}
        edges={[
            { from: 'query', to: 'scores', tone: 'blue' },
            { from: 'scores', to: 'weights', tone: 'purple' },
            { from: 'weights', to: 'v-the', tone: 'blue', muted: true },
            { from: 'weights', to: 'v-model', tone: 'green' },
            { from: 'weights', to: 'v-routes', tone: 'cyan', muted: true },
            { from: 'v-the', to: 'context', muted: true },
            { from: 'v-model', to: 'context', tone: 'green' },
            { from: 'v-routes', to: 'context', muted: true },
        ]}
    />
</Scene>
