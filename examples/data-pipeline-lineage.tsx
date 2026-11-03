import { getThemeColors, GraphDiagram, Scene, type ThemeMode } from 'vizmatic'

// A fictional analytics platform. All schemas and volumes are illustrative.
export const width = 2200
export const height = 1200

const fields = (...rows: [string, string][]) => rows.map(([key, value]) => ({ key, value }))

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Revenue data lineage, from event to board metric"
            subtitle="Each table shows its schema, volume, and freshness. Illustrative figures. Dashed links are streaming; solid links are scheduled batch."
            background={c.bg}
        >
            <GraphDiagram
                c={c}
                ariaLabel="Data lineage from source systems through streaming ingestion, a lakehouse, dbt transformations, and metrics"
                direction="LR"
                crossingBudget={4}
                legend={[
                    { label: 'batch', style: 'solid' },
                    { label: 'stream', style: 'dashed' },
                    { label: 'PII removed here', style: 'dot', tone: 'purple' },
                    { label: 'freshness breach', style: 'dot', tone: 'warm' },
                ]}
                groups={[
                    { id: 'source', label: 'Sources', detail: 'owned by product teams' },
                    { id: 'bronze', label: 'Bronze', detail: 'raw, append only', summary: '4.2 TB/day' },
                    { id: 'silver', label: 'Silver', detail: 'typed and deduplicated', summary: '1.1 TB/day' },
                    { id: 'gold', label: 'Gold', detail: 'modeled in dbt', summary: '86 GB' },
                    { id: 'serve', label: 'Consumers' },
                ]}
                nodes={[
                    { id: 'orders', group: 'source', label: 'orders', detail: 'Postgres CDC', icon: 'database', rows: fields(['volume', '2.1k/s'], ['bytes', '41 GB/day']) },
                    { id: 'payments', group: 'source', label: 'payments', detail: 'Postgres CDC', icon: 'database', rows: fields(['volume', '1.9k/s'], ['bytes', '28 GB/day']) },
                    { id: 'clicks', group: 'source', label: 'clickstream', detail: 'Kafka, Avro', icon: 'stream', rows: fields(['volume', '184k/s'], ['bytes', '3.9 TB/day']) },
                    { id: 'crm', group: 'source', label: 'crm_accounts', detail: 'Fivetran, hourly', icon: 'globe', rows: fields(['rows', '12.4M'], ['delay', '38 min']) },

                    { id: 'rawOrders', group: 'bronze', label: 'raw.orders', detail: 'Iceberg, by day', icon: 'file', rows: fields(['id', 'uuid'], ['payload', 'json'], ['op', 'c, u, d'], ['_ts', 'timestamp']) },
                    { id: 'rawClicks', group: 'bronze', label: 'raw.events', detail: 'Iceberg, by hour', icon: 'file', rows: fields(['event_id', 'uuid'], ['user_key', 'bytes'], ['props', 'map<str,str>'], ['_ts', 'timestamp']) },

                    { id: 'flink', group: 'silver', label: 'sessionize', detail: 'Flink, 30 min gap', icon: 'stream', status: 'ok', rows: fields(['state', '380 GB'], ['lag', '41 s']) },
                    { id: 'stgOrders', group: 'silver', label: 'stg.orders', detail: '9.4B rows', icon: 'layers', status: 'ok', tags: ['PII removed'], rows: fields(['order_id', 'uuid'], ['account_id', 'bigint'], ['amount', 'decimal(12,2)'], ['currency', 'char(3)'], ['placed_at', 'timestamp']) },
                    { id: 'stgSessions', group: 'silver', label: 'stg.sessions', detail: '61B rows', icon: 'layers', status: 'ok', tags: ['PII removed'], rows: fields(['session_id', 'uuid'], ['account_id', 'bigint'], ['pages', 'int'], ['converted', 'bool']) },
                    { id: 'stgAccounts', group: 'silver', label: 'stg.accounts', detail: '12.4M rows', icon: 'layers', status: 'warn', rows: fields(['account_id', 'bigint'], ['segment', 'enum(4)'], ['region', 'char(2)'], ['freshness', '2h 14m']) },

                    { id: 'factRevenue', group: 'gold', label: 'fct_revenue', detail: 'daily, by account', icon: 'chart', status: 'ok', rows: fields(['grain', 'account, day'], ['rows', '1.8B'], ['net_usd', 'decimal(14,2)'], ['refunds', 'decimal(14,2)']) },
                    { id: 'factFunnel', group: 'gold', label: 'fct_funnel', detail: 'by segment', icon: 'chart', status: 'ok', rows: fields(['grain', 'segment, day'], ['rows', '42k'], ['cvr', 'double']) },
                    { id: 'dimAccount', group: 'gold', label: 'dim_account', detail: 'SCD type 2', icon: 'cluster', status: 'warn', rows: fields(['rows', '31M'], ['valid_from', 'date']) },

                    { id: 'metrics', group: 'serve', label: 'Metrics layer', detail: '84 definitions', icon: 'code', status: 'ok', rows: fields(['ARR', '$48.2M'], ['NRR', '114%']) },
                    { id: 'board', group: 'serve', label: 'Board deck', detail: 'monthly', icon: 'image', rows: fields(['owner', 'finance'], ['SLA', '06:00 UTC']) },
                    { id: 'reverse', group: 'serve', label: 'Reverse ETL', detail: 'to CRM', icon: 'stream', rows: fields(['synced', '12.4M'], ['errors', '0.02%']) },
                ]}
                edges={[
                    { from: 'orders', to: 'rawOrders', kind: 'async', label: '41 GB/day' },
                    { from: 'payments', to: 'rawOrders', kind: 'async', label: '28 GB/day' },
                    { from: 'clicks', to: 'rawClicks', kind: 'async', label: '3.9 TB/day' },
                    { from: 'rawOrders', to: 'stgOrders', label: '69 GB' },
                    { from: 'rawClicks', to: 'flink', kind: 'async', label: '184k/s' },
                    { from: 'flink', to: 'stgSessions', kind: 'async', label: '410 GB' },
                    { from: 'crm', to: 'stgAccounts', tone: 'warm', label: '12.4M rows' },
                    { from: 'stgOrders', to: 'factRevenue', label: 'hourly' },
                    { from: 'stgAccounts', to: 'dimAccount', tone: 'warm' },
                    { from: 'stgSessions', to: 'factFunnel', label: 'hourly' },
                    { from: 'dimAccount', to: 'factRevenue' },
                    { from: 'dimAccount', to: 'factFunnel' },
                    { from: 'factRevenue', to: 'metrics' },
                    { from: 'factFunnel', to: 'metrics' },
                    { from: 'metrics', to: 'board' },
                    { from: 'metrics', to: 'reverse' },
                ]}
                annotations={[
                    { target: 'stgAccounts', text: 'Two hours behind its one hour SLA. Everything downstream of dim_account inherits the delay.', tone: 'warm', width: 180 },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
