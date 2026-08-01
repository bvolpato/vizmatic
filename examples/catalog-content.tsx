import {
    Badge,
    BadgePill,
    CalloutCard,
    CodeBlock,
    Column,
    Comparison,
    DetailList,
    EquationCard,
    getThemeColors,
    GradientChip,
    Icon,
    KeyValueList,
    MathText,
    MetricCard,
    Panel,
    Row,
    Scene,
    StepCard,
    SvgMathText,
    TextLabel,
    TileGrid,
    ToneStrip,
    type ThemeMode,
    ValuePill,
    Watermark,
} from 'vizmatic'

export const width = 1120
export const height = 780

export const watermark = (
    <Watermark text="Vizmatic · content catalog" position="bottom-right" opacity={0.88} />
)

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Content catalog"
            subtitle="text, tokens, cards, lists, code, comparisons, and tile systems"
            background={c.bg}
            padding={28}
            gap={12}
        >
            <Row width="100%" gap={12} align="stretch">
                <Panel c={c} title="Inline language" subtitle="ToneStrip · Icon · TextLabel · MathText · SvgMathText" tone="purple" width={540} minHeight={148}>
                    <Row gap={12} wrap align="center" justify="start">
                        <Row gap={7}>
                            <ToneStrip tone="purple" width={42} height={6} />
                            <TextLabel c={c} text="ToneStrip" fontSize={11} mono />
                        </Row>
                        <Row gap={7}>
                            <Icon c={c} name="spark" tone="purple" size={20} />
                            <TextLabel c={c} text="Icon" fontSize={11} mono />
                        </Row>
                        <TextLabel c={c} text="TextLabel" fontSize={12} color={c.textPrimary} />
                        <TextLabel c={c} text={`MathText: ${MathText({ text: 'x_i^2' })}`} fontSize={12} mono color={c.textPrimary} />
                    </Row>
                    <Row gap={8} align="center">
                        <TextLabel c={c} text="SvgMathText" fontSize={11} mono />
                        <svg width="150" height="30" viewBox="0 0 150 30">
                            <SvgMathText text="E = mc^2" x={4} y={15} fill={c.textPrimary} fontSize={13} textAnchor="start" />
                        </svg>
                    </Row>
                </Panel>
                <Panel c={c} title="Tokens and values" subtitle="Badge · BadgePill · GradientChip · ValuePill" tone="cyan" width={524} minHeight={148}>
                    <Row gap={10} align="center" justify="start">
                        <Column gap={8} align="start">
                            <Badge c={c} label="Badge" color="secondary" />
                            <BadgePill c={c} text="BadgePill" tone="cyan" fontSize={11} />
                        </Column>
                        <GradientChip c={c} title="GradientChip" subtitle="high-signal label" tone="cyan" width={174} minHeight={74} />
                        <ValuePill c={c} label="ValuePill" value="42 ms" detail="p95 render" tone="green" width={132} />
                    </Row>
                </Panel>
            </Row>

            <Row width="100%" gap={12} align="stretch">
                <EquationCard c={c} title="EquationCard" formula="rate = work / time" result="8.4" detail="units / second" tone="purple" width={212} math />
                <StepCard c={c} eyebrow="01" title="StepCard" subtitle="named stage" tone="blue" width={194} minHeight={132} />
                <MetricCard c={c} label="MetricCard" value="98.7%" detail="healthy output" tone="green" width={178} minHeight={132} />
                <CalloutCard c={c} title="CalloutCard" detail="Emphasize one decision, caveat, or result without interrupting narrative flow." tone="ocean" width={462} minHeight={132} align="left" />
            </Row>

            <Panel c={c} title="Structured content" subtitle="DetailList · CodeBlock · Comparison · KeyValueList · TileGrid · Tile" tone="warm" width="100%" minHeight={286}>
                <Row width="100%" gap={12} align="stretch" justify="center">
                    <Column gap={8} align="stretch" width={170}>
                        <TextLabel c={c} text="DetailList" fontSize={11} mono color={c.textMuted} />
                        <DetailList c={c} tone="warm" fontSize={11} items={["named detail", "small row", "semantic tone"]} />
                    </Column>
                    <Column gap={8} align="stretch" width={202}>
                        <TextLabel c={c} text="CodeBlock" fontSize={11} mono color={c.textMuted} />
                        <CodeBlock
                            c={c}
                            title="content.tsx"
                            tone="purple"
                            fontSize={12}
                            showLineNumbers
                            lines={[{ text: 'render(content)', tone: 'purple' }, { text: 'theme: active' }, { text: 'status: ready', tone: 'green' }]}
                        />
                    </Column>
                    <Column gap={8} align="stretch" width={250}>
                        <TextLabel c={c} text="Comparison" fontSize={11} mono color={c.textMuted} />
                        <Comparison
                            c={c}
                            divider
                            gap={7}
                            sideWidth={103}
                            minHeight={138}
                            sides={[
                                { title: 'dense', tone: 'critical', lines: ['one signal', 'short label'] },
                                { title: 'clear', tone: 'green', lines: ['grouped', 'scan-ready'] },
                            ]}
                        />
                    </Column>
                    <Column gap={8} align="stretch" width={165}>
                        <TextLabel c={c} text="KeyValueList" fontSize={11} mono color={c.textMuted} />
                        <KeyValueList
                            c={c}
                            fontSize={11}
                            keyMono
                            rows={[
                                { key: 'tone', value: 'ocean', tone: 'cyan' },
                                { key: 'mode', value: 'light', tone: 'green' },
                                { key: 'size', value: '11 px', tone: 'warm' },
                            ]}
                        />
                    </Column>
                    <Column gap={8} align="stretch" width={225}>
                        <TextLabel c={c} text="TileGrid + Tile" fontSize={11} mono color={c.textMuted} />
                        <TileGrid
                            c={c}
                            columns={2}
                            gap={8}
                            tileWidth={108}
                            minHeight={68}
                            tiles={[
                                { title: 'Tile', subtitle: 'primitive', tone: 'blue' },
                                { title: 'Grid', subtitle: 'layout', tone: 'purple' },
                                { title: 'Theme', subtitle: 'tokens', tone: 'cyan' },
                                { title: 'Ready', subtitle: 'export', tone: 'green' },
                            ]}
                        />
                    </Column>
                </Row>
            </Panel>
        </Scene>
    )
}

export default create('dark')
