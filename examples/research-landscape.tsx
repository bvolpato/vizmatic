width = 1040;
height = 620;

<Scene title="Visualization approach map" subtitle="illustrative positions, not benchmark results" align="center">
    <ScatterPlot
        width={840}
        height={390}
        title="Approach tradeoff"
        subtitle="illustrative positions"
        xAxisLabel="implementation complexity"
        yAxisLabel="visual fidelity"
        xMin={0}
        xMax={10}
        yMin={0}
        yMax={10}
        points={[
            { x: 2.0, y: 3.0, label: 'Flowchart DSL', color: 'secondary', size: 8 },
            { x: 3.8, y: 5.8, label: 'Graph DSL', color: 'info', size: 8 },
            { x: 6.8, y: 7.2, label: 'Canvas SDK', color: 'warning', size: 9 },
            { x: 5.8, y: 8.4, label: 'Scene primitives', color: 'positive', size: 10 },
            { x: 8.6, y: 9.0, label: 'Custom SVG', color: 'critical', size: 8 },
            { x: 4.9, y: 6.6, label: 'Chart grammar', color: 'purple', size: 8 },
        ]}
    />
</Scene>
