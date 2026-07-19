width = 1040;
height = 560;

<Scene title="TSX scene to rendered files" subtitle="prompt -> scene -> render -> output" gap={26}>
    <Flow
        connectorTone="purple"
        stages={[
            { eyebrow: 'input', title: 'Prompt', subtitle: 'intent and constraints', tone: 'blue', lines: ['goal', 'audience', 'format'], width: 190 },
            { eyebrow: 'source', title: 'TSX scene', subtitle: 'component tree', tone: 'purple', lines: ['layout', 'diagrams', 'charts'], width: 190 },
            { eyebrow: 'render', title: 'Node renderer', subtitle: 'headless output', tone: 'cyan', lines: ['theme', 'auto-size', 'checks'], width: 190 },
            { eyebrow: 'output', title: 'PNG / SVG / GIF', subtitle: 'rendered files', tone: 'green', lines: ['dark + light', 'alpha', 'manifest'], width: 190 },
        ]}
    />
    <Row width="100%" gap={14}>
        <CalloutCard title="Source stays editable" detail="Review and change the TSX instead of regenerating an opaque image." tone="purple" width={470} />
        <CalloutCard title="Checks run before export" detail="Diagnostics report overflow, contrast, and asset failures." tone="green" width={470} />
    </Row>
</Scene>
