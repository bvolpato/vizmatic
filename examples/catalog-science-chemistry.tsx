import {
    getThemeColors,
    MoleculeDiagram,
    Panel,
    ReactionEnergyDiagram,
    ReactionEquation,
    Row,
    Scene,
    TextLabel,
    type ThemeMode,
} from 'vizmatic'

export const width = 1280
export const height = 960

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Chemistry · structure, stoichiometry, energy"
            subtitle="Connect a molecule's geometry to a balanced reaction and its energy pathway."
            background={c.bg}
            padding={24}
            gap={16}
        >
            <Row width="100%" gap={16} align="stretch">
                <Panel
                    c={c}
                    title="Molecular shape"
                    subtitle="Water has a bent geometry."
                    tone="cyan"
                    width={440}
                    minHeight={344}
                    align="center"
                >
                    <MoleculeDiagram
                        c={c}
                        width={390}
                        height={250}
                        atoms={[
                            { id: 'oxygen', element: 'O', x: 0, y: 0 },
                            { id: 'hydrogen-left', element: 'H', x: -0.79, y: 0.61 },
                            { id: 'hydrogen-right', element: 'H', x: 0.79, y: 0.61 },
                        ]}
                        bonds={[
                            { from: 'oxygen', to: 'hydrogen-left', order: 1 },
                            { from: 'oxygen', to: 'hydrogen-right', order: 1 },
                        ]}
                        title="Water molecule"
                    />
                    <TextLabel c={c} text="Schematic 2D projection · H–O–H ≈ 104.5°" fontSize={12} color={c.textSecondary} />
                </Panel>

                <Panel
                    c={c}
                    title="Conserve each element"
                    subtitle="The coefficients balance four hydrogen atoms and two oxygen atoms on both sides."
                    tone="blue"
                    width={776}
                    minHeight={344}
                    align="center"
                    justify="center"
                    footer="2 H₂(g) + O₂(g) → 2 H₂O(l) · atom counts match"
                >
                    <ReactionEquation
                        c={c}
                        width={720}
                        reactants={[
                            { formula: 'H₂', coefficient: 2, state: 'g', composition: { H: 2 } },
                            { formula: 'O₂', state: 'g', composition: { O: 2 } },
                        ]}
                        products={[
                            { formula: 'H₂O', coefficient: 2, state: 'l', composition: { H: 2, O: 1 } },
                        ]}
                        conditions="spark ignition · hydrogen combustion"
                    />
                </Panel>
            </Row>

            <Panel
                c={c}
                title="A catalyst changes the path, not the endpoints"
                subtitle="Both pathways begin and end at the same energies; the catalyzed route has a smaller activation barrier."
                tone="purple"
                width="100%"
                minHeight={350}
                align="center"
                footer="Illustrative relative energy values · not measured data for hydrogen combustion"
            >
                <ReactionEnergyDiagram
                    c={c}
                    width={1150}
                    height={320}
                    reactants={0}
                    products={-100}
                    barrier={140}
                    catalyzedBarrier={70}
                    unit="relative energy"
                    reactantLabel="reactants"
                    productLabel="products"
                />
            </Panel>
        </Scene>
    )
}

export default create('dark')
