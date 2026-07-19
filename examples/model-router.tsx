width = 1040;
height = 620;

<Scene title="Model routing example" subtitle="sample policy and illustrative traffic mix" gap={18}>
    <Row gap={18} align="stretch">
        <Flow
            direction="vertical"
            connectorTone="cyan"
            stages={[
                { title: 'Classify request', subtitle: 'cost + risk + latency', tone: 'blue', width: 300 },
                { title: 'Pick model', subtitle: 'small / reasoning / vision', tone: 'purple', width: 300 },
                { title: 'Apply policy', subtitle: 'tools, budget, eval gates', tone: 'warm', width: 300 },
                { title: 'Observe result', subtitle: 'quality and drift', tone: 'green', width: 300 },
            ]}
        />
        <Column gap={14} width={560}>
            <Row gap={12}>
                <MetricCard tone="green" label="simple" value="72%" detail="sample route" width={170} />
                <MetricCard tone="purple" label="hard" value="19%" detail="sample route" width={170} />
                <MetricCard tone="cyan" label="vision" value="9%" detail="sample route" width={170} />
            </Row>
            <CalloutCard tone="ocean" title="Policy as structured data" detail="Stages and metrics stay editable in the TSX source." width={530} minHeight={120} />
            <CalloutCard tone="critical" title="Overflow check" detail="Validation reports clipped content before export." width={530} minHeight={100} filled={false} />
        </Column>
    </Row>
</Scene>
