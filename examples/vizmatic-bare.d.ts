export {}

type AutoTheme<T> = T extends (props: infer Props) => infer Result
    ? (props: Omit<Props, 'c'> & { c?: Props extends { c: infer Theme } ? Theme : never }) => Result
    : T

declare global {
    var width: number
    var height: number

    const BarChart: AutoTheme<typeof import('../src').BarChart>
    const CalloutCard: AutoTheme<typeof import('../src').CalloutCard>
    const Column: AutoTheme<typeof import('../src').Column>
    const DataTable: AutoTheme<typeof import('../src').DataTable>
    const Flow: AutoTheme<typeof import('../src').Flow>
    const GraphDiagram: AutoTheme<typeof import('../src').GraphDiagram>
    const Grid: AutoTheme<typeof import('../src').Grid>
    const LayeredNetwork: AutoTheme<typeof import('../src').LayeredNetwork>
    const LineChart: AutoTheme<typeof import('../src').LineChart>
    const MetricCard: AutoTheme<typeof import('../src').MetricCard>
    const MiniBarChart: AutoTheme<typeof import('../src').MiniBarChart>
    const Panel: AutoTheme<typeof import('../src').Panel>
    const QuadrantChart: AutoTheme<typeof import('../src').QuadrantChart>
    const Row: AutoTheme<typeof import('../src').Row>
    const ScatterPlot: AutoTheme<typeof import('../src').ScatterPlot>
    const Scene: AutoTheme<typeof import('../src').Scene>
    const StepCard: AutoTheme<typeof import('../src').StepCard>
    const TextLabel: AutoTheme<typeof import('../src').TextLabel>
    const ToneStrip: AutoTheme<typeof import('../src').ToneStrip>
}
