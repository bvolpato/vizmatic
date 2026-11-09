import type { Ease } from './ease'
import type { Node } from './node'
import type { Stage } from './stage'
import { clock } from './track'

/** One `spotlight` of a film, as its stage keeps it. */
export interface Light {
    /** When the light starts to change the stage, and when the change is complete, in seconds of the film. */
    readonly start: number
    readonly end: number
    readonly ease: Ease
    /** The nodes that the light is on. Null turns the light off. */
    readonly targets: readonly Node[] | null
    /** Nodes that stay bright with the targets. */
    readonly keep: readonly Node[]
    /** The node that the light stays inside. Null is the whole stage. */
    readonly within: Node | null
    /** The part of its color that the rest keeps, from 0 to 1. */
    readonly dim: number
}

/** One morph of a film, as its stage keeps it for the lights. */
export interface MorphRecord {
    readonly start: number
    readonly end: number
    /** The nodes that the morph starts from, which it hides at its start. */
    readonly from: readonly Node[]
    /** The nodes that it ends in, which show from its end. */
    readonly to: readonly Node[]
    /** The shapes that travel between the two, which the morph makes. */
    readonly ghosts: readonly Node[]
}

/**
 * Two times that are nearer than this are one time. Two cues of a narration can differ in the last digit,
 * as 0.1 + 0.2 and 0.3 do, and a node that becomes visible at the time of a light was not there before.
 */
const SAME_TIME = 1e-6

const sameTime = (a: number, b: number) => Math.abs(a - b) < SAME_TIME

const seconds = (time: number) => `${Math.round(time * 1000) / 1000} s`

/** True when `node` is somewhere under `outer`. */
export function inside(node: Node, outer: Node): boolean {
    for (let up = node.parent; up; up = up.parent) if (up === outer) return true
    return false
}

/** The `dim` that a node draws with now: the least of its own and of its ancestors'. */
export function drawnDim(node: Node): number {
    let least = 1
    for (let up: Node | null = node; up; up = up.parent) least = Math.min(least, up.get('dim'))
    return least
}

function drawnDimAt(node: Node, time: number): number {
    const saved = clock.now
    clock.now = time
    try {
        return drawnDim(node)
    } finally {
        clock.now = saved
    }
}

/** True when the node and its ancestors are visible at a time. */
function visibleAt(node: Node, time: number): boolean {
    const saved = clock.now
    clock.now = time
    try {
        for (let up: Node | null = node; up; up = up.parent) if (!up.get('visible')) return false
        return true
    } finally {
        clock.now = saved
    }
}

/**
 * True when the node enters at a time: it is visible then, and it was not before. At time 0 the timeline
 * cannot say "before", so the stage keeps the time at which a verb brought each node.
 */
function entersAt(stage: Stage, node: Node, time: number): boolean {
    if (!visibleAt(node, time + SAME_TIME)) return false
    if (!visibleAt(node, time - SAME_TIME)) return true
    for (let up: Node | null = node; up; up = up.parent) {
        const arrival = stage.arrivals.get(up)
        if (arrival !== undefined && sameTime(arrival, time)) return true
    }
    return false
}

/**
 * True when the node shows at the start of a light: a viewer can see it just before that time, and still at
 * that time. A node that enters at the very time of the light is not there yet, and a node at opacity 0 at
 * that time is not there either: both arrive with their own look, as a node that enters later does.
 */
function showsAt(stage: Stage, node: Node, start: number): boolean {
    if (!visibleAt(node, start + SAME_TIME) || entersAt(stage, node, start)) return false
    for (let up: Node | null = node; up; up = up.parent) if (up.get('opacity') <= 0) return false
    return true
}

/** How deep the node of a light is in the tree. A light of the whole stage is at 0. */
function depth(light: Light): number {
    let count = 0
    for (let up = light.within; up; up = up.parent) count++
    return count
}

/** Add a light to its stage. Two lights that start together in one place have no order, so that is an error. */
export function addLight(stage: Stage, light: Light): void {
    if (stage.lights.some((other) => other.within === light.within && sameTime(other.start, light.start))) {
        const where = light.within ? 'in the same node' : 'on the stage'
        throw new Error(`spotlight: two lights start at ${seconds(light.start)} ${where}, and only one can decide what is dim. Give one light all the targets, or start one of them later`)
    }
    stage.lights.push(light)
}

/** Stop the build for a light that would show nothing. `dimmed` is what the lights before it left dim. */
function verify(light: Light, targets: readonly Node[], stage: Stage, dimmed: ReadonlySet<Node>): void {
    const at = seconds(light.start)
    targets.forEach((target, index) => {
        const onStage = inside(target, stage.root)
        const shows = (): boolean => {
            if (visibleAt(target, light.start)) return true
            for (let up: Node | null = target; up; up = up.parent) {
                // A part of a thing that enters with the light can wait for its turn, as a glyph of a text that `write` brings.
                if (entersAt(stage, up, light.start)) return true
                // A morph hides the node that it starts from, and the light is on the shape that travels.
                if (stage.morphs.some((morph) => sameTime(morph.start, light.start) && morph.from.includes(up!))) return true
            }
            return false
        }
        if (onStage && shows()) return
        const which = targets.length > 1 ? `target ${index + 1} of ${targets.length}` : 'the target'
        const state = onStage ? 'does not show at that time: it is hidden, or it comes to the stage later' : 'is not on the stage'
        throw new Error(`spotlight: ${which} of the light at ${at} ${state}. So the light would show nothing. Show the node before the light, or bring it at the time that the light starts. For a morph that starts then, light the node that the morph starts from`)
    })
    for (let up = light.within; up; up = up.parent) {
        if (dimmed.has(up)) throw new Error(`spotlight: the node for within is dim at ${at}, because another light is on something else then. So the light in it would show nothing. Make that node a target of the other light, or turn the other light off first`)
    }
}

