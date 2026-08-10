import {
    ParetoChart,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 570

// Brumark v10 max-effort snapshots, post-regrade July 23, 2026.
// Cost per task is each run's recorded/estimated total cost divided by 306 tasks.
const results = [
    { x: 0.008280, y: 56.9015, label: 'Luna · max', color: 'info', size: 7 },
    { x: 0.086881, y: 71.3691, label: 'Terra · max', color: 'positive', size: 7 },
    { x: 0.216884, y: 88.3919, label: 'Sol · max', color: 'primary', size: 8 },
    { x: 0.314285, y: 79.7092, label: 'Opus 5 · max', color: 'warning', size: 7 },
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
                title="Brumark v10 · max reasoning effort"
                subtitle="A run is efficient when no cheaper run scores at least as high"
                points={results}
                xScale="log"
                xMin={0.006}
                xMax={0.4}
                yMin={50}
                yMax={92}
                xAxisLabel="recorded cost per task · log scale"
                yAxisLabel="score"
                formatX={formatCost}
                formatY={(value) => `${Math.round(value)}%`}
                frontierColor="positive"
                goalLabel="more efficient ↖"
                footer="306 tasks · post-regrade snapshot · estimated costs"
            />
        </Scene>
    )
}

export default create('dark')
