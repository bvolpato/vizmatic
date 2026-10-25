/**
 * Illustrative generic A→B energy profile, not measured energies of a named reaction.
 * Both routes keep endpoint energies of 20 and -40 kJ/mol, so ΔE=-60.
 * Their activation energies are 100 and 45 kJ/mol.
 * Source: https://openstax.org/books/chemistry-2e/pages/12-7-catalysis
 */
import { ReactionEnergyDiagram, defineAnimation, getThemeColors, hold, tween, type ThemeMode } from 'vizmatic'

export const width = 1280
export const height = 720

export const energyProfile = Object.freeze({ reactants: 20, products: -40, barrier: 120, catalyzedBarrier: 65 })

function buildFrame(theme: ThemeMode, pathProgress: number) {
    const c = getThemeColors(theme)
    const accent = theme === 'dark' ? c.positiveLight : c.positiveDark

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 42, flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14, letterSpacing: 2 }}>CHEMISTRY / TWO REACTION PATHWAYS</span>
                <span style={{ fontSize: 46, fontWeight: 750, letterSpacing: -1.5 }}>A lower barrier. The same energy change.</span>
                <span style={{ color: c.textSecondary, fontSize: 22 }}>A catalyst provides an alternative route between the same endpoints.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 174 }}>
                <ReactionEnergyDiagram c={c} width={1152} height={430} {...energyProfile}
                    progress={pathProgress} unit="kJ/mol" reactantLabel="A · Reactants" productLabel="B · Products" />
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 92, right: 92, top: 620, justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 27, color: accent, fontWeight: 700 }}>Activation energy: 100 → 45 kJ/mol</span>
                <span style={{ fontSize: 27, fontWeight: 700 }}>ΔE = −60 kJ/mol</span>
            </div>
            <span style={{ position: 'absolute', left: 92, top: 674, fontSize: 15, color: c.textMuted }}>Illustrative values. Reaction coordinate describes a pathway, not elapsed time or a predicted reaction rate.</span>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, 1)
}

export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation({
        initial: { pathProgress: 0.18 },
        timeline: [
            tween({ pathProgress: 1 }, { duration: 5500, easing: 'linear', label: 'Compare the two fixed energy pathways' }),
            hold(2000, 'Same endpoints, lower activation energy'),
        ],
        fps: 30,
        render: ({ pathProgress }) => buildFrame(theme, pathProgress),
    })
}

export default create('dark')
