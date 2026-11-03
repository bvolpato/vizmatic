/**
 * Vizmatic — Theme
 *
 * Shared colors, typography, and styles for all illustrations.
 * Supports both dark and light modes.
 */

import parseCssColor from 'parse-css-color'
import { densityOf, withDensity, type Density } from './density'

export * from './density'

export type ThemeMode = 'dark' | 'light'
export type ThemePreset = 'default' | 'engineering'

// ─── Dark Colors ─────────────────────────────────────────────────────────────
// Shared with the stage's midnight look: neutral black, warm ink, and pigments
// that stay quiet until they mean something.

const darkColors = {
    // Canvas backgrounds
    bg: '#0b0c10',
    bgCard: '#13151a',
    bgCardAlt: '#191c22',
    bgHover: '#21252c',
    bgSubtle: '#0f1014',

    // The single accent. Everything else is semantic.
    primary: '#2f8fc4',
    primaryLight: '#5cc4f0',
    primaryDark: '#1f6f9e',

    secondary: '#2f8fc4',    // Blue: supporting elements
    secondaryLight: '#5cc4f0',
    secondaryDark: '#1f6f9e',

    positive: '#4f9e4a',     // Green: output and success
    positiveLight: '#8fe08a',
    positiveDark: '#3a7a36',

    warning: '#b98a2e',      // Gold: warnings
    warningLight: '#f2b84b',
    warningDark: '#8a6620',

    critical: '#c94a4a',     // Red: errors and bottlenecks
    criticalLight: '#ff6b6b',
    criticalDark: '#9c3535',

    info: '#2fa394',         // Teal: informational
    infoLight: '#4fd8c4',
    infoDark: '#237d72',

    accent: '#c7618f',       // Pink: rare highlights
    accentLight: '#ff8fc0',

    violet: '#7f6bd0',       // Violet: categorical use only
    violetLight: '#b49cff',
    violetDark: '#5f4cab',

    neutral: '#363a43',      // Infrastructure and background
    neutralLight: '#4a4f5a',
    neutralDark: '#22252c',

    // Text
    textPrimary: '#f2efe6',
    textSecondary: '#a5a7ad',
    textMuted: '#95989f',
    textOnColor: '#ffffff',

    // Borders
    border: '#2c3038',
    borderSubtle: '#1f2228',
    borderLight: '#3d424c',
    shadow: 'rgba(0, 0, 0, 0)',
} as const

// ─── Light Colors ────────────────────────────────────────────────────────────
// Shared with the stage's paper look: warm paper and printed ink.

const lightColors = {
    // Canvas backgrounds
    bg: '#f7f3ea',
    bgCard: '#fbf8f1',
    bgCardAlt: '#efe9db',
    bgHover: '#e7e0cf',
    bgSubtle: '#f2ede1',

    primary: '#1f6fb2',
    primaryLight: '#1f6fb2',
    primaryDark: '#165689',

    secondary: '#1f6fb2',
    secondaryLight: '#1f6fb2',
    secondaryDark: '#165689',

    positive: '#3f8a35',
    positiveLight: '#357a2c',
    positiveDark: '#2c6524',

    warning: '#a8740a',
    warningLight: '#8a5f07',
    warningDark: '#7a5406',

    critical: '#c62f2f',
    criticalLight: '#b92a2a',
    criticalDark: '#962222',

    info: '#0b7d70',
    infoLight: '#0b7468',
    infoDark: '#095e55',

    accent: '#c2387e',
    accentLight: '#b03271',

    violet: '#6a4bc4',
    violetLight: '#6246b6',
    violetDark: '#4f3896',

    neutral: '#cdc5b3',
    neutralLight: '#a29c8d',
    neutralDark: '#e2dbca',

    // Text
    textPrimary: '#1d1b16',
    textSecondary: '#5e5a50',
    textMuted: '#696459',
    textOnColor: '#ffffff',

    // Borders
    border: '#d9d2c1',
    borderSubtle: '#e6dfd0',
    borderLight: '#c4bba6',
    shadow: 'rgba(0, 0, 0, 0)',
} as const

// ─── Theme Accessor ──────────────────────────────────────────────────────────

