import React from 'react'
import {
    CalloutCard,
    Flow,
    MetricCard,
    Row,
    Scene,
    defineAnimation,
    getThemeColors,
    hold,
    keyframe,
    tween,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 560

const stages = [
    { title: 'Prompt', subtitle: 'intent', tone: 'blue' as const },
    { title: 'Scene', subtitle: 'structure', tone: 'purple' as const },
    { title: 'Render', subtitle: 'assets', tone: 'cyan' as const },
    { title: 'Verify', subtitle: 'layout', tone: 'green' as const },
]

function frame(theme: ThemeMode, progress: number, opacity: number) {
    const c = getThemeColors(theme)
    const active = Math.min(stages.length - 1, Math.floor(progress * stages.length))
    return (
        <Scene c={c} title="Animated timeline example" subtitle="state is sampled into smooth GIF frames" gap={24}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', opacity }}>
                <Flow
                    c={c}
                    connectorTone="purple"
                    stages={stages.map((stage, index) => ({
                        ...stage,
                        title: index <= active ? stage.title : 'Pending',
                        subtitle: index <= active ? stage.subtitle : 'queued',
                        tone: index <= active ? stage.tone : 'neutral',
                        width: 190,
                    }))}
                />
                <Row width="100%" gap={16} align="stretch">
                    <MetricCard c={c} label="Step" value={`${active + 1}/4`} tone="purple" detail={stages[active].title} width={260} />
                    <CalloutCard
                        c={c}
                        title={active === stages.length - 1 ? 'Export complete' : `Frame ${active + 1} of 4`}
                        detail="defineAnimation describes state, easing, and duration."
                        tone={active === stages.length - 1 ? 'green' : 'cyan'}
                        width={700}
                    />
                </Row>
            </div>
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return frame(theme, 1, 1)
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation({
        initial: { progress: 0, opacity: 0 },
        timeline: [
            tween({ opacity: 1 }, { duration: 300, easing: 'ease-out', label: 'Appear' }),
            hold(400, 'Ready'),
            tween({ progress: 1 }, { duration: 2400, easing: 'ease-in-out', label: 'Pipeline' }),
            hold(700, 'Complete'),
            tween({ opacity: 0 }, { duration: 300, easing: 'ease-in', label: 'Reset' }),
            keyframe({ progress: 0 }),
        ],
        fps: 20,
        render: (state) => frame(theme, state.progress, state.opacity),
    })
}

export default create('dark')
