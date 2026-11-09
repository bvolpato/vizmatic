import parseCssColor from 'parse-css-color'
import { midnight } from './look'

/** r, g, b from 0 to 255 and alpha from 0 to 1. */
export type Rgba = readonly [number, number, number, number]

export interface LinearGradient {
    readonly type: 'linear'
    readonly from: readonly [number, number]
    readonly to: readonly [number, number]
    readonly stops: readonly (readonly [number, Rgba])[]
}

export interface RadialGradient {
    readonly type: 'radial'
    readonly center: readonly [number, number]
    readonly radius: number
    readonly stops: readonly (readonly [number, Rgba])[]
}

/** Stroke whose color changes along its arc length. */
export interface AlongGradient {
    readonly type: 'along'
    readonly stops: readonly (readonly [number, Rgba])[]
}

export type Gradient = LinearGradient | RadialGradient | AlongGradient
export type Paint = Rgba | Gradient
export type ColorInput = string | Rgba | Gradient

export const TRANSPARENT: Rgba = [0, 0, 0, 0]

const cache = new Map<string, Rgba>()
// Compiling a film sets its look's tokens. Nodes made outside a film use the default look,
// so create nodes inside the film function when they should follow a chosen look.
let tokens: Readonly<Record<string, string>> = midnight.colors

/** Set named color tokens such as `blue` or `ink` for the film being compiled. */
export function setColorTokens(next: Readonly<Record<string, string>>): void {
    tokens = next
}

export function parseColor(input: string): Rgba {
    const token = tokens[input]
    const value = token ?? input
    const cached = cache.get(value)
    if (cached) return cached
    const parsed = parseCssColor(value)
    if (!parsed) throw new Error(`Unknown color: ${JSON.stringify(input)}. Use a look token such as "blue" or a CSS color.`)
    let [r, g, b] = parsed.values
    if (parsed.type === 'hsl') [r, g, b] = hslToRgb(r, g, b)
    const result: Rgba = [r, g, b, parsed.alpha]
    cache.set(value, result)
    return result
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
    const f = (n: number) => {
        const k = (n + h / 30) % 12
        return 255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
    }
    return [f(0), f(8), f(4)]
}

export function toPaint(input: ColorInput): Paint {
    if (typeof input === 'string') return parseColor(input)
    return input
}

export function isGradient(paint: Paint): paint is Gradient {
    return !Array.isArray(paint)
}

