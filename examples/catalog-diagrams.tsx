import {
    getThemeColors,
    GraphDiagram,
    LayeredNetwork,
    Panel,
    Row,
    Scene,
    TreeDiagram,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 780

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Diagrams catalog"
            subtitle="LayeredNetwork · GraphDiagram automatic layout · TreeDiagram hierarchy"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="LayeredNetwork"
                subtitle="dense layers, active route, and annotations without coordinate code"
                tone="purple"
                width="100%"
                padding={14}
                align="center"
            >
                <LayeredNetwork
                    c={c}
                    width={1016}
                    height={218}
                    nodeSize={34}
                    layers={[
                        { title: 'Signal', nodes: ['x₁', 'x₂', 'x₃'], tone: 'blue' },
                        { title: 'Encode', nodes: ['h₁', 'h₂', 'h₃'], tone: 'purple' },
                        { title: 'Route', nodes: ['r₁', 'r₂'], tone: 'cyan' },
                        { title: 'Output', nodes: ['ŷ'], tone: 'green' },
                    ]}
                    activePath={[1, 1, 0, 0]}
                    annotations={['project', 'score', 'select']}
                    legend="active path"
                    showFormula={false}
                />
            </Panel>

            <Row width="100%" gap={12} align="stretch">
                <Panel
                    c={c}
                    title="GraphDiagram"
                    subtitle="automatic left-to-right layout, routed edges, and semantic nodes"
                    tone="cyan"
                    width={514}
                    padding={14}
                    align="center"
                >
                    <GraphDiagram
                        c={c}
                        width={456}
                        height={202}
                        layout="auto"
                        direction="LR"
                        sizing="fixed"
                        padding={16}
                        nodeWidth={80}
                        nodeHeight={46}
                        nodeGap={18}
                        rankGap={22}
                        labelFontSize={11}
                        detailFontSize={11}
                        nodes={[
                            { id: 'brief', label: 'Brief', detail: 'intent', tone: 'blue' },
                            { id: 'plan', label: 'Plan', detail: 'structure', tone: 'purple' },
                            { id: 'check', label: 'Check', detail: 'both themes', tone: 'cyan' },
                            { id: 'asset', label: 'Asset', detail: 'PNG + SVG', tone: 'green' },
                        ]}
                        edges={[
                            { from: 'brief', to: 'plan', tone: 'blue' },
                            { from: 'plan', to: 'check', tone: 'purple' },
                            { from: 'check', to: 'asset', tone: 'green' },
                        ]}
                    />
                </Panel>

                <Panel
                    c={c}
                    title="TreeDiagram"
                    subtitle="automatic parent/child hierarchy for systems, taxonomies, and choices"
                    tone="green"
                    width={514}
                    padding={14}
                    align="center"
                >
                    <TreeDiagram
                        c={c}
                        width={484}
                        height={202}
                        nodeWidth={112}
                        nodeHeight={44}
                        levelGap={30}
                        siblingGap={22}
                        root={{
                            label: 'Delivery',
                            detail: 'root',
                            tone: 'green',
                            children: [
                                {
                                    label: 'Visual',
                                    detail: 'composition',
                                    tone: 'blue',
                                    children: [
                                        { label: 'Diagram', detail: 'structure', tone: 'purple' },
                                        { label: 'Chart', detail: 'evidence', tone: 'cyan' },
                                    ],
                                },
                                {
                                    label: 'Proof',
                                    detail: 'validation',
                                    tone: 'warm',
                                    children: [
                                        { label: 'Dark', detail: 'contrast', tone: 'purple' },
                                        { label: 'Light', detail: 'clarity', tone: 'green' },
                                    ],
                                },
                            ],
                        }}
                    />
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
