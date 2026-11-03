export interface GlyphOutline {
    /** Each contour is a closed cubic ring in font units, with y pointing up. */
    readonly contours: readonly number[][]
}

export interface LoadedFont {
    readonly unitsPerEm: number
    readonly ascent: number
    readonly descent: number
    readonly lineGap: number
    glyphFor(code: number): number
    advance(glyph: number): number
    kern(left: number, right: number): number
    outline(glyph: number): GlyphOutline | null
}

export function curveFree(contours: number[][]): GlyphOutline {
    return { contours: contours.filter((contour) => contour.length >= 8) }
}