export function css(color: Rgba, alpha = 1): string {
    const a = color[3] * alpha
    const r = Math.round(color[0]), g = Math.round(color[1]), b = Math.round(color[2])
    if (a >= 1) return `rgb(${r},${g},${b})`
    return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`
}

function srgbToLinear(v: number): number {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function linearToSrgb(v: number): number {
    const x = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, x * 255))
}

type Lab = [number, number, number]

function toOklab(c: Rgba): Lab {
    const r = srgbToLinear(c[0]), g = srgbToLinear(c[1]), b = srgbToLinear(c[2])
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

function fromOklab(lab: Lab, alpha: number): Rgba {
    const l = lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]
    const m = lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]
    const s = lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]
    const ll = l * l * l, mm = m * m * m, ss = s * s * s
    return [
        linearToSrgb(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
        linearToSrgb(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
        linearToSrgb(-0.0041960863 * ll - 0.7034186147 * mm + 1.707614701 * ss),
        alpha,
    ]
}

/** Mix two colors in OKLab, which keeps blends bright and even in tone. */
export function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
    if (t <= 0) return a
    if (t >= 1) return b
    const x = toOklab(a), y = toOklab(b)
    return fromOklab([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t], a[3] + (b[3] - a[3]) * t)
}

export function mixPaint(a: Paint, b: Paint, t: number): Paint {
    if (t <= 0) return a
    if (t >= 1) return b
    const ga = isGradient(a), gb = isGradient(b)
    if (!ga && !gb) return mixColor(a as Rgba, b as Rgba, t)
    if (ga && gb && a.type === b.type && a.stops.length === b.stops.length) {
        const stops = a.stops.map((stop, i) => [
            stop[0] + (b.stops[i]![0] - stop[0]) * t,
            mixColor(stop[1], b.stops[i]![1], t),
        ] as const)
        if (a.type === 'linear' && b.type === 'linear') {
            return {
                type: 'linear', stops,
                from: [a.from[0] + (b.from[0] - a.from[0]) * t, a.from[1] + (b.from[1] - a.from[1]) * t],
                to: [a.to[0] + (b.to[0] - a.to[0]) * t, a.to[1] + (b.to[1] - a.to[1]) * t],
            }
        }
        if (a.type === 'radial' && b.type === 'radial') {
            return {
                type: 'radial', stops,
                center: [a.center[0] + (b.center[0] - a.center[0]) * t, a.center[1] + (b.center[1] - a.center[1]) * t],
                radius: a.radius + (b.radius - a.radius) * t,
            }
        }
        return { type: 'along', stops }
    }
    // Mixed kinds of paint cannot blend stop by stop, so tint toward a representative color.
    const solidA = ga ? sampleStops(a.stops, 0.5) : a as Rgba
    const solidB = gb ? sampleStops(b.stops, 0.5) : b as Rgba
    return mixColor(solidA, solidB, t)
}

function toward(backdrop: Rgba, color: Rgba, dim: number): Rgba {
    return [
        backdrop[0] + (color[0] - backdrop[0]) * dim,
        backdrop[1] + (color[1] - backdrop[1]) * dim,
        backdrop[2] + (color[2] - backdrop[2]) * dim,
        color[3],
    ]
}

/**
 * Take a paint toward a backdrop color: at `dim` 1 the paint is as it is, and at 0 it is the backdrop.
 * The alpha stays, so a dim shape still hides what is behind it. On a plain background, the result is
 * the color that the paint would show at an opacity of `dim`.
 */
export function dimPaint(paint: Paint, dim: number, backdrop: Rgba): Paint {
    if (!isGradient(paint)) return toward(backdrop, paint as Rgba, dim)
    return { ...paint, stops: paint.stops.map(([at, color]) => [at, toward(backdrop, color, dim)] as const) }
}

export function sampleStops(stops: readonly (readonly [number, Rgba])[], at: number): Rgba {
    if (stops.length === 0) return TRANSPARENT
    if (at <= stops[0]![0]) return stops[0]![1]
    for (let i = 1; i < stops.length; i++) {
        if (at <= stops[i]![0]) {
            const [p0, c0] = stops[i - 1]!, [p1, c1] = stops[i]!
            return mixColor(c0, c1, p1 > p0 ? (at - p0) / (p1 - p0) : 0)
        }
    }
    return stops[stops.length - 1]![1]
}

function normalizeStops(colors: readonly ColorInput[] | readonly (readonly [number, ColorInput])[]): (readonly [number, Rgba])[] {
    const count = colors.length
    return (colors as readonly (ColorInput | readonly [number, ColorInput])[]).map((entry, i) => {
        if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'number') {
            return [entry[0] as number, solid(entry[1] as ColorInput)] as const
        }
        return [count === 1 ? 0 : i / (count - 1), solid(entry as ColorInput)] as const
    })
}

function solid(input: ColorInput): Rgba {
    const paint = toPaint(input)
    return isGradient(paint) ? sampleStops(paint.stops, 0.5) : paint as Rgba
}

export function linearGradient(from: readonly [number, number], to: readonly [number, number], colors: readonly ColorInput[] | readonly (readonly [number, ColorInput])[]): LinearGradient {
    return { type: 'linear', from, to, stops: normalizeStops(colors) }
}

export function radialGradient(center: readonly [number, number], radius: number, colors: readonly ColorInput[]): RadialGradient {
    return { type: 'radial', center, radius, stops: normalizeStops(colors) }
}

/** Color that travels along a stroke, such as a graph that warms from left to right. */
export function along(...colors: readonly ColorInput[]): AlongGradient {
    return { type: 'along', stops: normalizeStops(colors) }
}

/** Evenly spaced colors between stops, for coloring a list of items. */
export function ramp(count: number, ...colors: readonly ColorInput[]): Rgba[] {
    const stops = normalizeStops(colors)
    return Array.from({ length: count }, (_, i) => sampleStops(stops, count === 1 ? 0 : i / (count - 1)))
}