interface ThemeStyleTokens {
    preset: ThemePreset
    fontSans: string
    fontMono: string
    /** Display serif for titles that want a printed voice. */
    fontSerif: string
    /** Type, spacing, and stroke scale. Unset follows the render, then the default. */
    density?: Density
}

export type ThemeColors = { [K in keyof typeof darkColors]: string } & ThemeStyleTokens

const defaultStyleTokens: ThemeStyleTokens = {
    preset: 'default',
    fontSans: 'Inter',
    fontMono: 'JetBrains Mono',
    fontSerif: 'Instrument Serif',
}

const engineeringColors = {
    ...lightColors,
    bg: '#f4f4f5',
    bgCard: '#ffffff',
    bgCardAlt: '#ececee',
    bgHover: '#e4e4e7',
    bgSubtle: '#eeeeef',
    primary: '#632ca6',
    primaryLight: '#6d28d9',
    primaryDark: '#4c1d95',
    violet: '#632ca6',
    violetLight: '#6d28d9',
    violetDark: '#4c1d95',
    secondary: '#124fc7',
    secondaryLight: '#1556d1',
    secondaryDark: '#123d96',
    positive: '#087a55',
    positiveLight: '#0a8060',
    positiveDark: '#05543c',
    warning: '#c96c00',
    warningLight: '#d97800',
    warningDark: '#9a4f00',
    critical: '#b83232',
    criticalLight: '#c43d3d',
    criticalDark: '#8f2626',
    info: '#0b7185',
    infoLight: '#0d7d92',
    infoDark: '#075565',
    accent: '#a83c76',
    accentLight: '#b74583',
    neutral: '#52525b',
    neutralLight: '#71717a',
    neutralDark: '#3f3f46',
    textPrimary: '#101012',
    textSecondary: '#3f3f46',
    textMuted: '#68686f',
    textOnColor: '#ffffff',
    border: '#3f3f46',
    borderSubtle: '#d4d4d8',
    borderLight: '#a1a1aa',
    shadow: 'rgba(0, 0, 0, 0)',
} as const

export interface ThemeOptions {
    /** Render every primitive using this theme at a density, such as 'presentation'. */
    density?: Density
}

export function getThemeColors(mode: ThemeMode, preset: ThemePreset = 'default', options: ThemeOptions = {}): ThemeColors {
    const colors: ThemeColors = preset === 'engineering'
        ? { ...engineeringColors, preset, fontSans: 'Inter', fontMono: 'JetBrains Mono', fontSerif: 'Instrument Serif' }
        : { ...(mode === 'light' ? lightColors : darkColors), ...defaultStyleTokens }
    return options.density !== undefined ? withDensity(colors, options.density) : colors
}

/** Default for backward-compat: dark */
export const colors: ThemeColors = {
    ...darkColors,
    ...defaultStyleTokens,
}

// ─── Gradients ───────────────────────────────────────────────────────────────

// Flat by design. The stops match so filled surfaces read as solid ink, and
// callers that pass one of these to backgroundImage keep working.
const flat = (color: string) => `linear-gradient(135deg, ${color}, ${color})`

export const gradients = {
    purple: flat('#5f4cab'),
    blue: flat('#1f6f9e'),
    green: flat('#2f7a3a'),
    warm: flat('#8a6620'),
    cyan: flat('#1d7a6e'),
    pink: flat('#a04672'),
    sunset: flat('#9c5526'),
    ocean: flat('#1d5f86'),
    dark: flat('#22252c'),
} as const

// ─── Tone Lookup ────────────────────────────────────────────────────────────

export type ToneName = 'blue' | 'purple' | 'green' | 'warm' | 'cyan' | 'pink' | 'red' | 'critical' | 'neutral' | 'sunset' | 'ocean' | 'dark'

export const toneGradients: Record<ToneName, string> = {
    blue: gradients.blue,
    purple: gradients.purple,
    green: gradients.green,
    warm: gradients.warm,
    cyan: gradients.cyan,
    pink: gradients.pink,
    red: gradients.warm,
    critical: gradients.warm,
    neutral: gradients.dark,
    sunset: gradients.sunset,
    ocean: gradients.ocean,
    dark: gradients.dark,
}

export function getToneGradient(tone: ToneName): string {
    return toneGradients[tone]
}

