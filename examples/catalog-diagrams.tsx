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
                        { title: 'Signal', nodes: ['x₁', 'x₂', 'x₃'] },
                        { title: 'Encode', nodes: ['h₁', 'h₂', 'h₃'] },
                        { title: 'Route', nodes: ['r₁', 'r₂'] },
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
                    subtitle="automatic layout, nested boundary, technical icons, and typed edges"
                    width={514}
                    padding={14}
                    align="center"
                >
                    <GraphDiagram
                        c={c}
                        ariaLabel="Runtime graph from brief through plan and check to an exported asset"
                        width={456}
                        height={202}
                        layout="auto"
                        direction="LR"
                        sizing="fixed"
                        padding={16}
                        nodeWidth={72}
                        nodeHeight={46}
                        nodeGap={18}
                        rankGap={22}
                        labelFontSize={11}
                        detailFontSize={11}
                        iconSize={14}
                        groups={[
                            { id: 'runtime', label: 'Runtime' },
                        ]}
                        nodes={[
                            { id: 'brief', label: 'Brief', icon: 'file', group: 'runtime' },
                            { id: 'plan', label: 'Plan', icon: 'layers', group: 'runtime' },
                            { id: 'check', label: 'Check', icon: 'monitor', group: 'runtime' },
                            { id: 'asset', label: 'Asset', icon: 'storage', group: 'runtime', tone: 'green' },
                        ]}
                        edges={[
                            { from: 'brief', to: 'plan', kind: 'sync' },
                            { from: 'plan', to: 'check', kind: 'event' },
                            { from: 'check', to: 'asset', kind: 'data' },
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
                                    children: [
                                        { label: 'Diagram', detail: 'structure' },
                                        { label: 'Chart', detail: 'evidence' },
                                    ],
                                },
                                {
                                    label: 'Proof',
                                    detail: 'validation',
                                    tone: 'warm',
                                    children: [
                                        { label: 'Dark', detail: 'contrast' },
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
