import React from 'react'
import { CalloutCard, Column, defineIllustration, MetricCard, MiniBarChart, Panel, Row, Scene, TextLabel } from 'vizmatic'

export const width = 1040
export const height = 560

const frame = defineIllustration((c) =>
    <Scene c={c} title="Release readiness card" subtitle="compact operational visuals for reports and decks" gap={18}>
        <Row gap={18} align="stretch">
            <Panel c={c} title="Checks" tone="green" width={360}>
                <Column gap={12} align="stretch">
                    <MetricCard c={c} tone="green" label="unit" value="418" detail="passing" width="100%" />
                    <MetricCard c={c} tone="cyan" label="visual" value="12" detail="frames rendered" width="100%" />
                    <MetricCard c={c} tone="warm" label="bundle" value="42kB" detail="minified core" width="100%" />
                </Column>
            </Panel>
            <Panel c={c} title="Risk burn-down" tone="purple" width={360}>
                <MiniBarChart
                    c={c}
                    showValues
                    data={[
                        { label: 'Mon', value: 8, tone: 'critical', valueLabel: '8' },
                        { label: 'Tue', value: 6, tone: 'warm', valueLabel: '6' },
                        { label: 'Wed', value: 4, tone: 'cyan', valueLabel: '4' },
                        { label: 'Thu', value: 2, tone: 'green', valueLabel: '2' },
                        { label: 'Fri', value: 1, tone: 'green', valueLabel: '1' },
                    ]}
                />
                <TextLabel c={c} text="Mini charts work inside cards, callouts, and dashboards." align="center" />
            </Panel>
            <Panel c={c} title="Decision" tone="ocean" width={220}>
                <CalloutCard c={c} tone="ocean" title="Ship" detail="all release gates are green" minHeight={190} />
            </Panel>
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
