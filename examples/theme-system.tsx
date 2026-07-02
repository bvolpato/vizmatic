width = 1040;
height = 560;

const tones = ['blue', 'purple', 'green', 'warm', 'cyan', 'pink', 'critical', 'ocean'] as const;

<Scene title="Theme-aware primitives" subtitle="semantic tones, not hard-coded colors" gap={18}>
    <Row gap={14} wrap width="100%">
        {tones.map((tone) => (
            <Panel key={tone} title={tone} tone={tone} width={225} minHeight={106}>
                <Column gap={9} align="stretch">
                    <ToneStrip tone={tone} width={62} />
                    <TextLabel text="inherits border, fill, label, and chart color" fontSize={11} />
                </Column>
            </Panel>
        ))}
    </Row>
    <Row gap={14}>
        <StepCard tone="purple" title="Spec first" subtitle="models write intent" width={210} />
        <MetricCard tone="green" label="Themes" value="2 modes" detail="dark + light" width={180} />
        <CalloutCard tone="ocean" title="Adapters own the brand" detail="Bring your own palette and typography." width={430} />
    </Row>
</Scene>
