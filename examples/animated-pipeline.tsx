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
    { eyebrow: 'input', title: 'Prompt', subtitle: 'intent', tone: 'blue' as const, lines: ['goal', 'audience', 'constraints'], width: 190 },
    { eyebrow: 'contract', title: 'Scene spec', subtitle: 'typed', tone: 'purple' as const, lines: ['cards', 'flows', 'charts'], width: 190 },
    { eyebrow: 'render', title: 'Satori frame', subtitle: 'React tree', tone: 'cyan' as const, lines: ['layout', 'theme', 'safe text'], width: 190 },
    { eyebrow: 'output', title: 'GIF / PNG', subtitle: 'verified', tone: 'green' as const, lines: ['autocrop', 'overflow checks', 'retina'], width: 190 },
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
        <Scene c={c} title="Animated render pipeline" subtitle="same scene contract, exported as GIF" gap={24}>
            <Flow c={c} connectorTone="purple" stages={visibleStages} />
            <Row width="100%" gap={14} align="stretch">
                <Column gap={12} width={360}>
                    <MetricCard c={c} label="Step" value={`${active + 1}/4`} tone="purple" detail={stages[active].title} width="100%" minHeight={96} />
                    <MetricCard c={c} label="Format" value="GIF" tone="green" detail="animated scenes" width="100%" minHeight={96} />
                </Column>
                <CalloutCard
                    c={c}
                    tone={active === stages.length - 1 ? 'green' : 'ocean'}
                    title={active === stages.length - 1 ? 'Ready to share' : 'Scene changes over time'}
                    detail="Use createScenes(theme) and render with vizmatic gif."
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
