import { getThemeColors, GraphDiagram, Scene, type ThemeMode } from 'vizmatic'

// A fictional marketplace. All figures are illustrative.
export const width = 2600
export const height = 1700

const service = (rps: string, p99: string, replicas: string) => [
    { key: 'traffic', value: rps },
    { key: 'p99', value: p99 },
    { key: 'replicas', value: replicas },
]

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Meridian marketplace, production system map"
            subtitle="32 services and stores at weekday peak. Illustrative figures. Dashed links are asynchronous; the highlighted path is the checkout write path."
            background={c.bg}
        >
            <GraphDiagram
                c={c}
                ariaLabel="Production system map of a marketplace across edge, commerce, payments, streaming, storage, and analytics"
                direction="LR"
                crossingBudget={24}
                legend={[
                    { label: 'synchronous', style: 'solid' },
                    { label: 'asynchronous', style: 'dashed' },
                    { label: 'checkout write path', style: 'solid', tone: 'blue' },
                    { label: 'over SLO', style: 'dot', tone: 'warm' },
                    { label: 'incident', style: 'dot', tone: 'red' },
                ]}
                groups={[
                    { id: 'clients', label: 'Clients', summary: '2.4M sessions' },
                    { id: 'edge', label: 'Edge', detail: '14 PoPs', summary: '61k rps' },
                    { id: 'commerce', label: 'Commerce', detail: 'us-east-1, eu-west-1', summary: '38k rps · 99.97%' },
                    { id: 'pci', label: 'Payments', detail: 'PCI zone', summary: '1.9k rps · 99.99%' },
                    { id: 'stream', label: 'Streaming', detail: 'Kafka 3.8', summary: '410 MB/s' },
                    { id: 'stores', label: 'Stores', summary: '142 TB' },
                    { id: 'analytics', label: 'Analytics', detail: 'hourly', summary: '6.1 PB' },
                ]}
                nodes={[
                    { id: 'web', group: 'clients', label: 'Web', detail: 'Next.js 15', icon: 'browser', rows: [{ key: 'sessions', value: '1.6M' }, { key: 'LCP p75', value: '1.9 s' }] },
                    { id: 'mobile', group: 'clients', label: 'Mobile', detail: 'iOS, Android', icon: 'mobile', rows: [{ key: 'sessions', value: '780k' }, { key: 'crash free', value: '99.91%' }] },
                    { id: 'partners', group: 'clients', label: 'Partner API', detail: 'REST, 212 keys', icon: 'code', rows: [{ key: 'traffic', value: '4.1k rps' }, { key: '4xx', value: '0.8%' }] },

                    { id: 'cdn', group: 'edge', label: 'CDN', detail: 'cache hit 94%', icon: 'cloud', status: 'ok', rows: [{ key: 'egress', value: '48 Gb/s' }, { key: 'origin', value: '3.7k rps' }] },
                    { id: 'waf', group: 'edge', label: 'WAF', detail: '2,140 rules', icon: 'firewall', status: 'ok', rows: [{ key: 'blocked', value: '1.2%' }, { key: 'added p99', value: '1.8 ms' }] },
                    { id: 'gateway', group: 'edge', label: 'API gateway', detail: 'Envoy 1.31', icon: 'gateway', status: 'ok', rows: service('38k rps', '41 ms', '48') },
                    { id: 'auth', group: 'edge', label: 'Identity', detail: 'OIDC, JWT', icon: 'lock', status: 'ok', rows: service('9.4k rps', '22 ms', '16') },

                    { id: 'catalog', group: 'commerce', label: 'Catalog', detail: 'Go', icon: 'layers', status: 'ok', rows: service('14k rps', '31 ms', '36') },
                    { id: 'search', group: 'commerce', label: 'Search', detail: 'Rust', icon: 'spark', status: 'warn', rows: service('6.2k rps', '184 ms', '28'), tags: ['SLO 150 ms'] },
                    { id: 'cart', group: 'commerce', label: 'Cart', detail: 'Go', icon: 'container', status: 'ok', rows: service('5.1k rps', '27 ms', '18') },
                    { id: 'checkout', group: 'commerce', label: 'Checkout', detail: 'Kotlin', icon: 'server', tone: 'blue', status: 'ok', rows: service('1.9k rps', '212 ms', '24'), spark: [38, 41, 44, 40, 52, 58, 61, 64, 60, 72, 69, 74] },
                    { id: 'pricing', group: 'commerce', label: 'Pricing', detail: 'Java', icon: 'chart', status: 'ok', rows: service('8.8k rps', '18 ms', '20') },
                    { id: 'inventory', group: 'commerce', label: 'Inventory', detail: 'Go', icon: 'stream', status: 'ok', rows: service('3.3k rps', '24 ms', '14') },
                    { id: 'orders', group: 'commerce', label: 'Orders', detail: 'Kotlin', icon: 'file', tone: 'blue', status: 'ok', rows: service('2.0k rps', '64 ms', '18') },

                    { id: 'payments', group: 'pci', label: 'Payments', detail: 'Kotlin', icon: 'tool', tone: 'blue', status: 'ok', rows: service('1.9k rps', '148 ms', '16') },
                    { id: 'fraud', group: 'pci', label: 'Fraud scoring', detail: 'Python, XGBoost', icon: 'agent', status: 'ok', rows: service('1.9k rps', '38 ms', '12') },
                    { id: 'ledger', group: 'pci', label: 'Ledger', detail: 'double entry', icon: 'database', tone: 'blue', status: 'ok', rows: service('2.6k tps', '12 ms', '6') },
                    { id: 'psp', group: 'pci', label: 'Card networks', detail: 'external', icon: 'globe', status: 'idle', muted: false, rows: [{ key: 'auth rate', value: '96.4%' }, { key: 'p99', value: '1.1 s' }] },

                    { id: 'events', group: 'stream', label: 'Order events', detail: '48 partitions', icon: 'queue', status: 'ok', rows: [{ key: 'in', value: '2.1k msg/s' }, { key: 'lag', value: '0.4 s' }] },
                    { id: 'clicks', group: 'stream', label: 'Clickstream', detail: '256 partitions', icon: 'queue', status: 'error', rows: [{ key: 'in', value: '184k msg/s' }, { key: 'lag', value: '4m 12s' }], tags: ['consumer stalled'] },
                    { id: 'notify', group: 'stream', label: 'Notifications', detail: 'email, push', icon: 'monitor', status: 'ok', rows: [{ key: 'sent', value: '310/s' }, { key: 'bounce', value: '0.3%' }] },
                    { id: 'fulfil', group: 'stream', label: 'Fulfilment', detail: 'workers', icon: 'container', status: 'ok', rows: [{ key: 'jobs', value: '1.8k/s' }, { key: 'retries', value: '0.6%' }] },

                    { id: 'pgorders', group: 'stores', label: 'Orders DB', detail: 'Postgres 16', icon: 'database', status: 'ok', rows: [{ key: 'size', value: '18 TB' }, { key: 'disk', value: '62%', bar: 0.62 }, { key: 'replica lag', value: '80 ms' }] },
                    { id: 'pgledger', group: 'pci', label: 'Ledger DB', detail: 'Postgres 16', icon: 'database', status: 'ok', rows: [{ key: 'size', value: '6 TB' }, { key: 'disk', value: '41%', bar: 0.41 }, { key: 'replica lag', value: '12 ms' }] },
                    { id: 'redis', group: 'stores', label: 'Session cache', detail: 'Redis 7', icon: 'cache', status: 'warn', rows: [{ key: 'hit rate', value: '97.2%' }, { key: 'memory', value: '88%', bar: 0.88 }] },
                    { id: 'elastic', group: 'stores', label: 'Search index', detail: 'OpenSearch', icon: 'storage', status: 'warn', rows: [{ key: 'docs', value: '2.1B' }, { key: 'heap', value: '86%', bar: 0.86 }] },
                    { id: 's3', group: 'stores', label: 'Media', detail: 'object store', icon: 'bucket', status: 'ok', rows: [{ key: 'size', value: '124 TB' }, { key: 'put', value: '2.2k/s' }] },

                    { id: 'flink', group: 'analytics', label: 'Stream jobs', detail: 'Flink, 22 jobs', icon: 'stream', status: 'error', rows: [{ key: 'state', value: '1.4 TB' }, { key: 'checkpoint', value: 'failing' }] },
                    { id: 'lake', group: 'analytics', label: 'Lakehouse', detail: 'Iceberg', icon: 'layers', status: 'ok', rows: [{ key: 'size', value: '6.1 PB' }, { key: 'freshness', value: '14 min' }] },
                    { id: 'warehouse', group: 'analytics', label: 'Warehouse', detail: 'dbt, 1,420 models', icon: 'chart', status: 'ok', rows: [{ key: 'queries', value: '48k/day' }, { key: 'p95', value: '6.2 s' }] },
                    { id: 'features', group: 'analytics', label: 'Feature store', detail: '310 features', icon: 'spark', status: 'ok', rows: [{ key: 'reads', value: '7.2k rps' }, { key: 'p99', value: '4 ms' }] },
                ]}
                edges={[
                    { from: 'web', to: 'cdn', label: '41 Gb/s' },
                    { from: 'mobile', to: 'cdn', label: '7 Gb/s' },
                    { from: 'web', to: 'waf' },
                    { from: 'mobile', to: 'waf' },
                    { from: 'partners', to: 'waf', label: '4.1k rps' },
                    { from: 'cdn', to: 's3', muted: true },
                    { from: 'waf', to: 'gateway', label: '38k rps' },
                    { from: 'gateway', to: 'auth', label: '9.4k rps' },
                    { from: 'auth', to: 'redis' },
                    { from: 'gateway', to: 'catalog' },
                    { from: 'gateway', to: 'search' },
                    { from: 'gateway', to: 'cart' },
                    { from: 'gateway', to: 'checkout', tone: 'blue', emphasis: true, label: '1.9k rps' },
                    { from: 'catalog', to: 'pricing' },
                    { from: 'cart', to: 'pricing' },
                    { from: 'cart', to: 'redis' },
                    { from: 'search', to: 'elastic', tone: 'warm', label: 'heap pressure' },
                    { from: 'catalog', to: 's3', muted: true },
                    { from: 'checkout', to: 'inventory' },
                    { from: 'checkout', to: 'orders', tone: 'blue', emphasis: true },
                    { from: 'checkout', to: 'payments', tone: 'blue', emphasis: true },
                    { from: 'payments', to: 'fraud' },
                    { from: 'payments', to: 'psp', label: '96.4% auth' },
                    { from: 'payments', to: 'ledger', tone: 'blue', emphasis: true },
                    { from: 'ledger', to: 'pgledger', tone: 'blue', emphasis: true },
                    { from: 'orders', to: 'pgorders', tone: 'blue', emphasis: true },
                    { from: 'orders', to: 'events', kind: 'async', label: '2.1k msg/s' },
                    { from: 'inventory', to: 'events', kind: 'async' },
                    { from: 'events', to: 'notify', kind: 'async' },
                    { from: 'events', to: 'fulfil', kind: 'async' },
                    { from: 'events', to: 'flink', kind: 'async' },
                    { from: 'search', to: 'clicks', kind: 'async', label: '184k msg/s' },
                    { from: 'clicks', to: 'flink', kind: 'async', tone: 'red', label: 'lag 4m' },
                    { from: 'flink', to: 'lake' },
                    { from: 'lake', to: 'warehouse' },
                    { from: 'lake', to: 'features' },
                ]}
                annotations={[
                    { target: 'clicks', text: 'Consumer group stalled at 09:41 after a rebalance.', tone: 'red', width: 150 },
                    { target: 'elastic', text: 'Heap above 85% since the 08:30 reindex.', tone: 'warm', width: 130 },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