export function getToneColor(tone: ToneName, c: ThemeColors): string {
    return {
        blue: c.secondaryLight,
        purple: c.violetLight,
        green: c.positiveLight,
        warm: c.warningLight,
        cyan: c.infoLight,
        pink: c.accentLight,
        red: c.criticalLight,
        critical: c.criticalLight,
        neutral: c.textSecondary,
        sunset: c.warningLight,
        ocean: c.infoLight,
        dark: c.textSecondary,
    }[tone]
}

/** Get a tone variant that remains readable against the background over its backdrop. */
export function getReadableToneColor(
    tone: ToneName,
    c: ThemeColors,
    background = c.bgCard,
    backdrop = c.bgCard,
): string {
    const semanticColor: Record<ToneName, ColorName> = {
        blue: 'secondary',
        purple: 'violet',
        green: 'positive',
        warm: 'warning',
        cyan: 'info',
        pink: 'accent',
        red: 'critical',
        critical: 'critical',
        neutral: 'neutral',
        sunset: 'warning',
        ocean: 'info',
        dark: 'neutral',
    }
    const color = getReadableColor(semanticColor[tone], c)
    return colorContrast(color, background, backdrop) >= 4.5
        ? color
        : getReadableTextColor(background, c, backdrop)
}

/** Low-chroma fills for diagrams. The engineering preset uses opaque pastels. */
export function getToneFill(tone: ToneName, c: ThemeColors): string {
    if (c.preset !== 'engineering') return withColorAlpha(getToneColor(tone, c), 0x16 / 0xff)

    return {
        blue: '#cddcfa',
        purple: '#dfcff8',
        green: '#d5ede4',
        warm: '#fde7ce',
        cyan: '#d7edf1',
        pink: '#f3d9e7',
        red: '#f4d7d7',
        critical: '#f4d7d7',
        neutral: '#e4e4e7',
        sunset: '#fde1d6',
        ocean: '#d8e2f6',
        dark: '#dedee2',
    }[tone]
}

// ─── Typography ──────────────────────────────────────────────────────────────

export const typography = {
    title: { fontSize: 28, fontWeight: 700, fontFamily: 'Inter' },
    subtitle: { fontSize: 20, fontWeight: 600, fontFamily: 'Inter' },
    label: { fontSize: 16, fontWeight: 600, fontFamily: 'Inter' },
    body: { fontSize: 14, fontWeight: 400, fontFamily: 'Inter' },
    small: { fontSize: 12, fontWeight: 500, fontFamily: 'Inter' },
    tiny: { fontSize: 11, fontWeight: 500, fontFamily: 'Inter' },
    code: { fontSize: 13, fontWeight: 400, fontFamily: 'JetBrains Mono' },
    annotation: { fontSize: 12, fontWeight: 500, fontFamily: 'Inter', fontStyle: 'italic' as const },
} as const

/** False when the theme's shadow token is fully transparent, so no shadow filter is emitted. */
export function hasShadow(c: ThemeColors): boolean {
    const parsed = parseCssColor(c.shadow)
    return !!parsed && parsed.alpha > 0
}

export type TypographyVariant = keyof typeof typography

/** A typography style at the theme's density. Spread it into a style object. */
export function typeOf<V extends TypographyVariant>(c: ThemeColors, variant: V): Omit<typeof typography[V], 'fontSize' | 'fontWeight'> & { fontSize: number; fontWeight: number } {
    const base = typography[variant]
    return {
        ...base,
        fontSize: densityOf(c).f(base.fontSize),
        // Bold headings at small sizes read as shouting, so they settle at semibold.
        fontWeight: Math.min(base.fontWeight, 600),
    }
}

// ─── Canvas Sizes ────────────────────────────────────────────────────────────

export const canvas = {
    standard: { width: 800, height: 500 },
    wide: { width: 1000, height: 400 },
    square: { width: 600, height: 600 },
    tall: { width: 600, height: 800 },
} as const

// ─── Shared Styles ───────────────────────────────────────────────────────────

/** Theme-aware style factories. Use these instead of hardcoded color values. */
export function getStyles(c: ThemeColors) {
    return {
        canvas: {
            width: '100%' as const,
            height: '100%' as const,
            display: 'flex' as const,
            flexDirection: 'column' as const,
            backgroundColor: c.bg,
            fontFamily: c.fontSans,
            padding: 40,
        },

        card: {
            display: 'flex' as const,
            flexDirection: 'column' as const,
            backgroundColor: c.bgCard,
            borderRadius: 8,
            border: `1px solid ${c.borderSubtle}`,
            padding: 20,
        },

        pill: {
            display: 'flex' as const,
            alignItems: 'center' as const,
            justifyContent: 'center' as const,
            borderRadius: 999,
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'Inter',
        },
    }
}

