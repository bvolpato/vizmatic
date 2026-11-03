import { getThemeColors, GraphDiagram, Scene, type ThemeMode } from 'vizmatic'

// A fictional inference platform. All figures are illustrative.
export const width = 2000
export const height = 1500

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Serving a large language model at 2.4 billion tokens per hour"
            subtitle="From an API request to a streamed token. Illustrative figures at peak. Prefill and decode run on separate pools, which share work through the KV cache."
            background={c.bg}
        >
            <GraphDiagram
                c={c}
                ariaLabel="LLM serving stack from API gateway through routing, scheduling, prefill and decode GPU pools, to the streaming response"
                direction="TB"
                groupDirection="LR"
                legend={[
                    { label: 'request path', style: 'solid' },
                    { label: 'telemetry and async', style: 'dashed' },
                    { label: 'token stream', style: 'solid', tone: 'blue' },
                    { label: 'near capacity', style: 'dot', tone: 'warm' },
                ]}
                groups={[
                    { id: 'api', label: 'API tier', detail: 'stateless', summary: '41k req/s' },
                    { id: 'compute', label: 'Inference', detail: 'disaggregated', summary: '1,580 GPUs' },
                    { id: 'response', label: 'Response', detail: 'streaming and accounting', summary: '2.4B tok/h' },
                    { id: 'control', label: 'Control', detail: 'per-tenant', summary: 'p99 9 ms' },
                    { id: 'prefill', parent: 'compute', label: 'Prefill pool', detail: 'throughput optimized', summary: '420 GPUs · 71%' },
                    { id: 'decode', parent: 'compute', label: 'Decode pool', detail: 'latency optimized', summary: '1,160 GPUs · 83%' },
                    { id: 'state', parent: 'compute', label: 'Shared state', summary: '3.4 PB/h' },
                ]}
                nodes={[
                    { id: 'clients', group: 'api', label: 'Clients', detail: 'SDK, batch, chat', icon: 'user', rows: [{ key: 'sessions', value: '1.8M' }, { key: 'streaming', value: '94%' }] },
                    { id: 'gateway', group: 'api', label: 'API gateway', detail: 'HTTP/2, SSE', icon: 'gateway', status: 'ok', rows: [{ key: 'requests', value: '41k/s' }, { key: 'added p99', value: '3.1 ms' }, { key: 'open streams', value: '620k' }] },
                    { id: 'auth', group: 'api', label: 'Auth and quota', detail: 'token bucket', icon: 'lock', status: 'ok', rows: [{ key: '429 rate', value: '0.7%' }, { key: 'tenants', value: '84k' }] },
                    { id: 'safety', group: 'api', label: 'Input filter', detail: 'classifier', icon: 'firewall', status: 'ok', rows: [{ key: 'p99', value: '11 ms' }, { key: 'blocked', value: '0.02%' }] },
                    { id: 'tokenizer', group: 'api', label: 'Tokenizer', detail: 'Rust, BPE', icon: 'code', status: 'ok', rows: [{ key: 'mean input', value: '3,180 tok' }, { key: 'p99', value: '1.4 ms' }] },

                    { id: 'router', group: 'control', label: 'Model router', detail: 'version, region, tier', icon: 'network', status: 'ok', rows: [{ key: 'models', value: '14' }, { key: 'canary', value: '5%' }] },
                    { id: 'scheduler', group: 'control', label: 'Scheduler', detail: 'prefix-aware', icon: 'layers', tone: 'blue', status: 'warn', metrics: [{ label: 'queue p99', value: '180', unit: 'ms', tone: 'warm', spark: [40, 44, 60, 58, 90, 120, 150, 180] }, { label: 'admitted', value: '98.6', unit: '%' }] },
                    { id: 'autoscaler', group: 'control', label: 'Autoscaler', detail: 'prefill and decode', icon: 'chart', rows: [{ key: 'target', value: '85% GPU' }, { key: 'warm spare', value: '6%' }] },

                    { id: 'prefillA', group: 'prefill', label: 'Prefill workers', detail: 'H200, batch 32', icon: 'server', status: 'ok', metrics: [{ label: 'GPU util', value: '71', unit: '%', bar: 0.71 }, { label: 'tok/s/GPU', value: '48k' }] },
                    { id: 'embedA', group: 'prefill', label: 'Prefix hasher', detail: 'block 256 tok', icon: 'git', rows: [{ key: 'cache hit', value: '63%' }, { key: 'tokens saved', value: '1.5B/h' }] },

                    { id: 'decodeA', group: 'decode', label: 'Decode workers', detail: 'B200, continuous batch', icon: 'server', tone: 'blue', status: 'warn', metrics: [{ label: 'GPU util', value: '83', unit: '%', bar: 0.83, tone: 'warm' }, { label: 'tok/s/GPU', value: '1,180' }] },
                    { id: 'sampler', group: 'decode', label: 'Sampler', detail: 'structured output', icon: 'spark', rows: [{ key: 'TTFT p50', value: '240 ms' }, { key: 'TTFT p99', value: '1.3 s' }, { key: 'inter-token', value: '14 ms' }] },

                    { id: 'kv', group: 'state', label: 'KV cache store', detail: 'RDMA, tiered', icon: 'cache', status: 'warn', rows: [{ key: 'memory', value: '88%', bar: 0.88 }, { key: 'transfer', value: '940 GB/s' }, { key: 'eviction', value: '12k/s', tone: 'warm' }] },
                    { id: 'weights', group: 'state', label: 'Model weights', detail: 'safetensors', icon: 'bucket', rows: [{ key: 'size', value: '1.2 TB' }, { key: 'cold load', value: '48 s' }] },

                    { id: 'output', group: 'response', label: 'Output filter', detail: 'streaming', icon: 'firewall', status: 'ok', rows: [{ key: 'added p99', value: '6 ms' }, { key: 'flagged', value: '0.04%' }] },
                    { id: 'stream', group: 'response', label: 'Token stream', detail: 'SSE frames', icon: 'stream', tone: 'blue', rows: [{ key: 'output', value: '2.4B tok/h' }, { key: 'mean', value: '412 tok' }] },

                    { id: 'metering', group: 'response', label: 'Metering', detail: 'usage events', icon: 'queue', rows: [{ key: 'events', value: '41k/s' }, { key: 'lag', value: '1.2 s' }] },
                    { id: 'traces', group: 'response', label: 'Traces', detail: '1% sampled', icon: 'monitor', rows: [{ key: 'spans', value: '92k/s' }] },
                    { id: 'evals', group: 'response', label: 'Online evals', detail: '0.1% of traffic', icon: 'check', rows: [{ key: 'pass rate', value: '97.4%' }, { key: 'regressions', value: '0' }] },
                ]}
                edges={[
                    { from: 'clients', to: 'gateway', label: '41k req/s' },
                    { from: 'gateway', to: 'auth' },
                    { from: 'auth', to: 'safety' },
                    { from: 'safety', to: 'tokenizer' },
                    { from: 'tokenizer', to: 'router', label: '130M tok/s' },
                    { from: 'router', to: 'scheduler' },
                    { from: 'autoscaler', to: 'scheduler', kind: 'async' },
                    { from: 'scheduler', to: 'embedA' },
                    { from: 'embedA', to: 'prefillA', label: '37% miss' },
                    { from: 'prefillA', to: 'kv', label: 'KV write' },
                    { from: 'kv', to: 'decodeA', label: 'KV read', emphasis: true },
                    { from: 'scheduler', to: 'decodeA', label: 'slot' },
                    { from: 'weights', to: 'prefillA', muted: true },
                    { from: 'weights', to: 'decodeA', muted: true },
                    { from: 'decodeA', to: 'sampler', tone: 'blue', emphasis: true },
                    { from: 'sampler', to: 'output', tone: 'blue', emphasis: true, label: '670k tok/s' },
                    { from: 'output', to: 'stream', tone: 'blue', emphasis: true },
                    { from: 'stream', to: 'metering', kind: 'async' },
                    { from: 'stream', to: 'traces', kind: 'async' },
                    { from: 'traces', to: 'evals', kind: 'async' },
                ]}
                annotations={[
                    { target: 'scheduler', text: 'Queue time is the first signal of a capacity shortfall, ahead of GPU utilization.', tone: 'warm', width: 170 },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
