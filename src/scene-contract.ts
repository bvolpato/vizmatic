export const SCENE_RUNTIME_VERSION = 'vizmatic-scene/1'

export const SCENE_LIMITS = Object.freeze({
    sourceBytes: 131_072,
    graphBytes: 2_097_152,
    nodes: 2_000,
    depth: 64,
    stringLength: 65_536,
    canvasEdge: 1_920,
    canvasPixels: 2_073_600,
    duration: 120,
    frames: 3_600,
    memoryBytes: 64 * 1_024 * 1_024,
    stackBytes: 256 * 1_024,
    evaluationMs: 250,
})

/** All scene time values, including cues and duration, are in seconds. */
export interface SceneRequest {
    source: string
    width: number
    height: number
    duration: number
    fps?: number
    theme?: 'dark' | 'light'
    cues?: Record<string, number>
    seed?: number
}

export interface SceneFrameRequest extends SceneRequest {
    time?: number
}

export interface NormalizedSceneRequest {
    source: string
    width: number
    height: number
    duration: number
    fps: number
    theme: 'dark' | 'light'
    cues: Record<string, number>
    seed: number
    frameCount: number
}

export type SceneJson = null | boolean | number | string | SceneJson[] | { [key: string]: SceneJson }

export interface SceneElement {
    kind: 'vizmatic.element'
    type: string
    props: { [key: string]: SceneJson }
    children: SceneJson[]
}

const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor'])

export function isUnsafeSceneKey(key: string): boolean {
    return unsafeKeys.has(key)
}

export function normalizeSceneRequest(request: SceneRequest): NormalizedSceneRequest {
    if (!request || typeof request !== 'object') throw new Error('A scene request is required.')
    if (typeof request.source !== 'string' || !request.source.trim()
        || new TextEncoder().encode(request.source).byteLength > SCENE_LIMITS.sourceBytes) {
        throw new Error(`Scene source must contain between 1 and ${SCENE_LIMITS.sourceBytes} UTF-8 bytes.`)
    }
    for (const name of ['width', 'height'] as const) {
        const value = request[name]
        if (!Number.isInteger(value) || value < 2 || value > SCENE_LIMITS.canvasEdge || value % 2 !== 0) {
            throw new Error(`Scene ${name} must be an even integer from 2 to ${SCENE_LIMITS.canvasEdge}.`)
        }
    }
    if (request.width * request.height > SCENE_LIMITS.canvasPixels) {
        throw new Error(`Scene canvas supports at most ${SCENE_LIMITS.canvasPixels} pixels.`)
    }
    if (!Number.isFinite(request.duration) || request.duration <= 0 || request.duration > SCENE_LIMITS.duration) {
        throw new Error(`Scene duration must be greater than 0 and at most ${SCENE_LIMITS.duration} seconds.`)
    }
    const fps = request.fps ?? 24
    if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Scene fps must be an integer from 1 to 60.')
    const frameCount = Math.round(request.duration * fps)
    if (frameCount < 1 || frameCount > SCENE_LIMITS.frames) {
        throw new Error(`Scene duration must round to between 1 and ${SCENE_LIMITS.frames} frames.`)
    }
    const theme = request.theme ?? 'dark'
    if (theme !== 'dark' && theme !== 'light') throw new Error('Scene theme must be dark or light.')
    const seed = request.seed ?? 0
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('Scene seed must be a uint32 integer.')
    const cues: Record<string, number> = Object.create(null)
    if (request.cues !== undefined && (!request.cues || typeof request.cues !== 'object' || Array.isArray(request.cues))) {
        throw new Error('Scene cues must be an object containing times in seconds.')
    }
    const cueEntries = Object.entries(request.cues ?? {})
    if (cueEntries.length > 128) throw new Error('Scene supports at most 128 cues.')
    for (const [name, time] of cueEntries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
        if (!/^[A-Za-z][\w.-]{0,79}$/.test(name) || isUnsafeSceneKey(name)
            || !Number.isFinite(time) || time < 0 || time > request.duration) {
            throw new Error(`Invalid scene cue ${JSON.stringify(name)}. Cue times must be within the requested duration.`)
        }
        cues[name] = time
    }
    return {
        source: request.source, width: request.width, height: request.height,
        duration: request.duration, fps, theme, cues, seed, frameCount,
    }
}

export function normalizeSceneTime(time: number | undefined, duration: number): number {
    const value = time ?? 0
    if (!Number.isFinite(value) || value < 0 || value > duration) {
        throw new Error('Scene time must be within its duration, in seconds.')
    }
    return value
}

export async function sceneSha256(value: string | Uint8Array): Promise<string> {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    const digest = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
