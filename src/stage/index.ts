/**
 * vizmatic/stage: a deterministic vector animation engine.
 *
 * Author a film as a plain function. Each `s.play(...)` writes keys on a
 * timeline, so any frame can be sampled instantly at any time. The same film
 * paints live to a browser canvas and exports to frame-accurate MP4.
 */
export * from './geometry'
export * from './ease'
export * from './look'
export {
    parseColor, css, mixColor, linearGradient, radialGradient, along as colorAlong, ramp,
    type Rgba, type Paint, type ColorInput, type Gradient,
} from './color'
export { Node, group, dynamic, type NodeProps, type PropName, type Side, type Edge, type BlendMode, type StageImage } from './node'
export * from './anim'
export { Stage, film, isFilm, compileFilm, CompiledFilm, Suspend, isSuspend } from './stage'
export type { FilmOptions, FilmDefinition, Aspect, Chapter, Clip, Caption, PlayOptions, CompileOverrides } from './stage'
export { buildOps, frameToSvg, paintFrame, frameInkBounds } from './display'
export type { Frame, DrawOp, PathOp, ImageOp, Canvas2D } from './display'
export { text, TextNode, type TextOptions } from './text'
export { tex, TexNode, type TexOptions } from './tex'
export { setAssetBase } from './assets'
export { parseFont, fontFor, glyphPath, type FontFamily, type FontWeight, type LoadedFont } from './font'
export * from './shapes'
export * from './objects'
export { checkFilm, type FilmCheckOptions, type FilmCheckReport, type FilmDiagnostic, type FilmDiagnosticCode } from './check'
export * from './objects/index'
export { fromSvg, SvgNode, type FromSvgOptions } from './svg-import'
export { narration, Narration, SceneClock, captionLines } from './narration'
export type { NarrationTiming, NarrationScene, NarrationBeat, NarrationWord, NarrationOptions, PlacedBeat } from './narration'
export * from './three/index'
