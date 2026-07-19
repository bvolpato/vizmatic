import React from 'react'
import {
    CalloutCard,
    Flow,
    MetricCard,
    Row,
    Scene,
    getThemeColors,
    type AnimatedScene,
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

function frame(theme: ThemeMode, active: number) {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title="Animated frame example" subtitle="each scene becomes one GIF frame" gap={24}>
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
                    detail="createScenes(theme) defines each frame and transition."
                    tone={active === stages.length - 1 ? 'green' : 'cyan'}
                    width={700}
                />
            </Row>
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return frame(theme, stages.length - 1)
}

export function createScenes(theme: ThemeMode): AnimatedScene[] {
    return stages.map((_, index) => ({
        element: frame(theme, index),
        duration: index === stages.length - 1 ? 1100 : 760,
        transition: index === 0 ? 'appear' : 'fade',
        transitionDuration: 360,
        label: stages[index].title,
    }))
}

export default create('dark')