/** @deprecated Use getStyles(c) for theme-aware styles */
export const styles = {
    canvas: {
        width: '100%',
        height: '100%',
        display: 'flex' as const,
        flexDirection: 'column' as const,
        backgroundColor: colors.bg,
        fontFamily: 'Inter',
        padding: 40,
    },

    card: {
        display: 'flex' as const,
        flexDirection: 'column' as const,
        backgroundColor: colors.bgCard,
        borderRadius: 8,
        border: `1px solid ${colors.borderSubtle}`,
        padding: 20,
    },

    pill: {
        display: 'flex' as const,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderRadius: 999,
        padding: '6px 16px',
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'Inter',
    },
} as const

// ─── Color Lookup ────────────────────────────────────────────────────────────

export type ColorName = 'primary' | 'secondary' | 'positive' | 'warning' | 'critical' | 'info' | 'accent' | 'neutral' | 'violet'

/**
 * Get a solid color by semantic name from a ThemeColors object.
 * Falls back to dark theme if no ThemeColors provided (backward compat).
 */
export function getColor(name: ColorName, c?: ThemeColors): string {
    if (c) return c[name]
    return colors[name]
}

/** Get a semantic color variant that remains readable as text in either theme. */
export function getReadableColor(name: ColorName, c: ThemeColors): string {
    const variants: Record<ColorName, string[]> = {
        primary: [c.primaryLight, c.primary, c.primaryDark],
        secondary: [c.secondaryLight, c.secondary, c.secondaryDark],
        positive: [c.positiveLight, c.positive, c.positiveDark],
        warning: [c.warningLight, c.warning, c.warningDark],
        critical: [c.criticalLight, c.critical, c.criticalDark],
        info: [c.infoLight, c.info, c.infoDark],
        accent: [c.accentLight, c.accent, '#be185d'],
        violet: [c.violetLight, c.violet, c.violetDark],
        neutral: [c.textSecondary, c.neutralLight, c.neutral, c.neutralDark],
    }
    return variants[name].reduce((best, candidate) =>
        colorContrast(candidate, c.bgCard) > colorContrast(best, c.bgCard) ? candidate : best)
}

interface ParsedColor {
    channels: [number, number, number]
    alpha: number
}

function parseColor(color: string): ParsedColor | undefined {
    const parsed = parseCssColor(color)
    if (!parsed || parsed.values.length < 3) return undefined
    if (parsed.type !== 'hsl') {
        return {
            channels: [parsed.values[0] ?? 0, parsed.values[1] ?? 0, parsed.values[2] ?? 0],
            alpha: parsed.alpha,
        }
    }

    const hue = (((parsed.values[0] ?? 0) % 360) + 360) % 360
    const saturation = (parsed.values[1] ?? 0) / 100
    const lightness = (parsed.values[2] ?? 0) / 100
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
    const segment = hue / 60
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
    let channels: [number, number, number]
    if (segment < 1) channels = [chroma, intermediate, 0]
    else if (segment < 2) channels = [intermediate, chroma, 0]
    else if (segment < 3) channels = [0, chroma, intermediate]
    else if (segment < 4) channels = [0, intermediate, chroma]
    else if (segment < 5) channels = [intermediate, 0, chroma]
    else channels = [chroma, 0, intermediate]
    const offset = lightness - chroma / 2
    return {
        channels: channels.map((channel) => Math.round((channel + offset) * 255)) as [number, number, number],
        alpha: parsed.alpha,
    }
}

/** Apply an opacity multiplier to any CSS color accepted by parse-css-color. */
export function withColorAlpha(color: string, opacity: number): string {
    if (typeof color !== 'string' || !Number.isFinite(opacity)) return 'transparent'

    const parsed = parseColor(color)
    if (!parsed) return 'transparent'

    const alpha = Math.min(1, Math.max(0, parsed.alpha * Math.min(1, Math.max(0, opacity))))
    const hex = color.trim()
    if (/^#[\da-f]{6}$/i.test(hex)) {
        return `${hex}${Math.round(alpha * 0xff).toString(16).padStart(2, '0')}`
    }

    return `rgba(${parsed.channels.join(', ')}, ${Number(alpha.toFixed(6))})`
}

