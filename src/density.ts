/**
 * Density: how much information a diagram packs into its space.
 *
 * Every primitive reads its type, spacing, stroke, and radius from these tokens,
 * so one source renders as a dense engineering figure or as a slide.
 *
 *   dense         10 to 12 px small type, hairlines, tight gutters. The default.
 *   compact       A little more air for docs and dashboards.
 *   comfortable   The sizes primitives were first designed at.
 *   presentation  Large type and strokes for a room.
 *
 * A number scales from comfortable directly: 0.9 is slightly dense, 1.25 is large.
 */
export type DensityName = 'dense' | 'compact' | 'comfortable' | 'presentation'
export type Density = DensityName | number

export const DENSITY_NAMES: readonly DensityName[] = ['dense', 'compact', 'comfortable', 'presentation']
export const DEFAULT_DENSITY: DensityName = 'dense'

export interface DensityTypeScale {
    /** Footnotes, tick labels, and edge annotations. */
    micro: number
    /** Details, table cells, and key and value rows. */
    small: number
    /** Running text. */
    body: number
    /** Node titles and row headers. */
    label: number
    /** Panel and group headings. */
    heading: number
    /** Secondary headline. */
    subtitle: number
    /** Scene title. */
    title: number
    /** Large readouts in metric cards. */
    metric: number
}

export interface DensitySpaceScale {
    hair: number
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    /** Default padding around a whole scene. */
    canvas: number
}

export interface DensityStrokeScale {
    /** Borders and grid lines. */
    hair: number
    /** Axes and quiet connectors. */
    line: number
    /** Default connectors and data lines. */
    strong: number
    /** Emphasized paths. */
    heavy: number
}

export interface DensityRadiusScale {
    sm: number
    md: number
    lg: number
}

export interface DensityTokens {
    name: DensityName | 'custom'
    /** The scale factor applied to comfortable sizes, for sizing custom geometry. */
    scale: number
    type: DensityTypeScale
    space: DensitySpaceScale
    stroke: DensityStrokeScale
    radius: DensityRadiusScale
    /** Default connector arrowhead size, in stroke widths. */
    arrow: number
    /** Scale a font size expressed at comfortable density. */
    f(size: number): number
    /** Scale a spacing value expressed at comfortable density. */
    s(size: number): number
    /** Scale a stroke width expressed at comfortable density. */
    w(width: number): number
    /** Scale a corner radius expressed at comfortable density. */
    r(radius: number): number
    /** Scale small geometry, such as dots and markers, with no floor for legibility. */
    g(size: number): number
}

interface DensityCurve {
    f: (size: number) => number
    s: (size: number) => number
    w: (width: number) => number
    r: (radius: number) => number
    g: (size: number) => number
    arrow: number
    scale: number
}

/** Half-pixel steps keep type on a visible scale and text rendering crisp at 2x. */
function half(value: number): number {
    return Math.round(value * 2) / 2
}

function quarter(value: number): number {
    return Math.round(value * 4) / 4
}

const curves: Record<DensityName, DensityCurve> = {
    dense: {
        // Small type holds its size for legibility. Large type compresses more,
        // since big headlines are what make a figure read as a slide.
        f: (size) => Math.max(9, half(size <= 14 ? size * 0.9 : 12.6 + (size - 14) * 0.75)),
        s: (size) => quarter(size * 0.6),
        w: (width) => Math.max(0.75, quarter(width * 0.6)),
        r: (radius) => Math.min(5, half(radius * 0.5)),
        g: (size) => quarter(size * 0.8),
        arrow: 5.5,
        scale: 0.86,
    },
    compact: {
        f: (size) => Math.max(9.5, half(size <= 14 ? size * 0.95 : 13.3 + (size - 14) * 0.88)),
        s: (size) => quarter(size * 0.8),
        w: (width) => Math.max(0.9, quarter(width * 0.75)),
        r: (radius) => Math.min(7, half(radius * 0.7)),
        g: (size) => quarter(size * 0.9),
        arrow: 5.5,
        scale: 0.93,
    },
    comfortable: {
        f: (size) => size,
        s: (size) => size,
        w: (width) => width,
        r: (radius) => Math.min(10, radius),
        g: (size) => size,
        arrow: 5,
        scale: 1,
    },
    presentation: {
        f: (size) => half(size * 1.5),
        s: (size) => quarter(size * 1.4),
        w: (width) => quarter(width * 1.4),
        r: (radius) => half(radius * 1.2),
        g: (size) => quarter(size * 1.5),
        arrow: 4.5,
        scale: 1.5,
    },
}

