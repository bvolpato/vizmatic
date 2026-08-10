import {
    BarChart,
    ChartFrame,
    Column,
    DonutChart,
    getThemeColors,
    getToneColor,
    IntervalPlot,
    Legend,
    LineChart,
    ParetoChart,
    QuadrantChart,
    Row,
    ScatterPlot,
    Scene,
    StackedBar,
    TextLabel,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 1280

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    const blue = getToneColor('blue', c)
    const purple = getToneColor('purple', c)
    const green = getToneColor('green', c)
    const warm = getToneColor('warm', c)

    return (
        <Scene
            c={c}
            title="Charts catalog"
            subtitle="shared shells, comparisons, trends, distributions, positioning, ranges, and legends"
            background={c.bg}
            padding={24}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Column width={324} gap={14} align="stretch">
                    <ChartFrame
                        c={c}
                        title="ChartFrame"
                        subtitle="shared title, legend, footer, and theme-aware shell"
                        width={324}
                        height={104}
                        legend={[
                            { label: 'primary', color: 'primary' },
                            { label: 'verified', color: 'positive' },
                        ]}
                        footer="frame primitive"
                    >
                        <TextLabel c={c} text="Wrap custom chart marks in a consistent surface." fontSize={11} color={c.textSecondary} />
                    </ChartFrame>
                    <StackedBar
                        c={c}
                        title="StackedBar"
                        subtitle="part-to-whole route mix"
                        width={324}
                        height={48}
                        segments={[
                            { label: 'plan', value: 46, color: 'secondary' },
                            { label: 'build', value: 32, color: 'primary' },
                            { label: 'verify', value: 22, color: 'positive' },
                        ]}
                    />
                </Column>

                <DonutChart
                    c={c}
                    title="DonutChart"
                    subtitle="part-to-whole with center metric"
                    width={360}
                    height={188}
                    size={138}
                    thickness={24}
                    centerValue="100%"
                    centerLabel="coverage"
                    format="percent"
                    segments={[
                        { label: 'ready', value: 0.62, color: 'positive' },
                        { label: 'review', value: 0.24, color: 'secondary' },
                        { label: 'watch', value: 0.14, color: 'warning' },
                    ]}
                />

                <Column width={348} gap={12} align="stretch">
                    <Legend
                        c={c}
                        title="Legend"
                        items={[
                            { label: 'primary signal', color: blue },
                            { label: 'comparison', color: purple },
                            { label: 'validated result', color: green },
                            { label: 'threshold', color: warm, style: 'dashed' },
                        ]}
                    />
                    <TextLabel c={c} text="All labels use 11 px or larger type across dark and light themes." fontSize={11} color={c.textMuted} />
                </Column>
            </Row>

            <ParetoChart
                c={c}
                title="ParetoChart"
                subtitle="automatic non-dominated frontier for competing objectives"
                width={1080}
                height={210}
                xMin={0}
                xMax={10}
                yMin={0}
                yMax={10}
                xAxisLabel="cost"
                points={[
                    { x: 1.2, y: 4.0, label: 'fast', color: 'info' },
                    { x: 3.8, y: 6.8, label: 'balanced', color: 'positive' },
                    { x: 7.0, y: 9.1, label: 'deep', color: 'primary' },
                    { x: 8.4, y: 7.3, label: 'dominated', color: 'warning' },
                ]}
                frontierColor="positive"
                goalLabel="higher quality · lower cost"
            />

            <Row width="100%" gap={16} align="stretch">
                <BarChart
                    c={c}
                    title="BarChart"
                    subtitle="categorical comparison"
                    width={332}
                    height={188}
                    format="percent"
                    yAxisLabel="pass rate"
                    data={[
                        { label: 'plan', value: 0.74, color: 'secondary' },
                        { label: 'build', value: 0.89, color: 'primary' },
                        { label: 'check', value: 0.95, color: 'info' },
                        { label: 'ship', value: 0.98, color: 'positive' },
                    ]}
                />

                <LineChart
                    c={c}
                    title="LineChart"
                    subtitle="multi-series trend"
                    width={348}
                    height={188}
                    format="percent"
                    yAxisLabel="score"
                    labels={['r1', 'r2', 'r3', 'r4', 'r5']}
                    series={[
                        { name: 'quality', points: [0.62, 0.69, 0.76, 0.83, 0.91], color: 'positive', area: true },
                        { name: 'latency', points: [0.84, 0.76, 0.70, 0.65, 0.61], color: 'primary' },
                    ]}
                />

                <ScatterPlot
                    c={c}
                    title="ScatterPlot"
                    subtitle="labeled numeric distribution"
                    width={348}
                    height={188}
                    xMin={0}
                    xMax={10}
                    yMin={0}
                    yMax={10}
                    xAxisLabel="cost"
                    yAxisLabel="quality"
                    points={[
                        { x: 2.0, y: 7.8, label: 'fast', color: 'secondary' },
                        { x: 4.6, y: 8.8, label: 'balanced', color: 'positive' },
                        { x: 7.8, y: 9.4, label: 'deep', color: 'primary' },
                        { x: 6.1, y: 5.2, label: 'retry', color: 'warning' },
                    ]}
                />
            </Row>

            <Row width="100%" gap={16} align="stretch">
                <QuadrantChart
                    c={c}
                    title="QuadrantChart"
                    subtitle="positioning map with named decision regions"
                    width={520}
                    height={244}
                    xAxisLabel="implementation effort"
                    yAxisLabel="user value"
                    regions={{
                        topLeft: { label: 'quick wins', detail: 'prioritize', color: 'positive', emphasis: true },
                        topRight: { label: 'big bets', detail: 'stage work', color: 'primary' },
                        bottomLeft: { label: 'defer', detail: 'low return', color: 'neutral' },
                        bottomRight: { label: 'avoid', detail: 'high cost', color: 'warning' },
                    }}
                    points={[
                        { x: 0.22, y: 0.79, label: 'A', color: 'positive' },
                        { x: 0.72, y: 0.72, label: 'B', color: 'primary' },
                        { x: 0.31, y: 0.27, label: 'C', color: 'neutral' },
                        { x: 0.77, y: 0.29, label: 'D', color: 'warning' },
                    ]}
                />

                <IntervalPlot
                    c={c}
                    title="IntervalPlot"
                    subtitle="low, midpoint, and high range by category"
                    width={528}
                    height={244}
                    min={0}
                    max={100}
                    format="integer"
                    axisLabel="milliseconds"
                    data={[
                        { label: 'render', low: 18, mid: 28, high: 41, color: 'secondary' },
                        { label: 'check', low: 34, mid: 48, high: 67, color: 'primary' },
                        { label: 'export', low: 52, mid: 71, high: 89, color: 'positive' },
                    ]}
                />
            </Row>
        </Scene>
    )
}

export default create('dark')
