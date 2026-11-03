width = 1040;
height = 640;

<Scene
    title="From TSX scene to rendered files"
    density="comfortable"
>
    <GraphDiagram
        ariaLabel="Vizmatic rendering pipeline from an agent request through scene primitives and theme tokens to rendered assets"
        nodes={[
            { id: 'brief', label: 'Agent request' },
            { id: 'primitives', label: 'Scene primitives' },
            { id: 'theme', label: 'Theme tokens' },
            { id: 'render', label: 'Node renderer', tone: 'warm' },
            { id: 'asset', label: 'PNG / SVG / GIF', tone: 'green' },
        ]}
        edges={[
            { from: 'brief', to: 'primitives' },
            { from: 'brief', to: 'theme' },
            { from: 'primitives', to: 'render' },
            { from: 'theme', to: 'render' },
            { from: 'render', to: 'asset' },
        ]}
    />
    <Row width="100%" gap={14}>
        <CalloutCard
            title="Source stays editable"
            width={430}
            padding={18}
            titleFontSize={18}
        />
        <CalloutCard
            title="Bundled assets work offline"
            tone="green"
            width={430}
            padding={18}
            titleFontSize={18}
        />
    </Row>
</Scene>
