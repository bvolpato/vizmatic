/** Measures of a line of text, for a label that must fit a shape and keep its distance from a line. */
import type { FontFamily } from './font'
import { text, type TextOptions } from './text'

/** The options that change the width of a line of text. */
export type TextMeasureOptions = Pick<TextOptions, 'font' | 'weight' | 'italic' | 'tracking' | 'uppercase'>
/** The same options, with the font that the width is for. */
export type TextFontOptions = TextMeasureOptions & { font: FontFamily }

/**
 * The height of the capital letters of a text of this size: `capHeight(40)` is 27.2. Keep at least this much
 * room between a text and a line or a border. The value is right for the bundled text fonts.
 */
export function capHeight(size: number): number {
    return size * 0.68
}

/** The advance width of one line: the letters and the space at both sides of them. An object measures its own text with it. */
export function advanceWidth(content: string, size: number, options: TextMeasureOptions = {}): number {
    // The origin of a text with its anchor at the right is its advance width.
    return text(content, { ...options, size, anchor: 'right' }).get('px')
}

/** The largest size, not over `size`, at which the advance width of a line is no more than `width`. */
export function fittedSize(content: string, width: number, size: number, options: TextMeasureOptions = {}): number {
    if (!(width > 0)) throw new Error(`fitSize: the width must be more than 0, and it is ${width}`)
    const natural = advanceWidth(content, size, options)
    return natural <= width ? size : Math.floor((size * width) / natural)
}

/** A width is the width of a text in one font. Without the font, the same text would measure differently from the text that is drawn. */
function needFont(name: string, options: TextMeasureOptions | undefined): asserts options is TextFontOptions {
    if (!options?.font) throw new Error(`${name}: give the font of the text, such as { font: 'text-serif' }. The kit of a film has ${name} with the font of the film`)
}

/**
 * The width of one line of text, in stage pixels: `textWidth('p99 latency', 36, { font: 'text-serif' })`.
 * It is the advance width, which has the space at both sides of the letters, so two labels in a row do not touch.
 * The font is not optional, because a width in another font than the text is drawn in is a wrong width.
 * In a film with a kit, use the `textWidth` of the kit, which measures in the font of the film.
 */
export function textWidth(content: string, size: number, options: TextFontOptions): number {
    needFont('textWidth', options)
    return advanceWidth(content, size, options)
}

/**
 * The largest font size, not over `size`, at which a line of text is no wider than `width`:
 * `fitSize('Toto-2.0-2.5b', 220, 40, { font: 'text-serif' })`. Use it for a name inside a shape, so that the
 * name is never wider than the shape. The result can be too small to read, so compare it with the size that
 * you asked for. In a film with a kit, use the `fitSize` of the kit, which measures in the font of the film.
 */
export function fitSize(content: string, width: number, size: number, options: TextFontOptions): number {
    needFont('fitSize', options)
    return fittedSize(content, width, size, options)
}
