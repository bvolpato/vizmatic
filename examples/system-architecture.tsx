import {
    getThemeColors,
    GraphDiagram,
    Scene,
    type ThemeMode,
} from 'vizmatic'

export const width = 1600
export const height = 720

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Checkout system architecture"
            subtitle="Nested boundaries, technical icons, protocols, and synchronous or asynchronous relationships"
            background={c.bg}
            padding={28}
            gap={16}
        >
            <GraphDiagram
                c={c}
                width={1544}
                height={574}
                sizing="fixed"
                direction="LR"
                ariaLabel="Checkout system architecture"
                nodeWidth={132}
                nodeHeight={62}
                nodeGap={34}
                rankGap={46}
                edgeGap={18}
                labelFontSize={12}
                detailFontSize={11}
                iconSize={20}
                groups={[
                    { id: 'edge', label: 'Edge', detail: 'public', tone: 'cyan' },
                    { id: 'production', label: 'Production', detail: 'private network', tone: 'blue' },
                    { id: 'services', label: 'Services', parent: 'production', tone: 'purple' },
                    { id: 'data', label: 'Data', parent: 'production', tone: 'green' },
                ]}
                nodes={[
                    { id: 'customer', label: 'Customer', detail: 'web + mobile', icon: 'user', tone: 'blue' },
                    { id: 'cdn', label: 'CDN', detail: 'static assets', icon: 'cloud', group: 'edge', tone: 'cyan' },
                    { id: 'gateway', label: 'API gateway', detail: 'auth + routing', icon: 'gateway', group: 'services', tone: 'warm' },
                    { id: 'checkout', label: 'Checkout', detail: 'TypeScript', icon: 'server', group: 'services', tone: 'purple' },
                    { id: 'events', label: 'Order events', detail: 'durable queue', icon: 'queue', group: 'services', tone: 'warm' },
                    { id: 'inventory', label: 'Inventory', detail: 'worker', icon: 'container', group: 'services', tone: 'purple' },
                    { id: 'cache', label: 'Redis', detail: 'session cache', icon: 'cache', group: 'data', tone: 'cyan' },
                    { id: 'orders', label: 'Postgres', detail: 'orders', icon: 'database', group: 'data', tone: 'green' },
                ]}
                edges={[
                    { from: 'customer', to: 'cdn', label: 'HTTPS', kind: 'sync', tone: 'blue' },
                    { from: 'cdn', to: 'gateway', label: 'HTTPS', kind: 'sync', tone: 'cyan' },
                    { from: 'gateway', to: 'checkout', label: 'REST', kind: 'sync', arrow: 'both', tone: 'purple' },
                    { from: 'checkout', to: 'cache', label: 'GET / SET', kind: 'data', tone: 'cyan' },
                    { from: 'checkout', to: 'orders', label: 'SQL', kind: 'data', tone: 'green' },
                    { from: 'checkout', to: 'events', label: 'publish', kind: 'event', tone: 'warm' },
                    { from: 'events', to: 'inventory', label: 'consume', kind: 'async', tone: 'purple' },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
