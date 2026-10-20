import { smoothstep, type MotionEasing, type MotionPoint } from './motion'

/** Camera center in world coordinates and the scale applied to that world. */
export interface Camera2D {
    x: number
    y: number
    zoom: number
}

/** Size of the SVG viewport in pixels. */
export interface CameraViewport {
    width: number
    height: number
}

export interface CameraMotionOptions {
    easing?: MotionEasing
    minZoom?: number
    maxZoom?: number
}

function clampProgress(progress: number): number {
    if (!Number.isFinite(progress)) throw new Error('Camera progress must be finite')
    return Math.max(0, Math.min(1, progress))
}

function assertCamera(camera: Camera2D, context: string): void {
    if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
        throw new Error(`${context} coordinates must be finite`)
    }
    if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) {
        throw new Error(`${context} zoom must be finite and greater than zero`)
    }
}

function assertViewport(viewport: CameraViewport): void {
    if (!Number.isFinite(viewport.width) || viewport.width <= 0) {
        throw new Error('Camera viewport width must be finite and greater than zero')
    }
    if (!Number.isFinite(viewport.height) || viewport.height <= 0) {
        throw new Error('Camera viewport height must be finite and greater than zero')
    }
}

function assertZoomConstraints(options: CameraMotionOptions): void {
    const { minZoom, maxZoom } = options
    if (minZoom !== undefined && (!Number.isFinite(minZoom) || minZoom <= 0)) {
        throw new Error('Camera minZoom must be finite and greater than zero')
    }
    if (maxZoom !== undefined && (!Number.isFinite(maxZoom) || maxZoom <= 0)) {
        throw new Error('Camera maxZoom must be finite and greater than zero')
    }
    if (minZoom !== undefined && maxZoom !== undefined && minZoom > maxZoom) {
        throw new Error('Camera minZoom cannot exceed maxZoom')
    }
}

function assertZoomInRange(camera: Camera2D, options: CameraMotionOptions): void {
    if (
        (options.minZoom !== undefined && camera.zoom < options.minZoom) ||
        (options.maxZoom !== undefined && camera.zoom > options.maxZoom)
    ) {
        throw new Error('Camera zoom is outside the configured range')
    }
}

function interpolateLinear(from: number, to: number, progress: number): number {
    return from * (1 - progress) + to * progress
}

/**
 * Interpolate a camera at any normalized time. Position is linear, zoom is
 * logarithmic, and progress outside [0, 1] holds the nearest endpoint.
 */
export function interpolateCamera(
    from: Camera2D,
    to: Camera2D,
    progress: number,
    options: CameraMotionOptions = {},
): Camera2D {
    assertCamera(from, 'Camera start')
    assertCamera(to, 'Camera end')
    assertZoomConstraints(options)
    assertZoomInRange(from, options)
    assertZoomInRange(to, options)

    const amount = clampProgress(progress)
    if (amount === 0) return { ...from }
    if (amount === 1) return { ...to }

    const eased = (options.easing ?? smoothstep)(amount)
    if (!Number.isFinite(eased)) throw new Error('Camera easing must return a finite number')
    const t = Math.max(0, Math.min(1, eased))
    if (t === 0) return { ...from }
    if (t === 1) return { ...to }

    const camera = {
        x: interpolateLinear(from.x, to.x, t),
        y: interpolateLinear(from.y, to.y, t),
        zoom: Math.exp(Math.log(from.zoom) * (1 - t) + Math.log(to.zoom) * t),
    }
    assertCamera(camera, 'Camera result')
    assertZoomInRange(camera, options)
    return camera
}

/** Return the SVG transform that centers the camera on its world position. */
export function cameraSvgTransform(camera: Camera2D, viewport: CameraViewport): string {
    assertCamera(camera, 'Camera')
    assertViewport(viewport)
    return `translate(${viewport.width / 2} ${viewport.height / 2}) scale(${camera.zoom}) translate(${-camera.x} ${-camera.y})`
}

/** Project one world point to pixels using the same center-pivot camera rule. */
export function projectWorldPoint(
    point: MotionPoint,
    camera: Camera2D,
    viewport: CameraViewport,
): MotionPoint {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new Error('World point coordinates must be finite')
    }
    assertCamera(camera, 'Camera')
    assertViewport(viewport)

    const projected = {
        x: viewport.width / 2 + (point.x - camera.x) * camera.zoom,
        y: viewport.height / 2 + (point.y - camera.y) * camera.zoom,
    }
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
        throw new Error('Projected world point coordinates must be finite')
    }
    return projected
}
