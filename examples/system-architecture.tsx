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
        >
            <GraphDiagram
                c={c}
                direction="LR"
                ariaLabel="Checkout system architecture"
                groups={[
                    { id: 'edge', label: 'Edge', detail: 'public' },
                    { id: 'production', label: 'Production', detail: 'private network' },
                    { id: 'services', label: 'Services', parent: 'production' },
                    { id: 'data', label: 'Data', parent: 'production' },
                ]}
                nodes={[
                    { id: 'customer', label: 'Customer', detail: 'web + mobile', icon: 'user' },
                    { id: 'cdn', label: 'CDN', detail: 'static assets', icon: 'cloud', group: 'edge' },
                    { id: 'gateway', label: 'API gateway', detail: 'auth + routing', icon: 'gateway', group: 'services' },
                    { id: 'checkout', label: 'Checkout', detail: 'TypeScript', icon: 'server', group: 'services' },
                    { id: 'events', label: 'Order events', detail: 'durable queue', icon: 'queue', group: 'services' },
                    { id: 'inventory', label: 'Inventory', detail: 'worker', icon: 'container', group: 'services' },
                    { id: 'cache', label: 'Redis', detail: 'session cache', icon: 'cache', group: 'data' },
                    { id: 'orders', label: 'Postgres', detail: 'orders', icon: 'database', group: 'data' },
                ]}
                edges={[
                    { from: 'customer', to: 'cdn', label: 'HTTPS', kind: 'sync' },
                    { from: 'cdn', to: 'gateway', label: 'HTTPS', kind: 'sync' },
                    { from: 'gateway', to: 'checkout', label: 'REST', kind: 'sync', arrow: 'both' },
                    { from: 'checkout', to: 'cache', label: 'GET / SET', kind: 'data' },
                    { from: 'checkout', to: 'orders', label: 'SQL', kind: 'data' },
                    { from: 'checkout', to: 'events', label: 'publish', kind: 'event' },
                    { from: 'events', to: 'inventory', label: 'consume', kind: 'async' },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
