import type { Anim, AnimOptions } from './anim'
import { smoother, type Ease } from './ease'
import type { Vec } from './geometry'
import { Block, Box, boxOf } from './layout'
import { Node } from './node'
import type { Stage } from './stage'
import { clock } from './track'

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export interface FocusOptions extends AnimOptions {
    /** Explicit camera zoom factor. When omitted, fits target bounds with padding (or defaults to 2 for a point). */
    zoom?: number
    /** Screen-space padding around target bounds when computing auto-zoom. Defaults to 120. */
    padding?: number
    /** Alias for padding. */
    margin?: number
    duration?: number
    ease?: Ease
}

function isPoint(value: unknown): value is Vec {
    return Array.isArray(value)
        && value.length === 2
        && typeof value[0] === 'number'
        && typeof value[1] === 'number'
        && Number.isFinite(value[0])
        && Number.isFinite(value[1])
}

function checkStage(verb: string, stage: Stage): void {
    if (!stage || !(stage.camera instanceof Node) || !Number.isFinite(stage.width) || !Number.isFinite(stage.height)) {
        throw new Error(`${verb}: expected a Stage as the first argument`)
    }
}

/**
 * Smoothly pan and zoom `stage.camera` to center `target` on screen.
 *
 * Accepts a `Node`, a layout `Block`, a `Box`, or an `[x, y]` world point.
 * In `display.ts`, `camera.x` and `camera.y` are the world-space pivot centered
 * at `(stage.width / 2, stage.height / 2)`, and `camera.sx` / `camera.sy` set zoom.
 */
export function focusOn(stage: Stage, target: Node | Block | Box | Vec, options: FocusOptions = {}): Anim {
    checkStage('focusOn', stage)
    if (target === stage.camera) {
        throw new Error('focusOn: target is stage.camera, which is not part of the picture. Give a node, block, box, or [x, y] point')
    }
    if (!isPoint(target) && !(target instanceof Node) && !(target instanceof Block) && !(target instanceof Box)) {
        throw new Error('focusOn: target must be a Node, Block, Box, or finite [x, y] point')
    }
    if (options.zoom !== undefined && (!Number.isFinite(options.zoom) || options.zoom <= 0)) {
        throw new Error(`focusOn: zoom must be a positive finite number, got ${String(options.zoom)}`)
    }
    const pad = options.padding ?? options.margin ?? 120
    if (!Number.isFinite(pad) || pad < 0) {
        throw new Error(`focusOn: padding must be a non-negative finite number, got ${String(pad)}`)
    }
    if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration < 0)) {
        throw new Error(`focusOn: duration must be a non-negative finite number, got ${String(options.duration)}`)
    }
    return {
        label: 'focusOn',
        duration: options.duration ?? 1.2,
        ease: options.ease ?? smoother,
        schedule: (ctx) => {
            const saved = clock.now
            clock.now = ctx.t0
            let cx: number
            let cy: number
            let zoom: number
            try {
                if (isPoint(target)) {
                    cx = target[0]
                    cy = target[1]
                    zoom = options.zoom ?? 2
                } else {
                    const box = target instanceof Box ? target : boxOf(target)
                    cx = box.cx
                    cy = box.cy
                    if (options.zoom !== undefined) {
                        zoom = options.zoom
                    } else if (box.width > 0 && box.height > 0) {
                        const availW = Math.max(1, stage.width - pad * 2)
                        const availH = Math.max(1, stage.height - pad * 2)
                        zoom = clamp(Math.min(availW / box.width, availH / box.height), 0.25, 8)
                    } else if (box.width > 0) {
                        zoom = clamp(Math.max(1, stage.width - pad * 2) / box.width, 0.25, 8)
                    } else if (box.height > 0) {
                        zoom = clamp(Math.max(1, stage.height - pad * 2) / box.height, 0.25, 8)
                    } else {
                        zoom = 2
                    }
                }
            } finally {
                clock.now = saved
            }
            stage.camera.tween('x', cx, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('y', cy, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('sx', zoom, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('sy', zoom, ctx.t0, ctx.t1, ctx.ease)
        },
    }
}

/** Smoothly return `stage.camera` to the full-frame home view (`x: 0, y: 0, sx: 1, sy: 1, rotation: 0`). */
export function resetCamera(stage: Stage, options: AnimOptions = {}): Anim {
    checkStage('resetCamera', stage)
    if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration < 0)) {
        throw new Error(`resetCamera: duration must be a non-negative finite number, got ${String(options.duration)}`)
    }
    return {
        label: 'resetCamera',
        duration: options.duration ?? 1.0,
        ease: options.ease ?? smoother,
        schedule: (ctx) => {
            stage.camera.tween('x', 0, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('y', 0, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('sx', 1, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('sy', 1, ctx.t0, ctx.t1, ctx.ease)
            stage.camera.tween('rotation', 0, ctx.t0, ctx.t1, ctx.ease)
        },
    }
}
