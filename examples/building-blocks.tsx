width = 1220;
height = 650;

<Scene title="Charts, timelines, trees, and icons" subtitle="the same theme tokens style each primitive" gap={18}>
    <Row gap={18} align="stretch" width="100%">
        <DonutChart
            width={340}
            height={270}
            title="Example composition"
            subtitle="illustrative split"
            format="percent"
            centerValue="100%"
            centerLabel="coverage"
            segments={[
                { label: 'charts', value: 0.36, color: 'positive' },
                { label: 'process', value: 0.27, color: 'primary' },
                { label: 'hierarchy', value: 0.22, color: 'info' },
                { label: 'symbols', value: 0.15, color: 'warning' },
            ]}
        />
        <Timeline
            title="Render workflow"
            width={330}
            events={[
                { time: 'draft', title: 'Choose primitives', detail: 'match components to content', tone: 'blue' },
                { time: 'render', title: 'Export both themes', detail: 'create dark and light files', tone: 'purple' },
                { time: 'review', title: 'Inspect output', detail: 'check layout and contrast', tone: 'green' },
            ]}
        />
        <TreeDiagram
            title="Reusable hierarchy"
            width={420}
            height={270}
            nodeWidth={104}
            root={{
                label: 'Scene',
                detail: 'root',
                tone: 'purple',
                children: [
                    { label: 'Metrics', detail: 'Donut', tone: 'green' },
                    { label: 'Flow', detail: 'Timeline', tone: 'blue' },
                    { label: 'Org', detail: 'Tree', tone: 'cyan' },
                ],
            }}
        />
    </Row>
    <Row gap={14} width="100%" justify="center">
        <CalloutCard tone="green" filled={false} width={250} align="left">
            <Row gap={10} justify="start" width="100%">
                <Icon name="chart" tone="green" size={28} />
                <Column gap={2} align="start">
                    <TextLabel text="Quantify share" variant="small" color={c.textPrimary} />
                    <TextLabel text="DonutChart" variant="tiny" mono color={c.textMuted} />
                </Column>
            </Row>
        </CalloutCard>
        <CalloutCard tone="purple" filled={false} width={250} align="left">
            <Row gap={10} justify="start" width="100%">
                <Icon name="layers" tone="purple" size={28} />
                <Column gap={2} align="start">
                    <TextLabel text="Show sequence" variant="small" color={c.textPrimary} />
                    <TextLabel text="Timeline" variant="tiny" mono color={c.textMuted} />
                </Column>
            </Row>
        </CalloutCard>
        <CalloutCard tone="cyan" filled={false} width={250} align="left">
            <Row gap={10} justify="start" width="100%">
                <Icon name="git" tone="cyan" size={28} />
                <Column gap={2} align="start">
                    <TextLabel text="Explain structure" variant="small" color={c.textPrimary} />
                    <TextLabel text="TreeDiagram" variant="tiny" mono color={c.textMuted} />
                </Column>
            </Row>
        </CalloutCard>
        <CalloutCard tone="warm" filled={false} width={250} align="left">
            <Row gap={10} justify="start" width="100%">
                <Icon name="spark" tone="warm" size={28} />
                <Column gap={2} align="start">
                    <TextLabel text="Add anchors" variant="small" color={c.textPrimary} />
                    <TextLabel text="Icon" variant="tiny" mono color={c.textMuted} />
                </Column>
            </Row>
        </CalloutCard>
    </Row>
</Scene>
