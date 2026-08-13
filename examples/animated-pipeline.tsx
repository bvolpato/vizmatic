import {
    CalloutCard,
    defineAnimation,
    FlowArrow,
    hold,
    keyframe,
    Panel,
    Row,
    Scene,
    tween,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 400

type State = { active: number; opacity: number }

const stages = [
    { title: 'Prompt', subtitle: 'intent', tone: 'blue' as const, width: 178 },
    { title: 'TSX scene', subtitle: 'components', tone: 'purple' as const, width: 178 },
    { title: 'Frame states', subtitle: 'React trees', tone: 'cyan' as const, width: 178 },
    { title: 'GIF file', subtitle: 'four states', tone: 'green' as const, width: 178 },
]

function buildFrame(theme: ThemeMode, active: number, opacity = 1) {
    const c = getThemeColors(theme)
    const visibleStages = stages.map((stage, index) => ({
        ...stage,
        title: index <= active ? stage.title : 'Pending',
        subtitle: index <= active ? stage.subtitle : 'queued',
        tone: index <= active ? stage.tone : 'neutral' as const,
    }))

    return (
        <Scene c={c} title="One scene rendered as a GIF" subtitle="four states from createAnimation(theme)" gap={20} contentStyle={{ opacity }}>
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
                    detail="createAnimation(theme) defines typed state, timing, and reset."
                    width={644}
                    minHeight={118}
                />
            </Row>
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, stages.length - 1, 1)
}

export function createAnimation(theme: ThemeMode) {
    return defineAnimation<State>({
        initial: { active: 0, opacity: 0 },
        timeline: [
            tween<Partial<State>>({ opacity: 1 }, { duration: 300, easing: 'ease-in-out', label: 'show first state' }),
            hold(750, 'Prompt'),
            tween<Partial<State>>({ opacity: 0 }, { duration: 200, easing: 'ease-in-out', label: 'change to TSX scene' }),
            keyframe<Partial<State>>({ active: 1 }, 'TSX scene'),
            tween<Partial<State>>({ opacity: 1 }, { duration: 200, easing: 'ease-in-out', label: 'show TSX scene' }),
            hold(750, 'TSX scene'),
            tween<Partial<State>>({ opacity: 0 }, { duration: 200, easing: 'ease-in-out', label: 'change to frame states' }),
            keyframe<Partial<State>>({ active: 2 }, 'Frame states'),
            tween<Partial<State>>({ opacity: 1 }, { duration: 200, easing: 'ease-in-out', label: 'show frame states' }),
            hold(750, 'Frame states'),
            tween<Partial<State>>({ opacity: 0 }, { duration: 200, easing: 'ease-in-out', label: 'change to GIF file' }),
            keyframe<Partial<State>>({ active: 3 }, 'GIF file'),
            tween<Partial<State>>({ opacity: 1 }, { duration: 200, easing: 'ease-in-out', label: 'show GIF file' }),
            hold(1000, 'Export complete'),
            tween<Partial<State>>({ opacity: 0 }, { duration: 300, easing: 'ease-in-out', label: 'hide before reset' }),
            keyframe<Partial<State>>({ active: 0 }, 'reset hidden'),
        ],
        fps: 20,
        render: (state) => buildFrame(theme, state.active, state.opacity),
    })
}

export default create('dark')
