preset = "engineering";
width = 1040;
height = 600;

<Scene
    title="Why warm requests cost less"
    subtitle="Stable prefixes turn repeated context into cache reads"
    background={c.bg}
    gap={20}
>
    <GraphDiagram
        width={930}
        height={330}
        nodeWidth={180}
        nodeHeight={76}
        labelFontSize={17}
        nodes={[
            { id: 'prefix', label: 'Stable prefix', detail: 'instructions + tools', x: 0.10, y: 0.50, tone: 'blue' },
            { id: 'turn', label: 'Dynamic turn', detail: 'history + input', x: 0.38, y: 0.50, tone: 'warm' },
            { id: 'cache', label: 'Cache lookup', detail: 'match reusable bytes', x: 0.66, y: 0.50, tone: 'purple' },
            { id: 'model', label: 'Model response', detail: 'less uncached input', x: 0.92, y: 0.50, tone: 'green' },
        ]}
        edges={[
            { from: 'prefix', to: 'turn', label: 'append' },
            { from: 'turn', to: 'cache', label: 'send' },
            { from: 'cache', to: 'model', label: 'reuse' },
        ]}
    />
    <Row width="100%" gap={16} align="stretch">
        <MetricCard
            label="Warm cache read"
            value="84%"
            detail="after request-shape fix"
            tone="green"
            width={250}
            valueFontSize={25}
        />
        <MetricCard
            label="Uncached input"
            value="-71%"
            detail="per completed task"
            tone="purple"
            width={250}
            valueFontSize={25}
        />
        <CalloutCard
            title="Same model, lower cost"
            detail="Move volatile fields after reusable context and preserve provider cache controls."
            tone="blue"
            width={420}
            align="left"
        />
    </Row>
</Scene>
