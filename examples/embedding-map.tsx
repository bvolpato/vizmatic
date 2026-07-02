width = 1040;
height = 560;

<Scene title="Embedding space triage" subtitle="structured scatterplots with labeled regions" align="center">
    <QuadrantChart
        width={860}
        height={360}
        xAxisLabel="retrieval confidence"
        yAxisLabel="answer usefulness"
        regions={{
            topLeft: { label: 'needs query rewrite', detail: 'useful but hard to retrieve', color: 'warning' },
            topRight: { label: 'ship path', detail: 'relevant and useful', color: 'positive' },
            bottomLeft: { label: 'dead zone', detail: 'low signal', color: 'neutral' },
            bottomRight: { label: 'retrieval trap', detail: 'looks relevant, weak answer', color: 'critical' },
        }}
        points={[
            { x: 0.84, y: 0.82, label: 'A', color: 'positive', size: 8 },
            { x: 0.74, y: 0.62, label: 'B', color: 'positive', size: 7 },
            { x: 0.38, y: 0.76, label: 'C', color: 'warning', size: 8 },
            { x: 0.66, y: 0.32, label: 'D', color: 'critical', size: 8 },
            { x: 0.28, y: 0.26, label: 'E', color: 'neutral', size: 7 },
            { x: 0.48, y: 0.54, label: 'F', color: 'info', size: 7 },
        ]}
    />
</Scene>
