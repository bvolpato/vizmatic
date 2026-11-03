import { compileFilm, film, Suspend, rect, type CompiledFilm, type FilmDefinition, type Node, type Stage, type Value } from '../stage/index'
import { BEATS, DEFAULT_EASE, EASES, type BeatBuild } from './beats'
import { KINDS, type BuildContext } from './catalog'
import { projectDuration, VALUE_TRACK, type Beat, type StudioObject, type StudioProject } from './model'

export interface BuildResult {
    /** Live nodes by object id, for selection and handles. */
    nodes: Map<string, Node>
    /** Problems to show beside the object or beat that caused them. */
    objectErrors: Map<string, string>
    beatErrors: Map<string, string>
}

export interface StudioFilm extends BuildResult {
    film: CompiledFilm
}

/** Rotate, scale, and place a freshly built node, so its center lands on the object's x and y. */
export function placeNode(node: Node, object: StudioObject): Node {
    node.moveTo([object.x, object.y])
    if (object.scale !== 1) node.scale(object.scale)
    if (object.rotation !== 0) node.rotate(object.rotation * Math.PI / 180)
    if (object.opacity !== 1) node.opacity(object.opacity)
    return node
}

/** Objects that stay hidden until a beat brings them in. */
export function hiddenAtStart(project: StudioProject): Set<string> {
    const hidden = new Set<string>()
    const sorted = sortedBeats(project.beats)
    const seen = new Set<string>()
    for (const beat of sorted) {
        if (beat.kind === 'morph' && beat.params['into']) hidden.add(String(beat.params['into']))
        if (seen.has(beat.target)) continue
        seen.add(beat.target)
        if (BEATS[beat.kind]?.entrance) hidden.add(beat.target)
    }
    return hidden
}

export function sortedBeats(beats: readonly Beat[]): Beat[] {
    // A stable order by time keeps generated code and the live film identical.
    return beats
        .map((beat, index) => ({ beat, index }))
        .sort((a, b) => a.beat.start - b.beat.start || a.index - b.index)
        .map(({ beat }) => beat)
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function rethrowSuspend(error: unknown): void {
    if (error instanceof Suspend) throw error
}

/** Turn a project into a film. `onBuilt` runs after each successful authoring pass. */
export function projectToFilm(project: StudioProject, onBuilt?: (result: BuildResult) => void): FilmDefinition {
    return film({ title: project.name, look: project.look, aspect: project.aspect, fps: project.fps }, (s: Stage) => {
        const result: BuildResult = { nodes: new Map(), objectErrors: new Map(), beatErrors: new Map() }
        const values = new Map<string, Value>()
        for (const variable of project.variables) values.set(variable.name, s.value(variable.value))
        const ctx: BuildContext = { stage: s, values }
        const hidden = hiddenAtStart(project)
        const kinds = new Map(project.objects.map((object) => [object.id, object.kind]))

        for (const object of project.objects) {
            if (object.hidden) continue
            const def = KINDS[object.kind]
            let node: Node
            try {
                if (!def) throw new Error(`Unknown object kind: ${object.kind}`)
                node = placeNode(def.build(object.props, ctx), object)
            } catch (error) {
                rethrowSuspend(error)
                result.objectErrors.set(object.id, message(error))
                node = rect(220, 90, { stroke: 'red', width: 2, dash: [8, 7] }).moveTo([object.x, object.y])
            }
            if (hidden.has(object.id)) node.hide()
            s.add(node)
            result.nodes.set(object.id, node)
        }

        const beatContext = (node: Node): BeatBuild => ({
            node, nodes: result.nodes, values, objectKind: (id) => kinds.get(id),
        })
        for (const beat of sortedBeats(project.beats)) {
            const def = BEATS[beat.kind]
            const node = result.nodes.get(beat.target)
            if (!def || (!node && beat.target !== VALUE_TRACK)) continue
            try {
                const anim = def.build(beat, beatContext(node as Node))
                if (!anim) continue
                const ease = def.eases ? (EASES[beat.ease] ?? EASES[DEFAULT_EASE]!).fn : undefined
                s.at(beat.start, () => s.play(anim, { duration: beat.duration, ...(ease ? { ease } : {}) }))
            } catch (error) {
                rethrowSuspend(error)
                result.beatErrors.set(beat.id, message(error))
            }
        }
        for (const marker of [...project.markers].sort((a, b) => a.time - b.time)) {
            s.at(marker.time, () => s.chapter(marker.title))
        }
        s.at(projectDuration(project), () => {})
        onBuilt?.(result)
    })
}

/** Compile a project to a seekable film, with its node map and any errors. */
export async function compileProject(project: StudioProject): Promise<StudioFilm> {
    let built: BuildResult | null = null
    const compiled = await compileFilm(projectToFilm(project, (result) => { built = result }))
    if (!built) throw new Error('The film finished without building.')
    return { film: compiled, ...(built as BuildResult) }
}