function numericCurve(scale: number): DensityCurve {
    return {
        f: (size) => Math.max(8, half(size * scale)),
        s: (size) => quarter(size * Math.pow(scale, 1.2)),
        w: (width) => Math.max(0.6, quarter(width * scale)),
        r: (radius) => half(radius * scale),
        g: (size) => quarter(size * scale),
        arrow: 5,
        scale,
    }
}

function buildTokens(name: DensityName | 'custom', curve: DensityCurve): DensityTokens {
    const { f, s, w, r, g } = curve
    return {
        name,
        scale: curve.scale,
        type: { micro: f(10), small: f(11), body: f(13), label: f(14), heading: f(16), subtitle: f(20), title: f(28), metric: f(24) },
        space: { hair: s(2), xs: s(4), sm: s(8), md: s(12), lg: s(16), xl: s(24), canvas: s(40) },
        stroke: { hair: w(1), line: w(1.5), strong: w(2), heavy: w(3) },
        radius: { sm: r(4), md: r(8), lg: r(12) },
        arrow: curve.arrow,
        f, s, w, r, g,
    }
}

const tokenCache = new Map<DensityName | number, DensityTokens>()

/** Throws for anything that is not a density name or a positive finite number. */
export function assertDensity(density: unknown): asserts density is Density {
    if (typeof density === 'number' ? !Number.isFinite(density) || density <= 0 : !DENSITY_NAMES.includes(density as DensityName)) {
        throw new Error(`Unknown density ${JSON.stringify(density)}. Use ${DENSITY_NAMES.join(', ')}, or a positive number.`)
    }
}

/** Accepts a density name or a numeric string, as read from a command line or a frame setting. */
export function parseDensity(value: unknown): Density {
    const parsed = typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : value
    assertDensity(parsed)
    return parsed
}

export function densityTokens(density: Density = DEFAULT_DENSITY): DensityTokens {
    const cached = tokenCache.get(density)
    if (cached) return cached
    assertDensity(density)
    const tokens = typeof density === 'number' ? buildTokens('custom', numericCurve(density)) : buildTokens(density, curves[density])
    tokenCache.set(density, tokens)
    return tokens
}

interface SharedDensityState {
    ambient?: Density
    resolvers: Set<() => Density | undefined>
}

// The CLI bundles its own copy of this module, and a frame imports the package's copy.
// They must agree, so this state lives on one global instead of in each copy.
const sharedKey = Symbol.for('vizmatic.density')
const globals = globalThis as unknown as Record<symbol, SharedDensityState | undefined>
const shared: SharedDensityState = globals[sharedKey] ??= { resolvers: new Set() }

/**
 * Density for primitives whose theme does not set one. Use it when frames call
 * primitives before rendering starts, such as in a command line run.
 */
export function setDefaultDensity(density: Density | undefined): void {
    if (density !== undefined) assertDensity(density)
    shared.ambient = density
}

/** Used by the renderer, so a per-render density reaches primitives during layout. */
export function setDensityResolver(resolver: () => Density | undefined): void {
    shared.resolvers.add(resolver)
}

function currentRenderDensity(): Density | undefined {
    for (const resolver of shared.resolvers) {
        const density = resolver()
        if (density !== undefined) return density
    }
    return undefined
}

/** Tokens for a theme. The theme wins, then the current render, then the default. */
export function densityOf(c?: { density?: Density }): DensityTokens {
    return densityTokens(c?.density ?? currentRenderDensity() ?? shared.ambient ?? DEFAULT_DENSITY)
}

/** A copy of a theme at another density. */
export function withDensity<T extends object>(c: T, density: Density): T & { density: Density } {
    assertDensity(density)
    return { ...c, density }
}
