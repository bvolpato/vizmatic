import parseCssColor from 'parse-css-color'

export interface RgbaColor {
    r: number
    g: number
    b: number
    alpha: number
}

/** Convert CSS HSL (degrees, percent, percent) to RGB channels in 0..255. */
export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const h = ((hue % 360) + 360) % 360
    const s = saturation / 100
    const l = lightness / 100
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const segment = h / 60
    const intermediate = chroma * (1 - Math.abs((segment % 2) - 1))
    let channels: [number, number, number]
    if (segment < 1) channels = [chroma, intermediate, 0]
    else if (segment < 2) channels = [intermediate, chroma, 0]
    else if (segment < 3) channels = [0, chroma, intermediate]
    else if (segment < 4) channels = [0, intermediate, chroma]
    else if (segment < 5) channels = [intermediate, 0, chroma]
    else channels = [chroma, 0, intermediate]
    const offset = l - chroma / 2
    return [
        Math.round((channels[0] + offset) * 255),
        Math.round((channels[1] + offset) * 255),
        Math.round((channels[2] + offset) * 255),
    ]
}

/** Parse any CSS color string supported by parse-css-color into RGBA (0..255, alpha 0..1). */
export function parseCssRgba(value: unknown): RgbaColor | undefined {
    if (typeof value !== 'string') return undefined
    const parsed = parseCssColor(value)
    if (!parsed || parsed.values.length < 3) return undefined
    const [r, g, b] = parsed.type === 'hsl'
        ? hslToRgb(parsed.values[0] ?? 0, parsed.values[1] ?? 0, parsed.values[2] ?? 0)
        : [parsed.values[0] ?? 0, parsed.values[1] ?? 0, parsed.values[2] ?? 0]
    return { r, g, b, alpha: parsed.alpha }
}

/** Alpha-composite a foreground color over an optional background color. */
export function compositeRgba(foreground: RgbaColor, background?: RgbaColor): RgbaColor {
    if (foreground.alpha >= 1 || !background) return foreground
    const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha)
    if (alpha <= 0) return { r: 0, g: 0, b: 0, alpha: 0 }
    return {
        r: (foreground.r * foreground.alpha + background.r * background.alpha * (1 - foreground.alpha)) / alpha,
        g: (foreground.g * foreground.alpha + background.g * background.alpha * (1 - foreground.alpha)) / alpha,
        b: (foreground.b * foreground.alpha + background.b * background.alpha * (1 - foreground.alpha)) / alpha,
        alpha,
    }
}

/** WCAG 2.1 linearized sRGB channel value for a 0..255 byte. */
export function srgbChannelLuminance(value: number): number {
    const normalized = value / 255
    return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of an sRGB triple (0..255), per WCAG 2.1. */
export function relativeLuminanceRgb(r: number, g: number, b: number): number {
    return 0.2126 * srgbChannelLuminance(r)
        + 0.7152 * srgbChannelLuminance(g)
        + 0.0722 * srgbChannelLuminance(b)
}

/** WCAG contrast ratio from two relative luminances. */
export function contrastRatioLuminance(first: number, second: number): number {
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}
