import {
    ParetoChart,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 570

// Illustrative values show how Pareto dominance separates score and cost tradeoffs.
const results = [
    { x: 0.01, y: 57, label: 'low cost', color: 'info', size: 7 },
    { x: 0.09, y: 72, label: 'balanced', color: 'positive', size: 7 },
    { x: 0.22, y: 89, label: 'high score', color: 'primary', size: 8 },
    { x: 0.32, y: 80, label: 'dominated', color: 'warning', size: 7 },
]

const formatCost = (value: number) => value < 0.01
    ? `$${value.toFixed(3)}`
    : `$${value.toFixed(2)}`

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Cost × score Pareto frontier"
            subtitle="Use dominance, not one-dimensional ranking, to compare model tradeoffs"
            background={c.bg}
            padding={20}
            gap={14}
            align="center"
        >
            <ParetoChart
                c={c}
                width={960}
                height={300}
                title="Illustrative model score and cost tradeoffs"
                subtitle="A point is efficient when no cheaper option scores at least as high"
                points={results}
                xScale="log"
                xMin={0.006}
                xMax={0.4}
                yMin={50}
                yMax={92}
                xAxisLabel="cost per task · log scale"
                yAxisLabel="score"
                formatX={formatCost}
                formatY={(value) => `${Math.round(value)}%`}
                frontierColor="positive"
                goalLabel="more efficient ↖"
                footer="Illustrative values · lower cost and higher score are preferred"
            />
        </Scene>
    )
}

export default create('dark')
