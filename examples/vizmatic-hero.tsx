width = 1040;
height = 640;

<Scene
    title="From TSX scene to rendered files"
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
            { id: 'brief', label: 'Agent request', x: 0.10, y: 0.50, tone: 'blue' },
            { id: 'primitives', label: 'Scene primitives', x: 0.36, y: 0.25, tone: 'purple' },
            { id: 'theme', label: 'Theme tokens', x: 0.36, y: 0.75, tone: 'cyan' },
            { id: 'render', label: 'Node renderer', x: 0.65, y: 0.50, tone: 'warm' },
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
            title="Source stays editable"
            tone="purple"
            width={430}
            minHeight={64}
            padding={18}
            titleFontSize={18}
        />
        <CalloutCard
            title="Bundled assets work offline"
            tone="green"
            width={430}
            minHeight={64}
            padding={18}
            titleFontSize={18}
        />
    </Row>
</Scene>
