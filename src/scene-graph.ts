import { SCENE_COMPONENT_NAMES, SCENE_DOM_TAGS } from './scene-components'
import { isUnsafeSceneKey, SCENE_LIMITS, type SceneElement, type SceneJson } from './scene-contract'
import { validateSceneComponentProps } from './scene-prop-limits'

const componentNames = new Set<string>(SCENE_COMPONENT_NAMES)
const domTags = new Set<string>(SCENE_DOM_TAGS)
const localReference = /^#[A-Za-z_][\w:.-]*$/
const localPaint = /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/
const resourceKeys = /^(?:background(?:image)?|fill|stroke|filter|clippath|mask(?:image)?|borderimage(?:source)?|liststyle(?:image)?|cursor|content)$/i

function validateResource(value: string, key: string, inStyle: boolean): void {
    if (/^(?:src|href|xlinkhref|xlink:href|srcset|poster|action|formaction)$/i.test(key) && !localReference.test(value)) {
        throw new Error('Scene resource references must be local SVG fragment IDs. External assets are disabled.')
    }
    if ((inStyle || resourceKeys.test(key) || /gradient$/i.test(key)) && (/\\|\/\*/.test(value)
        || /(?:https?|file|ftp|data|blob|javascript):|\/\//i.test(value)
        || /url\s*\(/i.test(value) && !localPaint.test(value))) {
        throw new Error('Scene CSS cannot load external resources or escaped resource expressions.')
    }
}

/** Components may map aliases such as `gradient` or `color` into CSS/SVG props. */
export function validateResolvedSceneResources(props: Record<string, unknown>): void {
    let values = 0
    const visit = (input: unknown, key: string, style: boolean, depth: number): void => {
        if (++values > 32_000 || depth > SCENE_LIMITS.depth * 2) throw new Error('Resolved scene props exceed their value budget.')
        if (typeof input === 'string') { validateResource(input, key, style); return }
        if (Array.isArray(input)) { input.forEach((item) => visit(item, key, style, depth + 1)); return }
        if (input && typeof input === 'object') {
            for (const [property, value] of Object.entries(input)) {
                if (property === 'children') continue
                if (property === 'dangerouslySetInnerHTML' || property === '__html') throw new Error('Resolved scene cannot contain raw HTML.')
                visit(value, property, style || /style$/i.test(property), depth + 1)
            }
        }
    }
    visit(props, '', false, 0)
}

/** Validate after the VM boundary as well as inside it. Nothing executable crosses it. */
export function validateSceneGraph(value: unknown): SceneJson {
    let nodes = 0
    const visit = (input: unknown, depth: number, key = '', inStyle = false): SceneJson => {
        if (depth > SCENE_LIMITS.depth) throw new Error(`Scene graph exceeds depth ${SCENE_LIMITS.depth}.`)
        if (++nodes > SCENE_LIMITS.nodes * 32) throw new Error('Scene graph contains too many values.')
        if (input === null || typeof input === 'boolean') return input
        if (typeof input === 'number') {
            if (!Number.isFinite(input) || Math.abs(input) > 1_000_000_000) throw new Error('Scene numbers must be finite and bounded.')
            return input
        }
        if (typeof input === 'string') {
            if (input.length > SCENE_LIMITS.stringLength) throw new Error('Scene string exceeds its length limit.')
            validateResource(input, key, inStyle)
            return input
        }
        if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1, key, inStyle))
        if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype
            && Object.getPrototypeOf(input) !== null) throw new Error('Scene props must be plain JSON values.')
        const record = input as Record<string, unknown>
        const output: Record<string, SceneJson> = Object.create(null)
        for (const [property, item] of Object.entries(record)) {
            if (isUnsafeSceneKey(property) || /^on/i.test(property) || /^(?:xml:base|xmlBase)$/i.test(property) || property === 'dangerouslySetInnerHTML'
                || property === 'ref' || property === '__html') throw new Error(`Scene property ${JSON.stringify(property)} is not allowed.`)
            output[property] = visit(item, depth + 1, property, inStyle || /style$/i.test(property))
        }
        if (record.kind === 'vizmatic.element') {
            if (typeof record.type !== 'string' || !componentNames.has(record.type) && !domTags.has(record.type)) {
                throw new Error(`Scene component ${JSON.stringify(record.type)} is not supported.`)
            }
            if (!record.props || typeof record.props !== 'object' || Array.isArray(record.props)
                || !Array.isArray(record.children)
                || Object.keys(record).some((name) => !['kind', 'type', 'props', 'children'].includes(name))) {
                throw new Error('Invalid scene element.')
            }
            if (componentNames.has(record.type)) validateSceneComponentProps(record.type, output.props as Record<string, SceneJson>)
        }
        return output
    }
    const graph = visit(value, 0)
    let elementCount = 0
    const checkChildren = (child: SceneJson): void => {
        if (Array.isArray(child)) { child.forEach(checkChildren); return }
        if (child === null || typeof child !== 'object') return
        if (child.kind !== 'vizmatic.element') throw new Error('Scene children must be JSX elements, text or numbers.')
        if (++elementCount > SCENE_LIMITS.nodes) throw new Error(`Scene graph exceeds ${SCENE_LIMITS.nodes} elements.`)
        const element = child as unknown as SceneElement
        element.children.forEach(checkChildren)
        // Elements supplied through props such as icons are also rendered later.
        const checkProps = (prop: SceneJson): void => {
            if (Array.isArray(prop)) { prop.forEach(checkProps); return }
            if (prop && typeof prop === 'object') {
                if (prop.kind === 'vizmatic.element') checkChildren(prop)
                else Object.values(prop).forEach(checkProps)
            }
        }
        Object.values(element.props).forEach(checkProps)
    }
    checkChildren(graph)
    return graph
}
