/**
 * Two equal sinusoidal waves add algebraically at every coordinate.
 * Relative phase is an author-controlled comparison parameter, not a simulation of its source.
 * Source: https://openstax.org/books/university-physics-volume-1/pages/16-5-interference-of-waves
 */
import { WaveDiagram, defineAnimation, getThemeColors, hold, tween, type ThemeMode } from 'vizmatic'

export const width = 1280
export const height = 720

export function interferenceAmplitude(phase: number) {
    if (!Number.isFinite(phase)) throw new Error('The phase must be finite')
    return 2 * Math.abs(Math.cos(phase / 2))
}

function buildFrame(theme: ThemeMode, phase: number, time: number) {
    const c = getThemeColors(theme)
    const firstColor = theme === 'dark' ? c.secondaryLight : c.secondaryDark
    const secondColor = theme === 'dark' ? c.accentLight : c.accent
    const sumColor = c.textPrimary
    const amplitude = interferenceAmplitude(phase)
    const phaseDegrees = phase * 180 / Math.PI
    const state = amplitude < 0.03 ? 'Complete cancellation' : amplitude > 1.97 ? 'Constructive interference' : 'Partial interference'

    return (
        <div style={{ display: 'flex', position: 'relative', width, height, overflow: 'hidden', backgroundColor: c.bg, color: c.textPrimary, fontFamily: c.fontSans }}>
            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 42, flexDirection: 'column', gap: 12 }}>
                <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14, letterSpacing: 2 }}>PHYSICS / THE SUPERPOSITION PRINCIPLE</span>
                <span style={{ fontSize: 48, fontWeight: 750, letterSpacing: -1.5 }}>Two waves. One displacement.</span>
                <span style={{ color: c.textSecondary, fontSize: 22 }}>Add the signed heights at each point, not their absolute values.</span>
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 64, top: 180 }}>
                <WaveDiagram c={c} width={1152} height={380} xMin={0} xMax={8} yMin={-2.3} yMax={2.3}
                    waves={[
                        { amplitude: 1, wavelength: 4, speed: 1, phase: 0, color: firstColor, label: 'Wave 1' },
                        { amplitude: 1, wavelength: 4, speed: 1, phase, color: secondColor, label: 'Wave 2' },
                    ]}
                    time={time} showComponents showSum probeX={2}
                    ariaLabel={`Two unit-amplitude waves with phase difference ${phaseDegrees.toFixed(0)} degrees; resultant amplitude ${amplitude.toFixed(2)}`} />
            </div>

            <div style={{ display: 'flex', position: 'absolute', left: 88, top: 584, width: 1104, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 290 }}>
                    <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14 }}>PHASE DIFFERENCE</span>
                    <span style={{ fontFamily: c.fontMono, fontSize: 39, fontWeight: 700 }}>{phaseDegrees.toFixed(0)}°</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 310 }}>
                    <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14 }}>RESULTANT AMPLITUDE</span>
                    <span style={{ fontFamily: c.fontMono, color: sumColor, fontSize: 39, fontWeight: 700 }}>{amplitude.toFixed(2)} × A</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
                    <span style={{ fontFamily: c.fontMono, color: c.textSecondary, fontSize: 14 }}>SAME SCALE THROUGHOUT</span>
                    <span style={{ color: sumColor, fontSize: 24, fontWeight: 700 }}>{state}</span>
                    <span style={{ color: c.textMuted, fontSize: 14 }}>Ideal linear waves; relative phase is varied.</span>
                </div>
            </div>
        </div>
    )
}

export function create(theme: ThemeMode = 'dark') {
    return buildFrame(theme, Math.PI, 2)
}

export function createAnimation(theme: ThemeMode = 'dark') {
    return defineAnimation({
        initial: { phase: 0, time: 0 },
        timeline: [
            tween({ phase: Math.PI, time: 2 }, { duration: 2800, easing: 'linear', label: 'Shift the waves out of phase' }),
            hold(900, 'Opposite displacements cancel'),
            tween({ phase: 2 * Math.PI, time: 4 }, { duration: 2800, easing: 'linear', label: 'Return to constructive interference' }),
            hold(1300, 'Equal displacements reinforce'),
        ],
        fps: 30,
        render: ({ phase, time }) => buildFrame(theme, phase, time),
    })
}

export default create('dark')
