import {
    DataflowDiagram,
    Panel,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1400
export const height = 830

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Dataflow catalog"
            subtitle="event ingestion, contract validation, feature computation, and serving with explicit delivery modes"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="Feature pipeline"
                subtitle="schema metadata stays attached to nodes and edges while stream and batch paths remain distinct"
                tone="purple"
                width="100%"
                minHeight={690}
                padding={14}
                align="center"
                footer="Dashed edges are stream delivery; solid edges are batch delivery. Invalid records stay observable in quarantine."
            >
                <DataflowDiagram
                    c={c}
                    width={1316}
                    height={598}
                    direction="LR"
                    sizing="content"
                    nodeWidth={166}
                    nodeHeight={82}
                    nodeGap={30}
                    rankGap={56}
                    edgeGap={12}
                    padding={24}
                    labelFontSize={13}
                    detailFontSize={11}
                    iconSize={18}
                    ariaLabel="Feature dataflow from event ingestion through validation and feature computation to online serving, warehouse batch history, and invalid-event quarantine"
                    nodes={[
                        {
                            id: 'ingest',
                            label: 'Event ingest',
                            detail: 'SDK + webhook',
                            kind: 'source',
                            tone: 'blue',
                            icon: 'stream',
                            schema: {
                                name: 'Event.v1',
                                fields: [
                                    { name: 'id', type: 'uuid', required: true },
                                    { name: 'ts', type: 'int64', required: true },
                                ],
                            },
                        },
                        {
                            id: 'validate',
                            label: 'Validate + dedupe',
                            detail: 'contract gate',
                            kind: 'transform',
                            tone: 'purple',
                            icon: 'check',
                            schema: 'Valid.v1 { id, ts, user }',
                        },
                        {
                            id: 'features',
                            label: 'Build features',
                            detail: 'window + join',
                            kind: 'transform',
                            tone: 'cyan',
                            icon: 'tool',
                            schema: 'FeatureRow { id, x₁…xₙ }',
                        },
                        {
                            id: 'serving',
                            label: 'Online serving',
                            detail: 'low-latency reads',
                            kind: 'sink',
                            tone: 'green',
                            icon: 'gateway',
                            schema: 'FeatureRow { id, x₁…xₙ }',
                        },
                        {
                            id: 'warehouse',
                            label: 'Warehouse',
                            detail: 'append-only history',
                            kind: 'store',
                            tone: 'green',
                            icon: 'database',
                            schema: 'FeatureRow { id, x₁…xₙ }',
                        },
                        {
                            id: 'quarantine',
                            label: 'Quarantine',
                            detail: 'invalid + replayable',
                            kind: 'store',
                            tone: 'warm',
                            icon: 'warning',
                            schema: 'InvalidEvent { raw, reason }',
                        },
                    ]}
                    edges={[
                        { from: 'ingest', to: 'validate', mode: 'stream', label: 'stream · Event.v1', tone: 'blue' },
                        { from: 'validate', to: 'features', mode: 'stream', label: 'stream · Valid.v1', tone: 'purple' },
                        { from: 'features', to: 'serving', mode: 'stream', label: 'stream · vector', tone: 'cyan' },
                        { from: 'features', to: 'warehouse', mode: 'batch', label: 'batch · FeatureRow', tone: 'green' },
                        { from: 'validate', to: 'quarantine', mode: 'stream', label: 'stream · rejects', tone: 'warm' },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
