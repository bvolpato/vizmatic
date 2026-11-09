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
export { checkFilm, readingSeconds, type FilmCheckOptions, type FilmCheckReport, type FilmDiagnostic, type FilmDiagnosticCode } from './check'
export * from './objects/index'
export { fromSvg, SvgNode, type FromSvgOptions } from './svg-import'
export { resolveImageAsset, ImageAssetError, type ImageAsset, type ImageAssetOptions, type ImageFitOptions, type ImageCrop } from './image'
export { narration, Narration, SceneClock, captionLines } from './narration'
export type { NarrationTiming, NarrationScene, NarrationBeat, NarrationWord, NarrationOptions, PlacedBeat, Cue, CueOptions, Showable } from './narration'
export { narrated } from './narrated'
export type { NarratedOptions, TimingFile, FilmClock, SceneFunction, IntroFunction, TitleCard } from './narrated'
export { sceneKit, sceneArea } from './scene-kit'
export type { SceneKit, SceneKitOptions, SceneArea, ClaimState, ClaimTagOptions } from './scene-kit'
export { Box, Block, GAP, boxOf, row, column, grid, place, beside, between, fitted } from './layout'
export type { Gap, Where, BesideSide, LayoutItem, Measured, Maybe, RowOptions, ColumnOptions, GridOptions } from './layout'
export { lerp, clamp, smoothstep, valueAt, commas, assertEqual } from './numbers'
export { capHeight, textWidth, fitSize, type TextMeasureOptions, type TextFontOptions } from './text-fit'
export { seededRandom } from './objects/util'
export * from './three/index'
