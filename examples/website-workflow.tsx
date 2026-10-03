import { getThemeColors, GraphDiagram, Row, BadgePill, Scene, type ThemeMode } from 'vizmatic'

export const width = 720
export const height = 380

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title="An idea becomes a visual" background={c.bg} padding={28} gap={24}>
            <GraphDiagram
                c={c}
                width={664}
                height={200}
                nodeWidth={130}
                nodeHeight={74}
                labelFontSize={19}
                detailFontSize={13}
                nodes={[
                    { id: 'idea', label: 'Idea', detail: 'you or your agent', x: 0.11, y: 0.5, tone: 'blue' },
                    { id: 'scene', label: 'Scene', detail: 'editable TSX', x: 0.37, y: 0.5, tone: 'purple' },
                    { id: 'check', label: 'Check', detail: 'layout + contrast', x: 0.63, y: 0.5, tone: 'cyan' },
                    { id: 'export', label: 'Export', detail: 'ready to share', x: 0.89, y: 0.5, tone: 'green' },
                ]}
                edges={[
                    { from: 'idea', to: 'scene', tone: 'blue' },
                    { from: 'scene', to: 'check', tone: 'purple' },
                    { from: 'check', to: 'export', tone: 'cyan' },
                ]}
            />
            <Row gap={12} justify="center">
                <BadgePill c={c} text="Dark + light" tone="purple" />
                <BadgePill c={c} text="PNG / SVG / GIF" tone="green" />
            </Row>
        </Scene>
    )
}

export default create('dark')
