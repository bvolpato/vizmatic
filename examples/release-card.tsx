width = 1040;
height = 560;

<Scene title="Release readiness card" subtitle="compact operational visuals for reports and decks" gap={18}>
    <Row gap={18} align="stretch">
        <Panel title="Checks" tone="green" width={360}>
            <Column gap={12} align="stretch">
                <MetricCard tone="green" label="unit" value="418" detail="passing" width="100%" />
                <MetricCard tone="cyan" label="visual" value="12" detail="frames rendered" width="100%" />
                <MetricCard tone="warm" label="bundle" value="42kB" detail="minified core" width="100%" />
            </Column>
        </Panel>
        <Panel title="Risk burn-down" tone="purple" width={360}>
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
            <TextLabel text="Mini charts work inside cards, callouts, and dashboards." align="center" />
        </Panel>
        <Panel title="Decision" tone="ocean" width={220}>
            <CalloutCard tone="ocean" title="Ship" detail="all release gates are green" minHeight={190} />
        </Panel>
    </Row>
</Scene>
