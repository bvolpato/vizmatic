import {
    DataTable,
    getThemeColors,
    Grid,
    Heatmap,
    Matrix,
    MiniBarChart,
    Panel,
    Row,
    Scene,
    TiledMatrix,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 650

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Data catalog"
            subtitle="matrices, tables, grids, and compact distributions for technical figures"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Row width="100%" gap={12} align="stretch">
                <Panel
                    c={c}
                    title="Matrix"
                    subtitle="numeric values with optional headers"
                    tone="blue"
                    width={338}
                    minHeight={210}
                    align="center"
                >
                    <Matrix
                        c={c}
                        title="attention weights"
                        rowLabels={['q₁', 'q₂', 'q₃']}
                        colLabels={['k₁', 'k₂', 'k₃']}
                        data={[
                            [0.82, 0.14, 0.04],
                            [0.18, 0.66, 0.16],
                            [0.06, 0.21, 0.73],
                        ]}
                        cellWidth={48}
                        cellHeight={34}
                        rowLabelWidth={32}
                    />
                </Panel>

                <Panel
                    c={c}
                    title="Heatmap"
                    subtitle="scaled intensity with named axes"
                    tone="purple"
                    width={338}
                    minHeight={210}
                    align="center"
                >
                    <Heatmap
                        c={c}
                        title="query similarity"
                        xLabels={['api', 'docs', 'sdk']}
                        yLabels={['setup', 'auth', 'test']}
                        data={[
                            [0.91, 0.43, 0.26],
                            [0.36, 0.88, 0.57],
                            [0.22, 0.54, 0.94],
                        ]}
                        cellWidth={48}
                        cellHeight={34}
                        rowLabelWidth={42}
                        colorScale="strength"
                    />
                </Panel>

                <Panel
                    c={c}
                    title="TiledMatrix"
                    subtitle="symbolic regions and block structure"
                    tone="cyan"
                    width={340}
                    minHeight={210}
                    align="center"
                >
                    <TiledMatrix
                        c={c}
                        title="TiledMatrix"
                        subtitle="causal attention mask"
                        rows={6}
                        cols={7}
                        cellSize={20}
                        gap={3}
                        tone="cyan"
                        regions={[
                            { rowStart: 0, rowEnd: 3, colStart: 0, colEnd: 3, tone: 'purple' },
                            { rowStart: 3, rowEnd: 6, colStart: 3, colEnd: 7, tone: 'green' },
                        ]}
                    />
                </Panel>
            </Row>

            <Row width="100%" gap={12} align="stretch">
                <Panel
                    c={c}
                    title="DataTable"
                    subtitle="structured rows with header bands"
                    tone="warm"
                    width={340}
                    minHeight={220}
                    align="center"
                >
                    <DataTable
                        c={c}
                        cellWidth={54}
                        firstColWidth={86}
                        cellHeight={28}
                        rows={[
                            ['DataTable', 'dark', 'light', 'ready'],
                            ['diagram', '✓', '✓', 'yes'],
                            ['data', '✓', '✓', 'yes'],
                            ['charts', '✓', '✓', 'yes'],
                        ]}
                    />
                </Panel>

                <Panel
                    c={c}
                    title="Grid"
                    subtitle="general labeled cells and tones"
                    tone="green"
                    width={280}
                    minHeight={220}
                    align="center"
                >
                    <Grid
                        c={c}
                        cellWidth={52}
                        cellHeight={34}
                        headerRows={1}
                        headerCols={1}
                        rows={[
                            ['Grid', 'A', 'B', 'C'],
                            ['α', { label: 'safe', tone: 'green' }, { label: 'watch', tone: 'warm' }, { label: 'hold', tone: 'purple' }],
                            ['β', { label: 'high', tone: 'blue' }, { label: 'mid', tone: 'cyan' }, { label: 'low', tone: 'neutral' }],
                        ]}
                    />
                </Panel>

                <Panel
                    c={c}
                    title="MiniBarChart"
                    subtitle="dense distribution for cards and dashboards"
                    tone="ocean"
                    width={396}
                    minHeight={220}
                    align="center"
                >
                    <MiniBarChart
                        c={c}
                        height={114}
                        barWidth={34}
                        gap={16}
                        showValues
                        data={[
                            { label: 'plan', value: 74, tone: 'blue', valueLabel: '74' },
                            { label: 'build', value: 92, tone: 'purple', valueLabel: '92' },
                            { label: 'check', value: 86, tone: 'cyan', valueLabel: '86' },
                            { label: 'ship', value: 98, tone: 'green', valueLabel: '98' },
                        ]}
                    />
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
