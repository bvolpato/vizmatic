/**
 * The Studio document: objects and timed beats, as plain JSON. Everything a
 * project can do flows through this data, so undo, autosave, files, share links,
 * and code generation all see one truth.
 */
import type { Aspect, LookName } from '../stage/index'

export type PropValue = string | number | boolean | null

export type ObjectProps = Record<string, PropValue>

export interface StudioObject {
    id: string
    /** A key in KINDS. */
    kind: string
    name: string
    /** Center of the object on stage. (0, 0) is mid-frame and y points down. */
    x: number
    y: number
    /** Degrees. */
    rotation: number
    scale: number
    opacity: number
    /** Hidden objects are skipped everywhere, including exports. */
    hidden: boolean
    /** Locked objects cannot be picked on the canvas. */
    locked: boolean
    props: ObjectProps
}

export interface Beat {
    id: string
    /** An object id, or VALUE_TRACK for number tweens. */
    target: string
    /** A key in BEATS. */
    kind: string
    start: number
    duration: number
    /** A key in EASES. */
    ease: string
    params: ObjectProps
}

export interface Marker {
    id: string
    time: number
    title: string
}

export interface Variable {
    name: string
    value: number
}

export interface LoopRegion {
    from: number
    to: number
}

export type ProjectMode = 'visual' | 'code'

export interface StudioProject {
    version: 1
    mode: ProjectMode
    name: string
    look: LookName
    aspect: Aspect
    fps: number
    /** Seconds held after the last beat. */
    hold: number
    objects: StudioObject[]
    beats: Beat[]
    markers: Marker[]
    variables: Variable[]
    loop: LoopRegion | null
    /** Hand-written film source, used when mode is 'code'. */
    source: string
    /** A look picked over the one the source asks for, in code mode. */
    codeLook: LookName | null
}

export const VALUE_TRACK = '@values'

export const LIMITS = Object.freeze({
    objects: 400,
    beats: 2000,
    markers: 200,
    variables: 64,
    stringLength: 20_000,
    sourceBytes: 256 * 1024,
    timelineSeconds: 3600,
})

export function createId(prefix: string): string {
    const random = Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => byte.toString(36).padStart(2, '0')).join('')
    return `${prefix}_${random.slice(0, 9)}`
}

export function emptyProject(name = 'Untitled film'): StudioProject {
    return {
        version: 1, mode: 'visual', name, look: 'midnight', aspect: '16:9', fps: 60, hold: 1,
        objects: [], beats: [], markers: [], variables: [], loop: null, source: '', codeLook: null,
    }
}

/** Round stored numbers so documents, generated code, and frames agree exactly. */
export function round3(value: number): number {
    return Math.round(value * 1000) / 1000
}

export function beatEnd(beat: Beat): number {
    return beat.start + beat.duration
}

/** Length of the film: the last beat or marker, plus the hold. */
export function projectDuration(project: StudioProject): number {
    let end = 0
    for (const beat of project.beats) {
        if (beat.target === VALUE_TRACK || project.objects.some((object) => object.id === beat.target && !object.hidden)) {
            end = Math.max(end, beatEnd(beat))
        }
    }
    for (const marker of project.markers) end = Math.max(end, marker.time)
    return round3(Math.max(end + project.hold, 1 / project.fps))
}

export function objectById(project: StudioProject, id: string): StudioObject | undefined {
    return project.objects.find((object) => object.id === id)
}

/** Beats placed on non-overlapping lanes within a track, for display. */
export function laneOf(beats: readonly Beat[]): Map<string, number> {
    const lanes = new Map<string, number>()
    const ends: number[] = []
    const sorted = [...beats].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    for (const beat of sorted) {
        let lane = ends.findIndex((end) => end <= beat.start + 1e-6)
        if (lane < 0) {
            lane = ends.length
            ends.push(0)
        }
        ends[lane] = beatEnd(beat)
        lanes.set(beat.id, lane)
    }
    return lanes
}
