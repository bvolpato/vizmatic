width = 1040;
height = 620;

<Scene title="Evaluation dashboard example" subtitle="illustrative data for chart composition" gap={18}>
    <Row gap={18} align="stretch">
        <BarChart
            width={440}
            height={260}
            title="Pass rate by task"
            subtitle="sample task scores"
            format="percent"
            data={[
                { label: 'tools', value: 0.82, color: 'positive' },
                { label: 'math', value: 0.71, color: 'secondary' },
                { label: 'code', value: 0.77, color: 'primary' },
                { label: 'long', value: 0.58, color: 'warning' },
                { label: 'cite', value: 0.64, color: 'info' },
            ]}
        />
        <LineChart
            width={440}
            height={260}
            title="Quality over releases"
            subtitle="sample trend"
            format="percent"
            labels={['v1', 'v2', 'v3', 'v4', 'v5']}
            series={[
                { name: 'quality', points: [0.55, 0.61, 0.69, 0.74, 0.81], color: 'positive', area: true },
                { name: 'failure rate', points: [0.72, 0.69, 0.66, 0.62, 0.59], color: 'warning' },
            ]}
        />
    </Row>
    <CalloutCard tone="cyan" title="Shared chart styling" detail="Bar and line charts use the same typography, grid, and semantic colors." width={900} />
</Scene>