/**
 * Stop the build for a morph that a light would make jump. The shapes that travel are new nodes with their
 * own look. So a dim source jumps to bright when its morph starts, and at its end a dim shape, or a result
 * in a dim group, does not match the other.
 */
function verifyMorphs(stage: Stage, lights: readonly Light[]): void {
    const dimAt = (nodes: readonly Node[], time: number) => nodes.some((node) => drawnDimAt(node, time) < 1)
    for (const morph of stage.morphs) {
        const time = dimAt(morph.from, morph.start) ? morph.start : dimAt([...morph.to, ...morph.ghosts], morph.end) ? morph.end : null
        if (time === null) continue
        const light = [...lights].reverse().find((other) => other.targets !== null && other.start <= time)
        throw new Error(`spotlight: the light at ${seconds(light?.start ?? time)} dims a node while it morphs, from ${seconds(morph.start)} to ${seconds(morph.end)}. A dim morph would jump in brightness. Make the node that the morph starts from a target or a keep of that light, or turn the light off before the morph`)
    }
}

/**
 * The nodes that a light dims: the highest nodes in its place that show at its start and hold nothing
 * bright. One `dim` on a node dims all that is in it, so the nodes below them need none.
 */
function restOf(light: Light, targets: readonly Node[], scope: Node, stage: Stage): Set<Node> {
    // An object can say which labels belong to one of its parts, such as the name and the readout of a bar.
    const labels = targets.flatMap((target) => {
        const found: Node[] = []
        for (let up = target.parent; up; up = up.parent) found.push(...up.labelsOf(target))
        return found
    })
    const bright = new Set([...targets, ...labels, ...light.keep, ...scope.all().filter((node) => node.get('fixed'))])
    // A node that holds a bright node cannot dim as a whole: its `dim` would reach the bright node.
    const holders = new Set<Node>()
    for (const node of bright) for (let up = node.parent; up; up = up.parent) holders.add(up)
    const rest = new Set<Node>()
    const collect = (parent: Node): void => {
        for (const child of parent.children) {
            // A mark of a verb is as bright as the node that it belongs to, so no light dims it by itself.
            if (bright.has(child) || stage.marks.has(child)) continue
            if (holders.has(child)) collect(child)
            else if (showsAt(stage, child, light.start)) rest.add(child)
        }
    }
    collect(scope)
    return rest
}

/**
 * Turn the lights of a stage into the `dim` of each node, from nothing. A light does not change the stage
 * when the film names it, because a film names its lights and brings its nodes in any order of time. So
 * this reads the complete timeline: it takes the lights in time order, and for each one it asks what was on
 * the stage at its start. The result is the same for every order of the same calls. It runs once, when the
 * build of the film ends, and it stops the build for a light that would show nothing.
 */
export function settleLights(stage: Stage): void {
    if (stage.lights.length === 0) return
    // A light of the whole stage comes before a light in a node that starts with it, so the two do not depend on the order of the code.
    const lights = [...stage.lights].sort((a, b) => (sameTime(a.start, b.start) ? depth(a) - depth(b) : a.start - b.start))
    /** The nodes that have a `dim` of their own from the lights so far. */
    const dimmed = new Set<Node>()
    const saved = clock.now
    try {
        for (const light of lights) {
            clock.now = light.start
            const scope = light.within ?? stage.root
            if (light.targets) verify(light, light.targets, stage, dimmed)
            // A light that goes off has no rest.
            const rest = light.targets ? restOf(light, light.targets, scope, stage) : new Set<Node>()
            const inRest = (node: Node): boolean => {
                for (let up: Node | null = node; up && up !== scope; up = up.parent) if (rest.has(up)) return true
                return false
            }
            // The last light decides for every node in its place, so it takes over what the lights before it dimmed there.
            const before = light.within ? [...dimmed].filter((node) => inside(node, scope)) : [...dimmed]
            // What was dim and is in the rest stays dim, what was dim and is not comes back, and the rest dims.
            for (const node of new Set([...before, ...rest])) {
                const to = inRest(node) ? light.dim : 1
                // The node starts from the `dim` that it draws with. When the light moves from a group to one of its
                // parts, that is the `dim` of the group: the other parts take it over, and the group comes back.
                const from = drawnDim(node)
                node.track('dim').add({ t0: light.start, t1: light.end, ease: light.ease, to, at: (alpha) => from + (to - from) * alpha })
                if (to === 1) dimmed.delete(node)
                else dimmed.add(node)
            }
        }
        verifyMorphs(stage, lights)
    } finally {
        clock.now = saved
    }
}
