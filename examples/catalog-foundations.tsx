import {
    Canvas,
    Card,
    Column,
    getReadableColor,
    getThemeColors,
    Icon,
    Panel,
    Row,
    Scene,
    Stack,
    TextLabel,
    TitleBar,
    type ThemeMode,
    WindowFrame,
} from 'vizmatic'

export const width = 1120
export const height = 840

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    const positiveText = getReadableColor('positive', c)

    return (
        <Canvas c={c} padding={0} background={c.bg}>
            <Scene
                c={c}
                title="Foundations catalog"
                subtitle="Canvas · Scene · TitleBar · flex layouts · framed surfaces"
                background={c.bg}
                padding={30}
                gap={14}
            >
                <Row width="100%" gap={14} align="stretch">
                    <Panel c={c} title="Canvas + Scene" subtitle="root and composition layers" tone="purple" width={364} minHeight={116} justify="center">
                        <Column gap={8} align="stretch">
                            <TextLabel c={c} text="Every poster starts with a theme-aware Canvas." fontSize={12} />
                            <Row gap={8} justify="start">
                                <Icon c={c} name="layers" tone="purple" size={22} />
                                <TextLabel c={c} text="Scene keeps content aligned." fontSize={12} color={c.textPrimary} />
                            </Row>
                        </Column>
                    </Panel>
                    <Panel c={c} title="TitleBar" subtitle="standard poster header" tone="blue" width={330} minHeight={116} justify="center">
                        <TitleBar c={c} title="Named hierarchy" subtitle="title / subtitle / semantic tone" />
                    </Panel>
                    <Panel c={c} title="Layout contract" subtitle="explicit dimensions, readable spacing" tone="green" width={350} minHeight={116} justify="center">
                        <Stack direction="horizontal" gap={10} align="center">
                            <Icon c={c} name="code" tone="green" size={26} />
                            <Column gap={3} align="start">
                                <TextLabel c={c} text="1120 × 840" fontSize={15} fontWeight={900} color={c.textPrimary} mono />
                                <TextLabel c={c} text="dark + light create(theme)" fontSize={11} mono />
                            </Column>
                        </Stack>
                    </Panel>
                </Row>

                <Row width="100%" gap={14} align="stretch">
                    <Panel c={c} title="Row" subtitle="horizontal distribution" tone="cyan" width={526} minHeight={210} justify="center">
                        <Row gap={10} align="stretch" justify="center">
                            <Card c={c} title="start" tone="cyan" width={145} minHeight={116}>
                                <TextLabel c={c} text="first child" fontSize={12} />
                            </Card>
                            <Card c={c} title="gap" tone="blue" width={145} minHeight={116}>
                                <TextLabel c={c} text="shared rhythm" fontSize={12} />
                            </Card>
                            <Card c={c} title="end" tone="purple" width={145} minHeight={116}>
                                <TextLabel c={c} text="last child" fontSize={12} />
                            </Card>
                        </Row>
                    </Panel>
                    <Panel c={c} title="Column" subtitle="vertical hierarchy" tone="warm" width={518} minHeight={210}>
                        <Column gap={9} align="stretch">
                            <Card c={c} title="headline" tone="warm" padding="10px 12px">
                                <TextLabel c={c} text="Primary action or statement" fontSize={12} color={c.textPrimary} />
                            </Card>
                            <Card c={c} title="supporting detail" tone="ocean" padding="10px 12px">
                                <TextLabel c={c} text="Subordinate content stacks cleanly." fontSize={12} />
                            </Card>
                            <Card c={c} title="footer note" tone="neutral" padding="10px 12px">
                                <TextLabel c={c} text="Consistent gaps define cadence." fontSize={12} />
                            </Card>
                        </Column>
                    </Panel>
                </Row>

                <Row width="100%" gap={14} align="stretch">
                    <Panel c={c} title="Stack" subtitle="compact directional grouping" tone="green" width={300} minHeight={230} justify="center">
                        <Stack gap={11} align="stretch">
                            <Card c={c} tone="green" title="Stack item" padding="10px 12px">
                                <TextLabel c={c} text="Vertical by default" fontSize={12} />
                            </Card>
                            <Stack direction="horizontal" gap={9} align="stretch">
                                <Card c={c} tone="cyan" width={125} padding="10px">
                                    <TextLabel c={c} text="horizontal" fontSize={11} align="center" />
                                </Card>
                                <Card c={c} tone="purple" width={125} padding="10px">
                                    <TextLabel c={c} text="nested" fontSize={11} align="center" />
                                </Card>
                            </Stack>
                        </Stack>
                    </Panel>
                    <Card c={c} title="Card" subtitle="lightweight bordered surface" tone="blue" width={280} minHeight={230} gap={12}>
                        <Icon c={c} name="spark" tone="blue" size={30} />
                        <TextLabel c={c} text="Use Card for focused content with optional title, tone, and footer." fontSize={12} color={c.textPrimary} />
                        <TextLabel c={c} text="Panel adds an accent header and structured body." fontSize={11} mono />
                    </Card>
                    <WindowFrame c={c} title="WindowFrame · terminal" variant="terminal" tone="green" width={464} minHeight={230}>
                        <Column gap={10} align="stretch">
                            <TextLabel c={c} text="$ vizmatic poster.tsx" fontSize={12} mono color={c.textPrimary} />
                            <TextLabel c={c} text="✓ Canvas mounted" fontSize={12} mono color={positiveText} />
                            <TextLabel c={c} text="✓ Scene composed" fontSize={12} mono color={positiveText} />
                            <TextLabel c={c} text="✓ WindowFrame keeps chrome separate" fontSize={12} mono color={c.textSecondary} />
                        </Column>
                    </WindowFrame>
                </Row>
            </Scene>
        </Canvas>
    )
}

export default create('dark')
