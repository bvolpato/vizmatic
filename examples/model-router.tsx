width = 1040;
height = 620;

<Scene title="Model routing board" subtitle="operational diagrams without custom drawing code" gap={18}>
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
                <MetricCard tone="green" label="simple" value="72%" detail="small model" width={170} />
                <MetricCard tone="purple" label="hard" value="19%" detail="reasoning" width={170} />
                <MetricCard tone="cyan" label="vision" value="9%" detail="multimodal" width={170} />
            </Row>
            <CalloutCard tone="ocean" title="Agent-friendly output" detail="The model describes routing stages and metrics; Vizmatic handles layout, spacing, and theme." width={530} minHeight={120} />
            <CalloutCard tone="critical" title="CI catches clipped frames" detail="Overflow detection fails builds before broken images ship." width={530} minHeight={100} filled={false} />
        </Column>
    </Row>
</Scene>
