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
            subtitle="tensor shapes, residual updates, and key-value state in a decoder block"
            background={c.bg}
            padding={24}
            gap={12}
        >
            <Panel
                c={c}
                title="One pre-norm decoder block"
                subtitle="Attention and MLP each have an explicit residual update"
                tone="purple"
                width="100%"
                minHeight={560}
                padding={14}
                align="center"
                footer="Repeat this complete attention + MLP block 24 times. Shapes use B=batch, T=tokens, and d=model width; residual routes add each sublayer output to its input, and KV routes persist keys and values."
            >
                <TransformerTopology
                    c={c}
                    width={1400}
                    height={432}
                    sizing="content"
                    direction="LR"
                    nodeWidth={150}
                    nodeHeight={78}
                    nodeGap={26}
                    rankGap={38}
                    edgeGap={12}
                    padding={24}
                    labelFontSize={13}
                    detailFontSize={11}
                    iconSize={18}
                    ariaLabel="One pre-norm decoder block repeated 24 times, with attention and MLP residual additions, a key-value cache, and logits"
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
                            id: 'attention',
                            label: 'Norm → GQA',
                            kind: 'attention',
                            detail: '32Q / 8KV heads',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                        },
                        {
                            id: 'attention-residual',
                            label: 'Add attention',
                            kind: 'residual',
                            detail: 'x + attn(norm(x))',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                        },
                        {
                            id: 'mlp',
                            label: 'Norm → SwiGLU',
                            kind: 'mlp',
                            detail: 'width 11k',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
                        },
                        {
                            id: 'mlp-residual',
                            label: 'Add MLP',
                            kind: 'residual',
                            detail: 'x′ + MLP(norm(x′))',
                            shape: { dims: ['B', 'T', 'd'], dtype: 'bf16' },
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
                        { id: 'embed-attn', from: 'tokens', to: 'attention', kind: 'activation', label: 'input x' },
                        { id: 'attn-output', from: 'attention', to: 'attention-residual', kind: 'activation' },
                        { id: 'attention-skip', from: 'tokens', to: 'attention-residual', kind: 'residual', arrow: 'forward' },
                        { id: 'attn-kv', from: 'attention', to: 'kv', kind: 'kv-cache', label: 'cache K/V' },
                        { id: 'attention-mlp', from: 'attention-residual', to: 'mlp', kind: 'activation' },
                        { id: 'mlp-output', from: 'mlp', to: 'mlp-residual', kind: 'activation' },
                        { id: 'mlp-skip', from: 'attention-residual', to: 'mlp-residual', kind: 'residual', arrow: 'forward' },
                        { id: 'to-logits', from: 'mlp-residual', to: 'logits', kind: 'activation', label: 'after 24 layers' },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
