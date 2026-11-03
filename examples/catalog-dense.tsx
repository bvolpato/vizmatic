import {
    Column,
    DiagramLegend,
    FactRows,
    InlineBar,
    MetricStrip,
    Panel,
    Row,
    Scene,
    SmallMultiples,
    Sparkline,
    StatusDot,
    TagList,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 520

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Dense information catalog"
            subtitle="Word-sized charts, fact rows, and keys for packing real data into nodes and dashboards."
            background={c.bg}
            gap={10}
        >
            <Row gap={10} align="stretch" justify="start" width="100%">
                <Panel c={c} title="MetricStrip" subtitle="Numbers with units, no card around each" width={420}>
                    <MetricStrip c={c} metrics={[
                        { label: 'p50', value: '42', unit: 'ms' },
                        { label: 'p99', value: '310', unit: 'ms', tone: 'warm', bar: 0.78 },
                        { label: 'error rate', value: '0.04', unit: '%', spark: [3, 2, 4, 2, 1, 1] },
                    ]} />
                </Panel>
                <Panel c={c} title="FactRows" subtitle="Key and value, with capacity bars" width={300}>
                    <FactRows c={c} rows={[
                        { key: 'region', value: 'us-east-1' },
                        { key: 'replicas', value: '12 / 12' },
                        { key: 'disk', value: '91%', bar: 0.91, tone: 'warm' },
                    ]} />
                </Panel>
                <Panel c={c} title="Marks" subtitle="Sparkline, InlineBar, StatusDot, TagList" width={344}>
                    <Column gap={6} align="start" width="100%">
                        <Row gap={8} justify="start">
                            <Sparkline c={c} values={[12, 14, 13, 17, 16, 21, 24, 22, 26]} width={150} height={22} area tone="blue" />
                            <StatusDot c={c} status="ok" />
                            <StatusDot c={c} status="warn" />
                            <StatusDot c={c} status="error" />
                            <StatusDot c={c} status="idle" />
                        </Row>
                        <InlineBar c={c} value={0.71} tone="blue" />
                        <TagList c={c} tags={['rust', 'us-east-1', 'tier 0']} />
                    </Column>
                </Panel>
            </Row>
            <Panel c={c} title="SmallMultiples" subtitle="One chart repeated, on one shared scale, with an SLO reference">
                <SmallMultiples c={c} columns={5} cellWidth={196} cellHeight={40} sharedScale items={[
                    { label: 'gateway', value: '41', unit: 'ms', status: 'ok', values: [38, 42, 40, 44, 41, 39, 41], reference: 120 },
                    { label: 'search', value: '184', unit: 'ms', status: 'warn', tone: 'warm', values: [120, 134, 150, 148, 162, 171, 184], reference: 120 },
                    { label: 'checkout', value: '212', unit: 'ms', status: 'warn', tone: 'warm', values: [160, 172, 180, 190, 188, 204, 212], reference: 120 },
                    { label: 'ledger', value: '12', unit: 'ms', status: 'ok', values: [14, 12, 13, 12, 11, 13, 12], reference: 120 },
                    { label: 'features', value: '4', unit: 'ms', status: 'ok', values: [5, 4, 4, 5, 4, 4, 4], reference: 120 },
                ]} />
            </Panel>
            <DiagramLegend c={c} title="Key" items={[
                { label: 'synchronous', style: 'solid' },
                { label: 'asynchronous', style: 'dashed' },
                { label: 'event', style: 'dotted' },
                { label: 'over SLO', style: 'dot', tone: 'warm' },
            ]} />
        </Scene>
    )
}

export default create('dark')
