import {
    Column,
    Flow,
    getThemeColors,
    Panel,
    Pipeline,
    ProgressList,
    ProgressRow,
    Row,
    Scene,
    StatusList,
    StatusRow,
    TextLabel,
    Timeline,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 780

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Flows catalog"
            subtitle="status, chronology, stage routing, pipelines, and measured progress"
            background={c.bg}
            padding={30}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Panel c={c} title="StatusRow + StatusList" subtitle="compact operational state" tone="green" width={330} minHeight={232}>
                    <Column gap={9} align="stretch">
                        <StatusRow c={c} label="StatusRow" detail="single control" status="info" fontSize={12} />
                        <StatusList
                            c={c}
                            fontSize={12}
                            rows={[
                                { label: 'StatusList item', detail: 'ready', status: 'check' },
                                { label: 'Review queue', detail: '2', status: 'pending' },
                                { label: 'Latency watch', detail: 'p95', status: 'warn' },
                            ]}
                        />
                    </Column>
                </Panel>
                <Timeline
                    c={c}
                    title="Timeline"
                    subtitle="chronological milestones"
                    direction="horizontal"
                    width={714}
                    eventWidth={222}
                    gap={10}
                    events={[
                        { time: '09:12', title: 'Draft', detail: 'name stages', tone: 'blue' },
                        { time: '09:18', title: 'Check', detail: 'inspect both themes', tone: 'purple' },
                        { time: '09:24', title: 'Render', detail: 'publish poster', tone: 'green' },
                    ]}
                />
            </Row>

            <Panel c={c} title="Flow" subtitle="stage cards with semantic connectors" tone="purple" width="100%" minHeight={162} align="center">
                <Flow
                    c={c}
                    gap={8}
                    connectorLength={27}
                    connectorTone="purple"
                    stages={[
                        { title: 'Intent', subtitle: 'prompt', tone: 'blue', width: 182, minHeight: 92 },
                        { title: 'Structure', subtitle: 'scene graph', tone: 'purple', width: 182, minHeight: 92 },
                        { title: 'Validate', subtitle: 'dark + light', tone: 'cyan', width: 182, minHeight: 92 },
                        { title: 'Export', subtitle: 'PNG / SVG', tone: 'green', width: 182, minHeight: 92 },
                    ]}
                />
            </Panel>

            <Row width="100%" gap={16} align="stretch">
                <Panel c={c} title="Pipeline" subtitle="classic labeled stage chain" tone="blue" width={610} minHeight={206} align="center" justify="center">
                    <Pipeline
                        c={c}
                        title="Pipeline component"
                        stages={[
                            { label: 'Input', sublabel: 'request', icon: '↓', color: 'primary' },
                            { label: 'Build', sublabel: 'TSX', icon: '◇', color: 'secondary' },
                            { label: 'Render', sublabel: 'asset', icon: '✓', color: 'positive' },
                        ]}
                    />
                </Panel>
                <Panel c={c} title="ProgressRow + ProgressList" subtitle="scores and completion bands" tone="cyan" width={434} minHeight={206}>
                    <Column gap={13} align="stretch">
                        <ProgressRow c={c} label="ProgressRow" value={0.72} valueLabel="72%" tone="cyan" labelWidth={92} />
                        <ProgressList
                            c={c}
                            labelWidth={72}
                            rows={[
                                { label: 'layout', value: 0.96, tone: 'green' },
                                { label: 'contrast', value: 0.91, tone: 'blue' },
                                { label: 'labels', value: 1, tone: 'purple' },
                            ]}
                        />
                        <TextLabel c={c} text="ProgressList keeps comparable measures aligned." fontSize={11} mono />
                    </Column>
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
