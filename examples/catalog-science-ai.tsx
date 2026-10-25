import {
    AttentionMatrix,
    Column,
    EquationCard,
    getThemeColors,
    Panel,
    Row,
    Scene,
    scaledDotProductAttention,
    TextLabel,
    TransformerTopology,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 940

const tokens = ['The', 'robot', 'turns', 'left']
const queries = [[1, 0], [0, 1], [1, 1], [1, -1]]
const keys = [[1, 0], [0, 1], [1, 1], [-1, 1]]
const values = [[1, 0], [0, 2], [2, 1], [-1, 3]]
const attention = scaledDotProductAttention(queries, keys, values, { causal: true })
const causalMask = queries.map((_, row) => keys.map((__, column) => column <= row))
const queryIndex = 3

function formatVector(vector: readonly number[]): string {
    return `[${vector.map((value) => value.toFixed(2)).join(', ')}]`
}

function formatRows(matrix: readonly (readonly number[])[]): string {
    return matrix.map((row) => `[${row.join(', ')}]`).join(' ')
}

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    const queryWeights = attention.weights[queryIndex]
    const queryOutput = attention.output[queryIndex]
    const strongestKey = queryWeights.indexOf(Math.max(...queryWeights))

    return (
        <Scene
            c={c}
            title="AI · causal self-attention"
            subtitle="A query assigns normalized weights to current and earlier tokens, then uses them to mix value vectors."
            background={c.bg}
            padding={24}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Panel
                    c={c}
                    title="Which earlier tokens inform “left”?"
                    subtitle="The causal mask prevents each position from looking ahead."
                    tone="purple"
                    width={788}
                    minHeight={450}
                    align="center"
                    footer="Illustrative Q/K/V inputs · weights are computed by scaled dot-product attention"
                >
                    <AttentionMatrix
                        c={c}
                        width={740}
                        height={360}
                        queryLabels={tokens}
                        keyLabels={tokens}
                        weights={attention.weights}
                        mask={causalMask}
                        activeQuery={queryIndex}
                        activeKey={strongestKey}
                    />
                </Panel>

                <Panel
                    c={c}
                    title="One row, one query"
                    subtitle="Read across the highlighted query row."
                    tone="cyan"
                    width={428}
                    minHeight={450}
                >
                    <Column width="100%" gap={15} align="stretch">
                        <TextLabel c={c} text={`Computed weights for “${tokens[queryIndex]}”: ${formatVector(queryWeights)}. Highest weight: “${tokens[strongestKey]}” (${queryWeights[strongestKey].toFixed(2)}).`} fontSize={13} color={c.textPrimary} />
                        <EquationCard c={c} title="Scaled dot-product attention" formula="softmax(QKᵀ / √2) V" result={formatVector(queryOutput)} detail="weighted value for “left” · computed" tone="purple" width={366} math />
                        <Column width="100%" gap={4} align="stretch">
                            <TextLabel c={c} text={`Illustrative Q rows: ${formatRows(queries)}`} fontSize={10} mono color={c.textSecondary} />
                            <TextLabel c={c} text={`K rows: ${formatRows(keys)}`} fontSize={10} mono color={c.textSecondary} />
                            <TextLabel c={c} text={`V rows: ${formatRows(values)}`} fontSize={10} mono color={c.textSecondary} />
                        </Column>
                        <TextLabel c={c} text="A masked future key receives zero weight. Attention weights show routing strength, not a causal explanation of the model's decision." fontSize={12} color={c.textSecondary} />
                    </Column>
                </Panel>
            </Row>

            <Panel
                c={c}
                title="Where attention sits in a decoder block"
                subtitle="The attention result continues through the feed-forward network to produce next-token scores."
                tone="blue"
                width="100%"
                minHeight={282}
                align="center"
                footer="Token positions T · hidden width d · vocabulary size V"
            >
                <TransformerTopology
                    c={c}
                    width={1150}
                    height={220}
                    direction="LR"
                    nodeWidth={184}
                    nodeHeight={76}
                    nodeGap={36}
                    padding={18}
                    labelFontSize={13}
                    detailFontSize={11}
                    blocks={[
                        { id: 'embed', label: 'Token embedding', kind: 'embedding', outputShape: { dims: ['T', 'd'], dtype: 'bf16' } },
                        { id: 'attention', label: 'Self-attention', kind: 'attention', shape: { dims: ['T', 'd'], dtype: 'bf16' } },
                        { id: 'mlp', label: 'Feed-forward MLP', kind: 'mlp', shape: { dims: ['T', 'd'], dtype: 'bf16' } },
                        { id: 'logits', label: 'Next-token scores', kind: 'output', outputShape: { dims: ['T', 'V'], dtype: 'bf16' } },
                    ]}
                    routes={[
                        { id: 'embed-attention', from: 'embed', to: 'attention', kind: 'activation', label: 'hidden states' },
                        { id: 'attention-mlp', from: 'attention', to: 'mlp', kind: 'activation', label: 'context vectors' },
                        { id: 'mlp-logits', from: 'mlp', to: 'logits', kind: 'activation', label: 'scores' },
                    ]}
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
