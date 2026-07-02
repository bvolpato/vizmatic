import React from 'react'
import { BarChart, CalloutCard, defineIllustration, LineChart, Row, Scene } from 'vizmatic'

export const width = 1040
export const height = 620

const frame = defineIllustration((c) =>
    <Scene c={c} title="Evaluation snapshot" subtitle="charts inherit theme, grid, labels, and contrast" gap={18}>
        <Row gap={18} align="stretch">
            <BarChart
                c={c}
                width={440}
                height={260}
                title="Pass rate by task"
                subtitle="held-out suite"
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
                c={c}
                width={440}
                height={260}
                title="Quality over releases"
                subtitle="weighted score"
                format="percent"
                labels={['v1', 'v2', 'v3', 'v4', 'v5']}
                series={[
                    { name: 'quality', points: [0.55, 0.61, 0.69, 0.74, 0.81], color: 'positive', area: true },
                    { name: 'latency', points: [0.72, 0.69, 0.66, 0.62, 0.59], color: 'warning' },
                ]}
            />
        </Row>
        <CalloutCard c={c} tone="cyan" title="One theme, many visual forms" detail="Charts, cards, flows, and tables share typography and semantic color tokens." width={900} />
    </Scene>
)

export const create = frame.create
export default frame.default
