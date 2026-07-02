import React from 'react'
import { CalloutCard, Column, defineIllustration, MetricCard, Panel, Row, Scene, StepCard, TextLabel, ToneStrip } from 'vizmatic'

export const width = 1040
export const height = 560

const tones = ['blue', 'purple', 'green', 'warm', 'cyan', 'pink', 'critical', 'ocean'] as const

const frame = defineIllustration((c) =>
    <Scene c={c} title="Theme-aware primitives" subtitle="semantic tones, not hard-coded colors" gap={18}>
        <Row gap={14} wrap width="100%">
            {tones.map((tone) => (
                <Panel key={tone} c={c} title={tone} tone={tone} width={225} minHeight={106}>
                    <Column gap={9} align="stretch">
                        <ToneStrip tone={tone} width={62} />
                        <TextLabel c={c} text="inherits border, fill, label, and chart color" fontSize={11} />
                    </Column>
                </Panel>
            ))}
        </Row>
        <Row gap={14}>
            <StepCard c={c} tone="purple" title="Spec first" subtitle="models write intent" width={210} />
            <MetricCard c={c} tone="green" label="Themes" value="2 modes" detail="dark + light" width={180} />
            <CalloutCard c={c} tone="ocean" title="Adapters own the brand" detail="Bring your own palette and typography." width={430} />
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
