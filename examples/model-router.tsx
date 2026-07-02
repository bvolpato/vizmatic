import React from 'react'
import { CalloutCard, Column, defineIllustration, Flow, MetricCard, Row, Scene } from 'vizmatic'

export const width = 1040
export const height = 560

const frame = defineIllustration((c) =>
    <Scene c={c} title="Model routing board" subtitle="operational diagrams without custom drawing code" gap={18}>
        <Row gap={18} align="stretch">
            <Flow
                c={c}
                direction="vertical"
                connectorTone="cyan"
                stages={[
                    { title: 'Classify request', subtitle: 'cost + risk + latency', tone: 'blue', width: 300 },
                    { title: 'Pick model', subtitle: 'small / reasoning / vision', tone: 'purple', width: 300 },
                    { title: 'Apply policy', subtitle: 'tools, budget, eval gates', tone: 'warm', width: 300 },
                    { title: 'Observe result', subtitle: 'quality and drift', tone: 'green', width: 300 },
                ]}
            />
            <Column gap={14} width={560}>
                <Row gap={12}>
                    <MetricCard c={c} tone="green" label="simple" value="72%" detail="small model" width={170} />
                    <MetricCard c={c} tone="purple" label="hard" value="19%" detail="reasoning" width={170} />
                    <MetricCard c={c} tone="cyan" label="vision" value="9%" detail="multimodal" width={170} />
                </Row>
                <CalloutCard c={c} tone="ocean" title="Agent-friendly output" detail="The model describes routing stages and metrics; Vizmatic handles layout, spacing, and theme." width={530} minHeight={120} />
                <CalloutCard c={c} tone="critical" title="CI catches clipped frames" detail="Overflow detection fails builds before broken images ship." width={530} minHeight={100} filled={false} />
            </Column>
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
