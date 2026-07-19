width = 1040;
height = 560;

<Scene title="Release status example" subtitle="illustrative values for a report or slide" gap={18}>
    <Row gap={18} align="stretch">
        <Panel title="Sample checks" tone="green" width={360}>
            <Column gap={12} align="stretch">
                <MetricCard tone="green" label="unit" value="418" detail="sample value" width="100%" />
                <MetricCard tone="cyan" label="visual" value="12" detail="sample value" width="100%" />
                <MetricCard tone="warm" label="bundle" value="42kB" detail="sample value" width="100%" />
            </Column>
        </Panel>
        <Panel title="Sample trend" tone="purple" width={360}>
            <MiniBarChart
                showValues
                data={[
                    { label: 'Mon', value: 8, tone: 'critical', valueLabel: '8' },
                    { label: 'Tue', value: 6, tone: 'warm', valueLabel: '6' },
                    { label: 'Wed', value: 4, tone: 'cyan', valueLabel: '4' },
                    { label: 'Thu', value: 2, tone: 'green', valueLabel: '2' },
                    { label: 'Fri', value: 1, tone: 'green', valueLabel: '1' },
                ]}
            />
            <TextLabel text="Illustrative issue count" align="center" />
        </Panel>
        <Panel title="Status" tone="ocean" width={220}>
            <CalloutCard tone="ocean" title="Example only" detail="replace with project status" minHeight={190} />
        </Panel>
    </Row>
</Scene>
