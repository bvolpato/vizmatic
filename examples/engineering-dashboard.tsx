import {
    BarChart,
    DataTable,
    DiagramLegend,
    FactRows,
    Heatmap,
    LineChart,
    MetricStrip,
    Panel,
    Row,
    Scene,
    SmallMultiples,
    StatusList,
    Timeline,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

// A fictional platform on one printable page. All figures are illustrative.
export const width = 1500
export const height = 1050

const wave = (base: number, swing: number, seed: number, length = 28) =>
    Array.from({ length }, (_, i) => Math.round(base + swing * Math.sin(i / 3 + seed) + swing * 0.4 * Math.sin(i * 1.7 + seed * 2)))

const hours = ['00', '03', '06', '09', '12', '15', '18', '21']
const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1']
const latency = regions.map((_, r) => hours.map((_, h) => Math.min(1, 0.18 + 0.1 * r + 0.34 * Math.max(0, Math.sin((h + r) / 2.2)))))

/** One source for print and for a room. At presentation density every panel scales with its type. */
export function createAt(theme: ThemeMode, density: 'dense' | 'presentation') {
    const c = getThemeColors(theme, 'default', { density })
    const k = density === 'presentation' ? 1.66 : 1
    const w = (value: number) => Math.round(value * k)

    return (
        <Scene
            c={c}
            title="Platform health, week 44"
            subtitle="Monday 09:00 UTC. All figures illustrative. Budgets are 28-day rolling. Dashed lines mark SLO targets."
            background={c.bg}
            gap={10}
        >
            <Row gap={10} align="stretch" justify="start" width="100%">
                <Panel c={c} title="Reliability" width={w(366)} gap={6}>
                    <MetricStrip c={c} metrics={[
                        { label: 'availability', value: '99.971', unit: '%', spark: wave(90, 6, 1) },
                        { label: 'budget left', value: '62', unit: '%', bar: 0.62 },
                        { label: 'open incidents', value: '2', tone: 'warm' },
                    ]} />
                </Panel>
                <Panel c={c} title="Delivery" width={w(366)} gap={6}>
                    <MetricStrip c={c} metrics={[
                        { label: 'deploys / day', value: '184', spark: wave(180, 30, 2) },
                        { label: 'change fail', value: '1.8', unit: '%', spark: wave(18, 4, 3) },
                        { label: 'lead time', value: '42', unit: 'min' },
                    ]} />
                </Panel>
                <Panel c={c} title="Cost" width={w(366)} gap={6}>
                    <MetricStrip c={c} metrics={[
                        { label: 'run rate', value: '$1.21', unit: 'M/mo', spark: wave(120, 8, 4) },
                        { label: 'per 1k req', value: '$0.018' },
                        { label: 'GPU idle', value: '11', unit: '%', bar: 0.11 },
                    ]} />
                </Panel>
                <Panel c={c} title="On call" width={w(324)} gap={6}>
                    <FactRows c={c} rows={[
                        { key: 'pages this week', value: '14' },
                        { key: 'after hours', value: '3' },
                        { key: 'median ack', value: '2m 40s' },
                    ]} />
                </Panel>
            </Row>

            <Panel c={c} title="p99 latency by service" subtitle="Last 14 days, each with its own SLO. Shared scale, in milliseconds." gap={6}>
                <SmallMultiples c={c} columns={6} cellWidth={w(224)} cellHeight={w(40)} sharedScale items={[
                    { label: 'gateway', value: '41', unit: 'ms', status: 'ok', values: wave(40, 5, 1), reference: 120 },
                    { label: 'identity', value: '22', unit: 'ms', status: 'ok', values: wave(24, 3, 2), reference: 120 },
                    { label: 'catalog', value: '31', unit: 'ms', status: 'ok', values: wave(32, 5, 3), reference: 120 },
                    { label: 'search', value: '184', unit: 'ms', status: 'warn', tone: 'warm', values: wave(150, 34, 4), reference: 120 },
                    { label: 'cart', value: '27', unit: 'ms', status: 'ok', values: wave(28, 4, 5), reference: 120 },
                    { label: 'pricing', value: '18', unit: 'ms', status: 'ok', values: wave(19, 2, 6), reference: 120 },
                    { label: 'checkout', value: '212', unit: 'ms', status: 'warn', tone: 'warm', values: wave(180, 26, 7), reference: 120 },
                    { label: 'payments', value: '148', unit: 'ms', status: 'warn', tone: 'warm', values: wave(130, 16, 8), reference: 120 },
                    { label: 'ledger', value: '12', unit: 'ms', status: 'ok', values: wave(13, 2, 9), reference: 120 },
                    { label: 'orders', value: '64', unit: 'ms', status: 'ok', values: wave(60, 8, 10), reference: 120 },
                    { label: 'inventory', value: '24', unit: 'ms', status: 'ok', values: wave(24, 3, 11), reference: 120 },
                    { label: 'features', value: '4', unit: 'ms', status: 'ok', values: wave(5, 1, 12), reference: 120 },
                ]} />
            </Panel>

            <Row gap={10} align="stretch" justify="start" width="100%">
                <Panel c={c} title="Error budget burn" width={w(500)} gap={4}>
                    <LineChart c={c} width={w(476)} height={w(190)} format="percent" showPoints={false} labels={['W41', 'W42', 'W43', 'W44']} series={[
                        { name: 'checkout', points: [0.96, 0.88, 0.74, 0.58], color: 'warning' },
                        { name: 'search', points: [0.92, 0.81, 0.72, 0.62], color: 'primary' },
                        { name: 'gateway', points: [0.99, 0.97, 0.96, 0.95], color: 'positive' },
                    ]} />
                </Panel>
                <Panel c={c} title="Latency heat, by region and hour" width={w(440)} gap={4}>
                    <Heatmap c={c} data={latency} xLabels={hours} yLabels={regions} cellWidth={w(38)} cellHeight={w(38)} rowLabelWidth={w(62)} colorDomain={[0, 1]} labels={latency.map((row) => row.map((value) => `${Math.round(60 + value * 240)}`))} />
                </Panel>
                <Panel c={c} title="Cost by team" width={w(492)} gap={4}>
                    <BarChart c={c} width={w(468)} height={w(190)} format={(value) => `$${value}k`} data={[
                        { label: 'inference', value: 512 },
                        { label: 'search', value: 188 },
                        { label: 'data', value: 164 },
                        { label: 'commerce', value: 142 },
                        { label: 'edge', value: 96 },
                        { label: 'other', value: 108 },
                    ]} />
                </Panel>
            </Row>

            <Row gap={10} align="stretch" justify="start" width="100%">
                <Panel c={c} title="Slowest endpoints" width={w(630)} gap={4}>
                    <DataTable c={c} width="100%" align={['left', 'left', 'right', 'right', 'right', 'right']} rows={[
                        ['Endpoint', 'Owner', 'Traffic', 'p50', 'p99', 'Errors'],
                        ['POST /v2/checkout', 'payments', '1.9k/s', '88 ms', '212 ms', '0.04%'],
                        ['GET /v1/search', 'discovery', '6.2k/s', '42 ms', '184 ms', '0.11%'],
                        ['POST /v1/payments', 'payments', '1.9k/s', '61 ms', '148 ms', '0.02%'],
                        ['GET /v1/recommend', 'ml-platform', '3.4k/s', '38 ms', '96 ms', '0.01%'],
                        ['GET /v1/orders', 'commerce', '2.0k/s', '21 ms', '64 ms', '0.01%'],
                        ['GET /v2/inventory', 'commerce', '3.3k/s', '9 ms', '24 ms', '0.00%'],
                        ['GET /v1/catalog', 'discovery', '14k/s', '11 ms', '31 ms', '0.00%'],
                    ]} />
                </Panel>
                <Panel c={c} title="This week" width={w(440)} gap={4}>
                    <Timeline c={c} gap={0} events={[
                        { time: 'Mon 09:41', title: 'Clickstream consumer stalled', detail: 'Lag 4m. Rebalance loop on two brokers.', tone: 'red' },
                        { time: 'Tue 14:12', title: 'Search reindex finished', detail: 'Heap stayed above 85% afterward.', tone: 'warm' },
                        { time: 'Thu 02:30', title: 'Decode pool scaled to 1,160', detail: 'Queue p99 back below 200 ms.', tone: 'green' },
                    ]} />
                </Panel>
                <Panel c={c} title="Open actions" width={w(362)} gap={4}>
                    <StatusList c={c} gap={2} rows={[
                        { label: 'Split search heap by index', detail: 'Wed', status: 'warn' },
                        { label: 'Add retry budget to fraud', detail: 'Fri', status: 'pending' },
                        { label: 'Backfill clickstream gap', detail: 'done', status: 'check' },
                        { label: 'Drill failover for ledger', detail: 'Nov 12', status: 'pending' },
                        { label: 'Shrink decode warm spares', detail: 'Nov 14', status: 'pending' },
                        { label: 'Rotate gateway signing keys', detail: 'done', status: 'check' },
                        { label: 'Review cache eviction policy', detail: 'Nov 18', status: 'pending' },
                    ]} />
                    <DiagramLegend c={c} items={[
                        { label: 'within SLO', style: 'dot', tone: 'green' },
                        { label: 'over SLO', style: 'dot', tone: 'warm' },
                        { label: 'SLO target', style: 'dashed' },
                    ]} />
                </Panel>
            </Row>
        </Scene>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return createAt(theme, 'dense')
}

export default create('dark')
