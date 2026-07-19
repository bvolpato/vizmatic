import {
    CalloutCard,
    Column,
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
    { eyebrow: 'input', title: 'Prompt', subtitle: 'intent', tone: 'blue' as const, lines: ['goal', 'audience', 'format'], width: 190 },
    { eyebrow: 'source', title: 'TSX scene', subtitle: 'components', tone: 'purple' as const, lines: ['layout', 'flow', 'cards'], width: 190 },
    { eyebrow: 'render', title: 'Frame states', subtitle: 'React trees', tone: 'cyan' as const, lines: ['content', 'duration', 'transition'], width: 190 },
    { eyebrow: 'output', title: 'GIF file', subtitle: 'four frames', tone: 'green' as const, lines: ['rendered', 'looping', 'complete'], width: 190 },
]

function buildFrame(theme: ThemeMode, active: number) {
    const c = getThemeColors(theme)
    const visibleStages = stages.map((stage, index) => ({
        ...stage,
        title: index <= active ? stage.title : 'Pending',
        subtitle: index <= active ? stage.subtitle : 'queued',
        lines: index <= active ? stage.lines : ['waiting', 'for', 'input'],
        tone: index <= active ? stage.tone : 'neutral' as const,
    }))

    return (
        <Scene c={c} title="One scene rendered as a GIF" subtitle="four states from createScenes(theme)" gap={24}>
            <Flow c={c} connectorTone="purple" stages={visibleStages} />
            <Row width="100%" gap={14} align="stretch">
                <Column gap={12} width={360}>
                    <MetricCard c={c} label="Step" value={`${active + 1}/4`} tone="purple" detail={stages[active].title} width="100%" minHeight={96} />
                    <MetricCard c={c} label="Format" value="GIF" tone="green" detail="four scene states" width="100%" minHeight={96} />
                </Column>
                <CalloutCard
                    c={c}
                    tone={active === stages.length - 1 ? 'green' : 'ocean'}
                    title={active === stages.length - 1 ? 'Export complete' : `Rendering frame ${active + 1}`}
                    detail="createScenes(theme) defines content, duration, and transition."
                    width={580}
                    minHeight={204}
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
        transitionDuration: 420,
        label: stages[index].title,
    }))
}

export default create('dark')
