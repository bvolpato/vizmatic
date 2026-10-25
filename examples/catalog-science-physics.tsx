import {
    FreeBodyDiagram,
    getThemeColors,
    Panel,
    Row,
    Scene,
    TextLabel,
    type ThemeMode,
    WaveDiagram,
} from 'vizmatic'

export const width = 1280
export const height = 720

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Physics · net force and wave interference"
            subtitle="Resolve forces into a net vector, then see how coherent waves superpose."
            background={c.bg}
            padding={24}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Panel
                    c={c}
                    title="A cart accelerates right"
                    subtitle="Vertical forces cancel; horizontal forces leave a 5 N resultant."
                    tone="green"
                    width={608}
                    minHeight={520}
                    align="center"
                    padding={0}
                    footer="ΣFₓ = 8 N − 3 N = 5 N · ΣFᵧ = 9.8 N − 9.8 N = 0"
                >
                    <FreeBodyDiagram
                        c={c}
                        width={600}
                        height={360}
                        forces={[
                            { id: 'weight', label: 'weight · 9.8 N', x: 0, y: -9.8, color: c.primary },
                            { id: 'normal', label: 'normal · 9.8 N', x: 0, y: 9.8, color: c.info },
                            { id: 'push', label: 'push · 8 N', x: 8, y: 0, color: c.positive },
                            { id: 'drag', label: 'drag · 3 N', x: -3, y: 0, color: c.warning },
                        ]}
                        showComponents
                        showResultant
                    />
                    <TextLabel c={c} text="The resultant points right, so the cart's velocity changes in that direction." fontSize={12} color={c.textSecondary} />
                </Panel>

                <Panel
                    c={c}
                    title="In-phase wave superposition"
                    subtitle="Two equal waves add point by point to a wave with twice the amplitude."
                    tone="purple"
                    width={608}
                    minHeight={520}
                    align="center"
                    padding={0}
                    footer="Illustrative sinusoidal waves · A = 1 m each · λ = 4 m"
                >
                    <WaveDiagram
                        c={c}
                        width={600}
                        height={360}
                        waves={[
                            { amplitude: 1, wavelength: 4, phase: 0, color: c.info, label: 'wave 1 · A' },
                            { amplitude: 1, wavelength: 4, phase: 0, color: c.primary, label: 'wave 2 · A' },
                        ]}
                        time={0}
                        xMin={-4}
                        xMax={4}
                        yMin={-2.4}
                        yMax={2.4}
                        showComponents
                        showSum
                    />
                    <TextLabel c={c} text="At matching crests and troughs, the displacement adds to ±2A." fontSize={12} color={c.textSecondary} />
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
