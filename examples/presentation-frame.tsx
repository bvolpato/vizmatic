import React from 'react'
import { CalloutCard, Column, defineIllustration, MetricCard, Panel, Row, Scene, TextLabel } from 'vizmatic'

export const width = 1280
export const height = 720

const frame = defineIllustration((c) =>
    <Scene c={c} title="One frame can become a slide" subtitle="same primitive tree, wider canvas" gap={22}>
        <Row gap={20} align="stretch">
            <Panel c={c} title="Narrative" tone="purple" width={430} minHeight={330}>
                <Column gap={13} align="stretch">
                    <TextLabel c={c} variant="label" color={c.textPrimary} text="Models are good at structure." />
                    <TextLabel c={c} text="Vizmatic turns that structure into a design-system-aware artifact instead of asking the model to draw pixels." />
                    <CalloutCard c={c} tone="purple" title="Typed scene contract" detail="Better than raw SVG for agents." align="left" />
                </Column>
            </Panel>
            <Panel c={c} title="Render guarantees" tone="green" width={610} minHeight={330}>
                <Row gap={14} wrap align="stretch">
                    <MetricCard c={c} tone="green" label="Output" value="PNG/SVG" detail="retina-ready" width={180} minHeight={106} />
                    <MetricCard c={c} tone="cyan" label="Layout" value="flex" detail="no x/y for common paths" width={180} minHeight={106} />
                    <MetricCard c={c} tone="warm" label="Checks" value="overflow" detail="fail fast in CI" width={180} minHeight={106} />
                    <MetricCard c={c} tone="purple" label="Theme" value="tokens" detail="brand adapters" width={180} minHeight={106} />
                    <MetricCard c={c} tone="blue" label="Runtime" value="Node" detail="no browser required" width={180} minHeight={106} />
                    <MetricCard c={c} tone="pink" label="Authoring" value="JSX" detail="agent-friendly" width={180} minHeight={106} />
                </Row>
            </Panel>
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