function colorLuminance(color: string, backdrop?: string): number | undefined {
    const parsed = parseColor(color)
    if (!parsed) return undefined
    let channels = parsed.channels
    if (parsed.alpha < 1) {
        const backdropColor = backdrop ? parseColor(backdrop) : undefined
        if (!backdropColor) return undefined
        channels = channels.map((channel, index) => Math.round(
            channel * parsed.alpha + backdropColor.channels[index] * (1 - parsed.alpha),
        )) as [number, number, number]
    }
    const [r, g, b] = channels.map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Resolve a translucent foreground over its background using CSS alpha compositing. */
export function compositeColor(foreground: string, background: string): string {
    const front = parseColor(foreground), back = parseColor(background)
    if (!front || !back) throw new Error('Color compositing requires valid CSS colors')
    const alpha = front.alpha + back.alpha * (1 - front.alpha)
    if (alpha === 0) return 'transparent'
    const channels = front.channels.map((value, index) => Math.round(
        (value * front.alpha + back.channels[index] * back.alpha * (1 - front.alpha)) / alpha,
    ))
    return alpha === 1 ? `rgb(${channels.join(', ')})` : `rgba(${channels.join(', ')}, ${Number(alpha.toFixed(6))})`
}

function colorContrast(left: string, right: string, rightBackdrop?: string): number {
    const leftLuminance = colorLuminance(left)
    const rightLuminance = colorLuminance(right, rightBackdrop)
    if (leftLuminance == null || rightLuminance == null) return 0
    return (Math.max(leftLuminance, rightLuminance) + 0.05)
        / (Math.min(leftLuminance, rightLuminance) + 0.05)
}

/** Choose readable foreground text, compositing translucent backgrounds over their backdrop. */
export function getReadableTextColor(background: string, c: ThemeColors, backdrop = c.bgCard): string {
    if (colorLuminance(background, backdrop) == null) return c.textPrimary
    const candidates = [c.textPrimary, c.textOnColor, c.bg, '#000000']
    const readable = candidates.find((candidate) => colorContrast(candidate, background, backdrop) >= 4.5)
    if (readable) return readable
    return candidates.reduce((best, candidate) =>
        colorContrast(candidate, background, backdrop) > colorContrast(best, background, backdrop) ? candidate : best)
}

/**
 * Get a gradient by semantic name.
 * Gradients are the same for both themes (they sit on top of content
 * and always use vibrant, high-contrast colors).
 */
export function getGradient(name: ColorName): string {
    const map: Record<ColorName, string> = {
        primary: gradients.blue,
        violet: gradients.purple,
        secondary: gradients.blue,
        positive: gradients.green,
        warning: gradients.warm,
        critical: gradients.warm,
        info: gradients.cyan,
        accent: gradients.pink,
        neutral: gradients.dark,
    }
    return map[name]
}

// ─── Heat Scale ──────────────────────────────────────────────────────────────

/**
 * Map a value 0..1 to a heat color: slate, then blue, then gold, then red at the top end.
 */
export function heatColor(value: number): string {
    const v = Math.max(0, Math.min(1, value))
    // A calm sequential ramp. Rainbow scales invent boundaries that the data does not have.
    if (v < 0.5) return lerpColor('#1b2430', '#1f6f9e', v / 0.5)
    if (v < 0.8) return lerpColor('#1f6f9e', '#c89a3c', (v - 0.5) / 0.3)
    return lerpColor('#c89a3c', '#d9573f', (v - 0.8) / 0.2)
}

function lerpColor(a: string, b: string, t: number): string {
    const ah = parseInt(a.slice(1), 16)
    const bh = parseInt(b.slice(1), 16)
    const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff
    const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff
    const rr = Math.round(ar + (br - ar) * t)
    const rg = Math.round(ag + (bg - ag) * t)
    const rb = Math.round(ab + (bb - ab) * t)
    return `#${((rr << 16) | (rg << 8) | rb).toString(16).padStart(6, '0')}`
}
