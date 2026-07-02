width = 1040;
height = 560;

<Scene title="Attention head as a routed circuit" subtitle="QK scores choose which value vectors matter" align="center">
    <LayeredNetwork
        width={900}
        height={390}
        activePath={[1, 2, 1, 1]}
        annotations={['query token', 'key match', 'weighted values']}
        formula="softmax(QK^T / sqrt(d_k))V"
        layers={[
            { title: 'tokens', nodes: ['the', 'model', 'routes'], tone: 'blue' },
            { title: 'Q/K', nodes: ['q_0', 'q_1', 'q_2', 'k_2'], tone: 'purple' },
            { title: 'scores', nodes: ['0.08', '0.74', '0.18'], tone: 'cyan' },
            { title: 'output', nodes: ['context'], tone: 'green' },
        ]}
    />
</Scene>
