import React from 'react'
import { CalloutCard, defineIllustration, Flow, Row, Scene } from 'vizmatic'

export const width = 1040
export const height = 560

const frame = defineIllustration((c) =>
    <Scene c={c} title="Agent visual pipeline" subtitle="spec -> themed scene -> verified artifact" gap={26}>
        <Flow
            c={c}
            connectorTone="purple"
            stages={[
                { eyebrow: 'input', title: 'Prompt', subtitle: 'intent and constraints', tone: 'blue', lines: ['domain language', 'audience', 'theme tokens'], width: 190 },
                { eyebrow: 'contract', title: 'Scene spec', subtitle: 'typed structure', tone: 'purple', lines: ['cards', 'flows', 'charts', 'tables'], width: 190 },
                { eyebrow: 'render', title: 'Satori frame', subtitle: 'React primitives', tone: 'cyan', lines: ['layout defaults', 'safe text', 'semantic tones'], width: 190 },
                { eyebrow: 'output', title: 'PNG / SVG', subtitle: 'CI-ready asset', tone: 'green', lines: ['autocrop', 'overflow checks', 'retina scale'], width: 190 },
            ]}
        />
        <Row width="100%" gap={14}>
            <CalloutCard c={c} title="Model writes structure" detail="No hand-written SVG paths or brittle x/y layout for common cases." tone="purple" width={470} />
            <CalloutCard c={c} title="Design system stays in control" detail="Theme tokens decide color, typography, radius, spacing, and contrast." tone="green" width={470} />
        </Row>
    </Scene>
)

export const create = frame.create
export default frame.default
