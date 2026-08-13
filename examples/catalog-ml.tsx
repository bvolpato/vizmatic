import {
    Panel,
    Scene,
    TransformerTopology,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1750
export const height = 700

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="ML topology catalog"
            subtitle="tensor shapes, repeated blocks, residual paths, KV state, and collective communication"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="Decoder-only transformer"
                subtitle="one compact block stands for ×24 layers; typed routes expose data, state, residual, and rank-level paths"
                tone="purple"
                width="100%"
                minHeight={560}
                padding={14}
                align="center"
                footer="Shapes use B=batch, T=tokens, H=heads, and d=model width. Dashed routes are residual or collective; dotted routes persist KV state."
            >
                <TransformerTopology
                    c={c}
                    width={1666}
                    height={432}
                    sizing="content"
                    direction="LR"
                    nodeWidth={174}
                    nodeHeight={82}
                    nodeGap={30}
                    rankGap={52}
                    edgeGap={12}
                    padding={26}
                    labelFontSize={13}
                    detailFontSize={11}
                    iconSize={18}
                    ariaLabel="Decoder transformer topology from token embeddings through normalized attention and repeated MLP blocks to logits, including residual, KV-cache, and all-reduce routes"
                    blocks={[
                        {
                            id: 'tokens',
                            label: 'Token embed',
                            kind: 'embedding',
                            detail: 'vocab 128k',
                            inputShape: { dims: ['B', 'T'], dtype: 'int32' },
                            outputShape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                        },
                        {
                            id: 'norm',
                            label: 'RMSNorm',
                            kind: 'norm',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                            tone: 'neutral',
                        },
                        {
                            id: 'attention',
                            label: 'GQA attention',
                            kind: 'attention',
                            detail: '32Q / 8KV heads',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                        },
                        {
                            id: 'mlp',
                            label: 'SwiGLU MLP',
                            kind: 'mlp',
                            detail: 'expert width 11k',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                            repeat: 24,
                        },
                        {
                            id: 'kv',
                            label: 'KV cache',
                            kind: 'custom',
                            detail: 'paged state',
                            shape: { dims: ['B', '8', 'T', '128'], dtype: 'bf16' },
                            tone: 'cyan',
                        },
                        {
                            id: 'logits',
                            label: 'Logits',
                            kind: 'output',
                            inputShape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                            outputShape: { dims: ['B', 'T', 'V'], dtype: 'bf16' },
                        },
                    ]}
                    routes={[
                        { id: 'embed-norm', from: 'tokens', to: 'norm', kind: 'activation', label: 'hidden · [B×T×d]', shape: ['B', 'T', 'd'] },
                        { id: 'norm-attn', from: 'norm', to: 'attention', kind: 'activation', label: 'QKV · [B×T×d]', shape: ['B', 'T', 'd'] },
                        { id: 'attn-mlp', from: 'attention', to: 'mlp', kind: 'activation', label: 'context · [B×T×d]', shape: ['B', 'T', 'd'] },
                        { id: 'attn-kv', from: 'attention', to: 'kv', kind: 'kv-cache', label: 'persist K/V', shape: ['B', '8', 'T', '128'] },
                        { id: 'norm-residual', from: 'norm', to: 'mlp', kind: 'residual', label: 'residual · x + f(x)', arrow: 'both' },
                        { id: 'mlp-collective', from: 'mlp', to: 'logits', kind: 'collective', label: 'all-reduce · 8 ranks', collective: 'all-reduce', arrow: 'both' },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
