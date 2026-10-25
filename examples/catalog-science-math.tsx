import {
    GeometryDiagram,
    getThemeColors,
    NumberLine,
    Panel,
    Row,
    Scene,
    TextLabel,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 720

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Math · intervals and geometric proof"
            subtitle="Make endpoint conventions and measurable relationships visible in one frame."
            background={c.bg}
            padding={24}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Panel
                    c={c}
                    title="A half-open interval"
                    subtitle="The left endpoint is included; the right endpoint is excluded."
                    tone="purple"
                    width={608}
                    minHeight={510}
                    align="center"
                    padding={0}
                    footer="The hollow endpoint at 2 distinguishes x < 2 from x ≤ 2."
                >
                    <NumberLine
                        c={c}
                        width={600}
                        height={300}
                        min={-3}
                        max={3}
                        ticks={[
                            { value: -2, label: '−2' },
                            { value: -1, label: '−1' },
                            { value: 0, label: '0' },
                            { value: 1, label: '1' },
                            { value: 2, label: '2' },
                        ]}
                        markers={[{ id: 'origin', label: 'origin', value: 0, color: c.info }]}
                        interval={{
                            from: -1.5,
                            to: 2,
                            includeFrom: true,
                            includeTo: false,
                            label: '−3/2 ≤ x < 2',
                            color: c.primary,
                        }}
                    />
                    <TextLabel c={c} text="Every point on the shaded segment satisfies the inequality." fontSize={13} color={c.textSecondary} />
                </Panel>

                <Panel
                    c={c}
                    title="A 3–4–5 right triangle"
                    subtitle="Coordinates make the side lengths and right angle verifiable."
                    tone="blue"
                    width={608}
                    minHeight={510}
                    align="center"
                    padding={0}
                    footer="AB² + BC² = AC² · 4² + 3² = 5²"
                >
                    <GeometryDiagram
                        c={c}
                        width={600}
                        height={360}
                        points={[
                            { id: 'A', x: 0, y: 0, label: 'A' },
                            { id: 'B', x: 4, y: 0, label: 'B' },
                            { id: 'C', x: 4, y: 3, label: 'C' },
                        ]}
                        segments={[
                            { from: 'A', to: 'B', label: '4 units', color: c.secondary },
                            { from: 'B', to: 'C', label: '3 units', color: c.info },
                            { from: 'A', to: 'C', label: '5 units', color: c.primary },
                        ]}
                        angles={[{ vertex: 'B', from: 'A', to: 'C', label: '90°', color: c.warning }]}
                    />
                    <TextLabel c={c} text="The longest side is opposite the right angle." fontSize={13} color={c.textSecondary} />
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
