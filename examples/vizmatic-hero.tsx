width = 1040;
height = 640;

<Scene
    title="From prompt to polished visual"
    gap={24}
>
    <GraphDiagram
        width={900}
        height={340}
        nodeWidth={170}
        nodeHeight={76}
        labelFontSize={19}
        arrowSize={7}
        nodes={[
            { id: 'brief', label: 'Agent prompt', x: 0.10, y: 0.50, tone: 'blue' },
            { id: 'primitives', label: 'Visual primitives', x: 0.36, y: 0.25, tone: 'purple' },
            { id: 'theme', label: 'Theme tokens', x: 0.36, y: 0.75, tone: 'cyan' },
            { id: 'render', label: 'Headless render', x: 0.65, y: 0.50, tone: 'warm' },
            { id: 'asset', label: 'PNG / SVG / GIF', x: 0.90, y: 0.50, tone: 'green' },
        ]}
        edges={[
            { from: 'brief', to: 'primitives', tone: 'blue' },
            { from: 'brief', to: 'theme', tone: 'cyan' },
            { from: 'primitives', to: 'render', tone: 'purple' },
            { from: 'theme', to: 'render', tone: 'cyan' },
            { from: 'render', to: 'asset', tone: 'green' },
        ]}
    />
    <Row width="100%" gap={14}>
        <CalloutCard
            title="Editable TSX source"
            tone="purple"
            width={430}
            minHeight={64}
            padding={18}
            titleFontSize={18}
        />
        <CalloutCard
            title="Offline, deterministic output"
            tone="green"
            width={430}
            minHeight={64}
            padding={18}
            titleFontSize={18}
        />
    </Row>
</Scene>
