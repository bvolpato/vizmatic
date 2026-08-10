import {
    QuadrantChart,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 570

// Same Brumark v10 max-effort snapshot as pareto-frontier.tsx.
// Points stay in raw cost-per-task and weighted-score units.
const points = [
    { x: 0.008280, y: 56.9015, label: 'Luna · max', color: 'info', size: 7 },
    { x: 0.216884, y: 88.3919, label: 'Sol · max', color: 'primary', size: 8 },
    { x: 0.086881, y: 71.3691, label: 'Terra · max', color: 'positive', size: 7 },
    { x: 0.314285, y: 79.7092, label: 'Opus 5 · max', color: 'warning', size: 7 },
]

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Desired-quadrant decision map"
            subtitle="Turn two continuous metrics into explicit selection regions"
            background={c.bg}
            padding={20}
            gap={14}
            align="center"
        >
            <QuadrantChart
                c={c}
                width={960}
                height={300}
                title="Price × score selection policy"
                subtitle="Green region satisfies both operating thresholds"
                xMin={0}
                xMax={0.4}
                yMin={40}
                yMax={100}
                xThreshold={0.2}
                yThreshold={70}
                xAxisLabel="recorded cost per task"
                formatX={(value) => `$${value.toFixed(2)}`}
                formatY={(value) => `${Math.round(value)}`}
                showTicks
                showGrid
                regions={{
                    topLeft: {
                        label: 'MOST DESIRED',
                        detail: 'score ≥ 70 · cost ≤ $0.20',
                        color: 'positive',
                        emphasis: true,
                    },
                    topRight: {
                        label: 'PREMIUM PERFORMANCE',
                        detail: 'high score · higher cost',
                        color: 'warning',
                    },
                    bottomLeft: {
                        label: 'BUDGET TRADEOFF',
                        detail: 'lower score · lower cost',
                        color: 'info',
                    },
                    bottomRight: {
                        label: 'LOW EFFICIENCY',
                        detail: 'lower score · higher cost',
                        color: 'critical',
                    },
                }}
                points={points}
                footer="Threshold axes: cost ≤ $0.20 and weighted score ≥ 70"
            />
        </Scene>
    )
}

export default create('dark')
