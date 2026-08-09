import {
    CalloutCard,
    FlowArrow,
    Panel,
    Row,
    Scene,
    getThemeColors,
    type AnimatedScene,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 560

const stages = [
    { title: 'Prompt', subtitle: 'intent', tone: 'blue' as const, width: 178 },
    { title: 'TSX scene', subtitle: 'components', tone: 'purple' as const, width: 178 },
    { title: 'Frame states', subtitle: 'React trees', tone: 'cyan' as const, width: 178 },
    { title: 'GIF file', subtitle: 'four frames', tone: 'green' as const, width: 178 },
]

function buildFrame(theme: ThemeMode, active: number) {
    const c = getThemeColors(theme)
    const visibleStages = stages.map((stage, index) => ({
        ...stage,
        title: index <= active ? stage.title : 'Pending',
        subtitle: index <= active ? stage.subtitle : 'queued',
        tone: index <= active ? stage.tone : 'neutral' as const,
    }))

    return (
        <Scene c={c} title="One scene rendered as a GIF" subtitle="four states from createScenes(theme)" gap={20}>
            <Row width="100%" gap={5} align="stretch" justify="center">
                {visibleStages.flatMap((stage, index) => [
                    <Panel
                        key={`stage-${index}`}
                        c={c}
                        title={stage.title}
                        subtitle={stage.subtitle}
                        tone={stage.tone}
                        width={stage.width}
                        minHeight={104}
                        align="center"
                        justify="center"
                    />,
                    ...(index < visibleStages.length - 1
                        ? [<FlowArrow key={`connector-${index}`} c={c} direction="right" length={20} tone="purple" />]
                        : []),
                ])}
            </Row>
            <Row width="100%" gap={16} align="stretch">
                <CalloutCard
                    c={c}
                    tone="purple"
                    title={`Frame ${active + 1} of 4`}
                    detail={`${stages[active].title} is active`}
                    width={300}
                    minHeight={118}
                />
                <CalloutCard
                    c={c}
                    tone={active === stages.length - 1 ? 'green' : 'ocean'}
                    title={active === stages.length - 1 ? 'Export complete' : `Rendering frame ${active + 1}`}
                    detail="createScenes(theme) defines content, duration, and transition."
                    width={644}
                    minHeight={118}
                />
            </Row>
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, stages.length - 1)
}

export function createScenes(theme: ThemeMode): AnimatedScene[] {
    return stages.map((_, index) => ({
        element: buildFrame(theme, index),
        duration: index === stages.length - 1 ? 1100 : 760,
        transition: index === 0 ? 'appear' : 'fade',
        transitionDuration: 400,
        label: stages[index].title,
    }))
}

export default create('dark')
