/**
 * Vizmatic — Theme
 *
 * Shared colors, typography, and styles for all illustrations.
 * Supports both dark and light modes.
 */

export type ThemeMode = 'dark' | 'light'
export type ThemePreset = 'default' | 'engineering'

// ─── Dark Colors ─────────────────────────────────────────────────────────────

const darkColors = {
    // Canvas backgrounds
    bg: '#151620',
    bgCard: '#1a1b26',
    bgCardAlt: '#1e2030',
    bgHover: '#24253a',
    bgSubtle: '#151620',

    // Brand / semantic colors (matches Mermaid palette)
    primary: '#7c3aed',      // Purple — key/highlighted components
    primaryLight: '#a78bfa',
    primaryDark: '#6d28d9',

    secondary: '#2563eb',    // Blue — supporting elements
    secondaryLight: '#60a5fa',
    secondaryDark: '#1d4ed8',

    positive: '#059669',     // Green — output/success
    positiveLight: '#34d399',
    positiveDark: '#047857',

    warning: '#d97706',      // Amber — warnings
    warningLight: '#fbbf24',
    warningDark: '#b45309',

    critical: '#dc2626',     // Red — errors/bottlenecks
    criticalLight: '#f87171',
    criticalDark: '#b91c1c',

    info: '#06b6d4',         // Cyan — informational
    infoLight: '#22d3ee',
    infoDark: '#0891b2',

    accent: '#f472b6',       // Pink — accents
    accentLight: '#f9a8d4',

    neutral: '#334155',      // Slate — infrastructure/background
    neutralLight: '#475569',
    neutralDark: '#1e293b',

    // Text
    textPrimary: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#64748b',
    textOnColor: '#ffffff',

    // Borders
    border: '#334155',
    borderSubtle: '#1e293b',
    borderLight: '#475569',
    shadow: 'rgba(0, 0, 0, 0.24)',
} as const

// ─── Light Colors ────────────────────────────────────────────────────────────

const lightColors = {
    // Canvas backgrounds
    bg: '#f5f7fa',
    bgCard: '#f8fafc',
    bgCardAlt: '#f1f5f9',
    bgHover: '#e2e8f0',
    bgSubtle: '#f5f7fa',

    // Brand / semantic colors (same hues, adjusted for light bg)
    primary: '#7c3aed',
    primaryLight: '#8b5cf6',
    primaryDark: '#6d28d9',

    secondary: '#2563eb',
    secondaryLight: '#3b82f6',
    secondaryDark: '#1d4ed8',

    positive: '#059669',
    positiveLight: '#10b981',
    positiveDark: '#047857',

    warning: '#d97706',
    warningLight: '#f59e0b',
    warningDark: '#b45309',

    critical: '#dc2626',
    criticalLight: '#ef4444',
    criticalDark: '#b91c1c',

    info: '#0891b2',
    infoLight: '#06b6d4',
    infoDark: '#0e7490',

    accent: '#ec4899',
    accentLight: '#f472b6',

    neutral: '#cbd5e1',
    neutralLight: '#94a3b8',
    neutralDark: '#e2e8f0',

    // Text
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    textOnColor: '#ffffff',

    // Borders
    border: '#e2e8f0',
    borderSubtle: '#e2e8f0',
    borderLight: '#cbd5e1',
    shadow: 'rgba(15, 23, 42, 0.12)',
} as const

// ─── Theme Accessor ──────────────────────────────────────────────────────────

interface ThemeStyleTokens {
    preset: ThemePreset
    fontSans: string
    fontMono: string
}

export type ThemeColors = { [K in keyof typeof darkColors]: string } & ThemeStyleTokens

const defaultStyleTokens: ThemeStyleTokens = {
    preset: 'default',
    fontSans: 'Inter',
    fontMono: 'JetBrains Mono',
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

export function getThemeColors(mode: ThemeMode, preset: ThemePreset = 'default'): ThemeColors {
    if (preset === 'engineering') {
        return {
            ...engineeringColors,
            preset,
            fontSans: 'Inter',
            fontMono: 'JetBrains Mono',
        }
    }

    return {
        ...(mode === 'light' ? lightColors : darkColors),
        ...defaultStyleTokens,
    }
}

/** Default for backward-compat: dark */
export const colors = darkColors

// ─── Gradients ───────────────────────────────────────────────────────────────

export const gradients = {
    purple: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    blue: 'linear-gradient(135deg, #2563eb, #60a5fa)',
    green: 'linear-gradient(135deg, #059669, #34d399)',
    warm: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    cyan: 'linear-gradient(135deg, #06b6d4, #22d3ee)',
    pink: 'linear-gradient(135deg, #ec4899, #f472b6)',
    sunset: 'linear-gradient(135deg, #f97316, #db2777)',
    ocean: 'linear-gradient(135deg, #0284c7, #7c3aed)',
    dark: 'linear-gradient(180deg, #0f1117, #1a1b26)',
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
        purple: c.primaryLight,
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

/** Low-chroma fills for diagrams. The engineering preset uses opaque pastels. */
export function getToneFill(tone: ToneName, c: ThemeColors): string {
    if (c.preset !== 'engineering') return `${getToneColor(tone, c)}16`

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
    tiny: { fontSize: 10, fontWeight: 500, fontFamily: 'Inter' },
    code: { fontSize: 13, fontWeight: 400, fontFamily: 'JetBrains Mono' },
    annotation: { fontSize: 12, fontWeight: 500, fontFamily: 'Inter', fontStyle: 'italic' as const },
} as const

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

export type ColorName = 'primary' | 'secondary' | 'positive' | 'warning' | 'critical' | 'info' | 'accent' | 'neutral'

/**
 * Get a solid color by semantic name from a ThemeColors object.
 * Falls back to dark theme if no ThemeColors provided (backward compat).
 */
export function getColor(name: ColorName, c?: ThemeColors): string {
    if (c) return c[name]
    return colors[name]
}

/**
 * Get a gradient by semantic name.
 * Gradients are the same for both themes (they sit on top of content
 * and always use vibrant, high-contrast colors).
 */
export function getGradient(name: ColorName): string {
    const map: Record<ColorName, string> = {
        primary: gradients.purple,
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
 * Map a value 0..1 to a heat color (dark blue → cyan → green → yellow → red)
 */
export function heatColor(value: number): string {
    const v = Math.max(0, Math.min(1, value))
    if (v < 0.25) {
        const t = v / 0.25
        return lerpColor('#1e293b', '#0891b2', t)
    } else if (v < 0.5) {
        const t = (v - 0.25) / 0.25
        return lerpColor('#0891b2', '#059669', t)
    } else if (v < 0.75) {
        const t = (v - 0.5) / 0.25
        return lerpColor('#059669', '#d97706', t)
    } else {
        const t = (v - 0.75) / 0.25
        return lerpColor('#d97706', '#dc2626', t)
    }
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
