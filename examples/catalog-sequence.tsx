import {
    Panel,
    Scene,
    SequenceDiagram,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1120
export const height = 1320

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Sequence catalog"
            subtitle="request lifecycles with typed messages, activations, notes, and control-flow fragments"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="Checkout request"
                subtitle="solid sync · dashed async · neutral returns · fragments mark alternate, repeated, and parallel work"
                tone="blue"
                width="100%"
                padding={14}
                align="center"
            >
                <SequenceDiagram
                    c={c}
                    width={930}
                    height={1040}
                    padding={24}
                    participantWidth={132}
                    participantGap={30}
                    rowHeight={38}
                    noteWidth={172}
                    title="POST /checkout"
                    ariaLabel="Authorized checkout enqueues fulfillment while the browser polls concurrently; parallel tasks complete and the order API returns ready"
                    participants={[
                        { id: 'client', label: 'Browser', kind: 'actor', icon: 'browser', tone: 'blue' },
                        { id: 'edge', label: 'Edge gateway', kind: 'boundary', icon: 'gateway', tone: 'cyan' },
                        { id: 'orders', label: 'Order API', kind: 'control', icon: 'container', tone: 'purple' },
                        { id: 'worker', label: 'Fulfillment', kind: 'entity', icon: 'agent', tone: 'green' },
                    ]}
                    items={[
                        { id: 'request', from: 'client', to: 'edge', kind: 'sync', label: 'POST /checkout' },
                        { id: 'authorize', from: 'edge', to: 'orders', kind: 'sync', label: 'authorize + create' },
                        { id: 'trace-note', type: 'note', over: ['edge', 'orders'], text: 'trace_id + idempotency key', tone: 'warm' },
                        {
                            id: 'authorization',
                            kind: 'alt',
                            branches: [
                                {
                                    id: 'authorized',
                                    label: 'authorized',
                                    items: [
                                        { id: 'enqueue', from: 'orders', to: 'worker', kind: 'async', label: 'enqueue fulfillment' },
                                        { id: 'accepted', from: 'orders', to: 'client', kind: 'return', label: '202 Accepted' },
                                        {
                                            id: 'checkout-work',
                                            kind: 'parallel',
                                            branches: [
                                                {
                                                    id: 'polling',
                                                    label: 'client polls while pending',
                                                    items: [
                                                        {
                                                            id: 'polling-loop',
                                                            kind: 'loop',
                                                            label: 'while order is pending',
                                                            items: [
                                                                { id: 'poll', from: 'client', to: 'edge', kind: 'sync', label: 'GET /orders/:id' },
                                                                { id: 'read-state', from: 'edge', to: 'orders', kind: 'sync', label: 'read status' },
                                                                { id: 'pending', from: 'orders', to: 'client', kind: 'return', label: '202 · pending' },
                                                            ],
                                                            tone: 'purple',
                                                        },
                                                    ],
                                                },
                                                {
                                                    id: 'fulfillment-work',
                                                    label: 'fulfillment tasks',
                                                    items: [
                                                        {
                                                            id: 'fulfillment-fanout',
                                                            kind: 'parallel',
                                                            branches: [
                                                                {
                                                                    id: 'reserve-stock',
                                                                    label: 'inventory',
                                                                    items: [{ id: 'reserve', from: 'orders', to: 'worker', kind: 'async', label: 'reserve stock' }],
                                                                },
                                                                {
                                                                    id: 'send-receipt',
                                                                    label: 'receipt',
                                                                    items: [{ id: 'receipt', from: 'orders', to: 'worker', kind: 'async', label: 'send receipt' }],
                                                                },
                                                            ],
                                                            tone: 'cyan',
                                                        },
                                                        { id: 'fulfilled', from: 'worker', to: 'orders', kind: 'async', label: 'fulfillment complete' },
                                                        { id: 'mark-ready', from: 'orders', to: 'orders', kind: 'sync', label: 'persist ready' },
                                                    ],
                                                },
                                            ],
                                            tone: 'cyan',
                                        },
                                        { id: 'ready-poll', from: 'client', to: 'edge', kind: 'sync', label: 'GET /orders/:id' },
                                        { id: 'ready-state', from: 'edge', to: 'orders', kind: 'sync', label: 'read status' },
                                        { id: 'ready-result', from: 'orders', to: 'client', kind: 'return', label: '200 · ready' },
                                    ],
                                },
                                {
                                    id: 'expired',
                                    label: 'expired token',
                                    items: [
                                        { id: 'unauthorized', from: 'edge', to: 'client', kind: 'return', label: '401 Unauthorized' },
                                    ],
                                },
                            ],
                            tone: 'warm',
                        },
                    ]}
                    activations={[
                        { id: 'edge-span', type: 'activation', participant: 'edge', fromMessage: 'request', toMessage: 'accepted', tone: 'cyan' },
                        { id: 'order-span', type: 'activation', participant: 'orders', fromMessage: 'authorize', toMessage: 'accepted', tone: 'purple' },
                        { id: 'worker-span', type: 'activation', participant: 'worker', fromMessage: 'enqueue', toMessage: 'fulfilled', tone: 'green' },
                        { id: 'poll-span', type: 'activation', participant: 'orders', fromMessage: 'read-state', toMessage: 'pending', depth: 1, tone: 'purple', muted: true },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
