import { parse } from 'sucrase/dist/esm/parser/index.js'
import { TokenType as tt } from 'sucrase/dist/esm/parser/tokenizer/types.js'
import { extractRootJsx, findBareRootJsxStart } from './bare-source'
import { applyComponentControls, type ComponentControl, type ComponentControlValues } from './component-controls'
import { componentControlSpecs, controlLabel, numberRange, tones } from './component-control-specs'
import { structuredControlKind, validateSceneJson, validateStructuredSceneValue, type SceneJsonValue, type StructuredSceneControl } from './playground-data'

export interface SceneInstance {
    id: string
    name: string
    start: number
    end: number
    openingEnd: number
    closingStart: number | null
    selfClosing: boolean
    depth: number
    parentID: string | null
    controls: ComponentControl[]
    structuredControls: StructuredSceneControl[]
    attributes: SceneAttribute[]
    canDuplicate: boolean
    canRemove: boolean
    canMoveUp: boolean
    canMoveDown: boolean
    unsafeReason?: string
}

export interface SceneSnapshot {
    source: string
    snapshotID: number
    rootID: string
    instances: SceneInstance[]
}

export interface SceneAttribute {
    prop: string
    start: number
    end: number
    value?: SceneJsonValue
    editable: boolean
}

const containers = new Set(['Scene', 'Canvas', 'Board', 'Row', 'Column', 'Stack', 'Fragment', 'React.Fragment'])
let snapshotSequence = 0

function decodeEntities(value: string): string {
    const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
    return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
        if (!name.startsWith('#')) return names[name] ?? entity
        const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    })
}

function decodeString(raw: string): string | undefined {
    let value = ''
    for (let i = 1; i < raw.length - 1; i += 1) {
        if (raw[i] !== '\\') { value += raw[i]; continue }
        const escape = raw[++i]
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' }
        if (escape === '\n') continue
        if (escape === '\r') { if (raw[i + 1] === '\n') i += 1; continue }
        if (escape === 'x' || escape === 'u') {
            const rest = raw.slice(i + 1)
            const match = escape === 'x' ? rest.match(/^[\da-f]{2}/i) : rest.match(/^(?:[\da-f]{4}|\{[\da-f]+\})/i)
            if (!match) return
            const code = parseInt(match[0].replace(/[{}]/g, ''), 16)
            if (code > 0x10ffff) return
            value += String.fromCodePoint(code)
            i += match[0].length
        } else if (/\d/.test(escape)) {
            if (escape !== '0' || /\d/.test(raw[i + 1] ?? '')) return
            value += '\0'
        } else value += simple[escape] ?? escape
    }
    return value
}

function controlsFor(name: string, attributes: SceneAttribute[]): ComponentControl[] {
    const spec = componentControlSpecs[name]
    if (!spec) return []
    const controls: ComponentControl[] = []
    for (const attribute of attributes) {
        const { prop, start, end, value } = attribute
        if (!attribute.editable || attributes.filter((entry) => entry.prop === prop).length !== 1 || value === undefined
            || value === null || typeof value === 'object') continue
        const base = { prop, label: controlLabel(prop), start, end, value }
        if (spec.text?.includes(prop) && typeof value === 'string') controls.push({ ...base, type: 'text' })
        else if (typeof value === 'string' && (prop === 'tone' && spec.tone || spec.selects?.[prop])) {
            const options = prop === 'tone' && spec.tone ? tones : spec.selects![prop]
            if (options.includes(value)) controls.push({ ...base, type: 'select', options: [...options] })
        } else if (spec.numbers?.includes(prop) && typeof value === 'number') {
            const range = numberRange(prop, name)
            if (Number.isFinite(value) && value >= range.min && value <= range.max) controls.push({ ...base, type: 'number', ...range })
        } else if (spec.booleans?.includes(prop) && typeof value === 'boolean') controls.push({ ...base, type: 'boolean' })
        if (controls.length >= 8) break
    }
    return controls
}

/** Reads JSX and literal props without compiling or evaluating the scene. */
export function analyzeScene(source: string): SceneSnapshot {
    const root = findBareRootJsxStart(source)
    if (root < 0) throw new Error('Use a single root JSX element to edit this scene visually.')
    const jsx = extractRootJsx(source.slice(root).trim().replace(/^export\s+default\s+/, ''))
    const jsxStart = source.indexOf(jsx, root)
    const prefix = source.slice(0, root)
    const parsedSource = `${prefix};\n(${jsx})`
    const offset = prefix.length + 3 - jsxStart
    const position = (value: number) => value < prefix.length ? value : value - offset
    const { tokens } = parse(parsedSource, true, true, false)
    const snapshotID = ++snapshotSequence
    const instances: SceneInstance[] = []
    const raw = (index: number) => parsedSource.slice(tokens[index].start, tokens[index].end)

    function literal(start: number, end: number): SceneJsonValue | undefined {
        let at = start
        function read(depth = 0): SceneJsonValue {
            if (depth > 12 || at >= end) throw new Error('Not a literal.')
            const token = tokens[at]
            const text = raw(at++)
            if (token.type === tt.string) {
                const decoded = decodeString(text)
                if (decoded === undefined) throw new Error('Not a literal string.')
                return decoded
            }
            if (token.type === tt.num) {
                const value = Number(text.replaceAll('_', ''))
                if (!Number.isFinite(value)) throw new Error('Not a finite number.')
                return value
            }
            if ((text === '+' || text === '-') && tokens[at]?.type === tt.num) {
                const value = Number(text + raw(at++).replaceAll('_', ''))
                if (!Number.isFinite(value)) throw new Error('Not a finite number.')
                return value
            }
            if (text === 'null') return null
            if (text === 'true' || text === 'false') return text === 'true'
            if (token.type === tt.bracketL) {
                const result: SceneJsonValue[] = []
                while (at < end && tokens[at].type !== tt.bracketR) {
                    result.push(read(depth + 1))
                    if (tokens[at].type !== tt.comma) break
                    at += 1
                }
                if (tokens[at++]?.type !== tt.bracketR) throw new Error('Not a literal array.')
                return result
            }
            if (token.type === tt.braceL) {
                const result: { [key: string]: SceneJsonValue } = Object.create(null)
                while (at < end && tokens[at].type !== tt.braceR) {
                    const keyToken = tokens[at]
                    const key = keyToken.type === tt.string ? decodeString(raw(at)) : raw(at)
                    if (key === undefined || ![tt.name, tt.string, tt.num].includes(keyToken.type)
                        || ['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) throw new Error('Not a plain literal object.')
                    at += 1
                    if (tokens[at++]?.type !== tt.colon) throw new Error('Not a literal property.')
                    result[key] = read(depth + 1)
                    if (tokens[at].type !== tt.comma) break
                    at += 1
                }
                if (tokens[at++]?.type !== tt.braceR) throw new Error('Not a literal object.')
                return result
            }
            throw new Error('Computed data stays in the TSX.')
        }
        try { const value = read(); return at === end ? value : undefined } catch { return }
    }

    function expression(index: number, parent: SceneInstance, unsafe: boolean): number {
        let depth = 1
        for (let i = index + 1; i < tokens.length; i += 1) {
            if (tokens[i].type === tt.jsxTagStart) i = element(i, parent, unsafe) - 1
            else if (tokens[i].type === tt.braceL) depth += 1
            else if (tokens[i].type === tt.braceR && --depth === 0) return i
        }
        throw new Error('Unclosed JSX expression.')
    }

    function element(index: number, parent: SceneInstance | null, unsafe: boolean): number {
        const start = position(tokens[index].start)
        const instance: SceneInstance = {
            id: `${snapshotID}:${start}`, name: '', start, end: start, openingEnd: start,
            closingStart: null, selfClosing: false, depth: parent ? parent.depth + 1 : 0, parentID: parent?.id ?? null,
            controls: [], structuredControls: [], attributes: [], canDuplicate: false, canRemove: false, canMoveUp: false, canMoveDown: false,
        }
        if (unsafe) instance.unsafeReason = 'Edit expression-generated components in the TSX source.'
        instances.push(instance)
        let i = index + 1
        if (tokens[i].type === tt.jsxTagEnd) instance.name = 'Fragment'
        else {
            instance.name = raw(i++)
            while (tokens[i].type === tt.dot || tokens[i].type === tt.colon) {
                instance.name += raw(i++) + raw(i++)
            }
        }
        const attributes: SceneAttribute[] = []
        while (i < tokens.length && tokens[i].type !== tt.jsxTagEnd) {
            if (tokens[i].type === tt.braceL) {
                // A spread can override preceding attributes, so only later literals are controls.
                attributes.forEach((attribute) => { attribute.editable = false })
                i = expression(i, instance, true) + 1
                continue
            }
            if (tokens[i].type !== tt.jsxName) { i += 1; continue }
            const attribute: SceneAttribute = { prop: raw(i), start: position(tokens[i].start), end: position(tokens[i].end), value: true, editable: true }
            i += 1
            if (tokens[i].type === tt.eq) {
                i += 1
                attribute.value = undefined
                if (tokens[i].type === tt.string) {
                    attribute.value = decodeEntities(raw(i).slice(1, -1).replace(/\n\s+/g, ' '))
                    attribute.end = position(tokens[i++].end)
                } else if (tokens[i].type === tt.braceL) {
                    const end = expression(i, instance, true)
                    attribute.value = literal(i + 1, end)
                    attribute.end = position(tokens[end].end)
                    i = end + 1
                }
            }
            attributes.push(attribute)
        }
        instance.controls = controlsFor(instance.name, attributes)
        instance.attributes = attributes
        instance.structuredControls = attributes.flatMap((attribute) => {
            const kind = structuredControlKind(instance.name, attribute.prop)
            if (!kind || !attribute.editable || attribute.value === undefined
                || attributes.filter((entry) => entry.prop === attribute.prop).length !== 1) return []
            return [{ prop: attribute.prop, label: controlLabel(attribute.prop), kind, value: attribute.value, start: attribute.start, end: attribute.end }]
        })
        instance.openingEnd = position(tokens[i].end)
        instance.selfClosing = tokens[i - 1]?.type === tt.slash
        if (instance.selfClosing) {
            instance.end = instance.openingEnd
            return i + 1
        }
        for (i += 1; i < tokens.length; i += 1) {
            if (tokens[i].type === tt.braceL) i = expression(i, instance, true)
            else if (tokens[i].type === tt.jsxTagStart) {
                if (tokens[i + 1].type === tt.slash) {
                    instance.closingStart = position(tokens[i].start)
                    while (tokens[i].type !== tt.jsxTagEnd) i += 1
                    instance.end = position(tokens[i].end)
                    return i + 1
                }
                i = element(i, instance, unsafe) - 1
            }
        }
        throw new Error('Unclosed JSX element.')
    }

    for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i].type === tt.jsxTagStart) i = element(i, null, position(tokens[i].start) !== jsxStart) - 1
    }
    const rootInstance = instances.find((instance) => instance.start === jsxStart)
    if (!rootInstance) throw new Error('Could not find the root JSX element.')
    for (const instance of instances) {
        const parent = instances.find((entry) => entry.id === instance.parentID)
        const direct = Boolean(parent && !instance.unsafeReason && !parent.unsafeReason)
        instance.canDuplicate = direct
        instance.canRemove = direct
        const siblings = instances.filter((entry) => entry.parentID === instance.parentID && !entry.unsafeReason)
        const index = siblings.indexOf(instance)
        instance.canMoveUp = direct && index > 0 && onlyWhitespace(source.slice(siblings[index - 1].end, instance.start))
        instance.canMoveDown = direct && index < siblings.length - 1 && onlyWhitespace(source.slice(instance.end, siblings[index + 1].start))
    }
    return { source, snapshotID, rootID: rootInstance.id, instances }
}

function onlyWhitespace(source: string): boolean { return /^\s*$/.test(source) }

function currentInstance(source: string, snapshot: SceneSnapshot, id: string): SceneInstance {
    if (source !== snapshot.source) throw new Error('The scene changed. Refresh its controls before editing.')
    const instance = snapshot.instances.find((entry) => entry.id === id)
    if (!instance) throw new Error('This component is not part of the current scene snapshot.')
    return instance
}

export function updateSceneControls(source: string, snapshot: SceneSnapshot, id: string, values: ComponentControlValues): string {
    return applyComponentControls(source, currentInstance(source, snapshot, id).controls, values)
}

/** Patches literal props and adds missing props without replacing computed or overridden values. */
export function setSceneLiteralProps(source: string, snapshot: SceneSnapshot, id: string, values: Record<string, SceneJsonValue>): string {
    const instance = currentInstance(source, snapshot, id)
    if (instance.name === 'Fragment') throw new Error('Select a named component to edit its properties.')
    const related = Object.fromEntries(instance.attributes.filter((attribute) => attribute.editable && attribute.value !== undefined)
        .map((attribute) => [attribute.prop, attribute.value!]))
    Object.assign(related, values)
    const replacements: Array<{ start: number; end: number; text: string }> = []
    const added: string[] = []
    for (const [prop, value] of Object.entries(values)) {
        if (!/^[A-Za-z_$][\w$]*$/.test(prop) || ['__proto__', 'constructor', 'prototype', 'children', 'dangerouslySetInnerHTML', 'ref', 'key'].includes(prop)) throw new Error(`Cannot edit the property "${prop}" in the builder.`)
        validateSceneJson(value)
        if (structuredControlKind(instance.name, prop)) validateStructuredSceneValue(instance.name, prop, value, related)
        else if (value !== null && typeof value === 'object') throw new Error(`Use the TSX source to edit ${instance.name}.${prop}.`)
        const attributes = instance.attributes.filter((attribute) => attribute.prop === prop)
        if (attributes.length > 1) throw new Error(`The property "${prop}" appears more than once. Resolve it in the TSX source.`)
        const attribute = attributes[0]
        if (attribute && (!attribute.editable || attribute.value === undefined)) throw new Error(`The property "${prop}" is computed or overridden by a spread. Edit it in the TSX source.`)
        const text = `${prop}={${JSON.stringify(value)}}`
        if (attribute) replacements.push({ start: attribute.start, end: attribute.end, text })
        else added.push(text)
    }
    if (added.length) {
        const opening = source.slice(instance.start, instance.openingEnd)
        const closing = instance.selfClosing ? opening.match(/\/\s*>$/)?.[0].length : 1
        if (!closing) throw new Error('The opening tag changed. Refresh the scene before editing.')
        const at = instance.openingEnd - closing
        replacements.push({ start: at, end: at, text: ' ' + added.join(' ') + ' ' })
    }
    replacements.sort((left, right) => right.start - left.start)
    let result = source
    for (const replacement of replacements) result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
    return result
}

export function updateStructuredSceneProp(source: string, snapshot: SceneSnapshot, id: string, prop: string, value: SceneJsonValue): string {
    const instance = currentInstance(source, snapshot, id)
    if (!instance.structuredControls.some((control) => control.prop === prop)) throw new Error(`The ${prop} data is computed or unavailable. Edit it in the TSX source.`)
    return setSceneLiteralProps(source, snapshot, id, { [prop]: value })
}

/** Treats a Board item as one visual when its nested content is selected. */
export function sceneStructuralTarget(source: string, snapshot: SceneSnapshot, id: string): SceneInstance {
    const selected = currentInstance(source, snapshot, id)
    let instance: SceneInstance | undefined = selected
    while (instance) {
        const parent = snapshot.instances.find((entry) => entry.id === instance!.parentID)
        if (instance.name === 'CanvasItem' && parent?.name === 'Board') return instance
        instance = parent
    }
    return selected
}

function structuralInstance(source: string, snapshot: SceneSnapshot, id: string): SceneInstance {
    const instance = sceneStructuralTarget(source, snapshot, id)
    if (instance.unsafeReason) throw new Error(instance.unsafeReason)
    if (!instance.parentID) throw new Error('Keep the root component. Add components to its scene instead.')
    return instance
}

function indentAt(source: string, at: number): string {
    const line = source.slice(source.lastIndexOf('\n', at - 1) + 1, at)
    return line.match(/^\s*/)?.[0] ?? ''
}

export function duplicateSceneInstance(source: string, snapshot: SceneSnapshot, id: string): string {
    const instance = structuralInstance(source, snapshot, id)
    const snippet = source.slice(instance.start, instance.end)
    return source.slice(0, instance.end) + '\n' + indentAt(source, instance.start) + snippet + source.slice(instance.end)
}

export function removeSceneInstance(source: string, snapshot: SceneSnapshot, id: string): string {
    const instance = structuralInstance(source, snapshot, id)
    return source.slice(0, instance.start) + source.slice(instance.end)
}

export function moveSceneInstance(source: string, snapshot: SceneSnapshot, id: string, direction: 'up' | 'down'): string {
    const instance = structuralInstance(source, snapshot, id)
    if (direction !== 'up' && direction !== 'down') throw new Error('Choose up or down to reorder a component.')
    const siblings = snapshot.instances.filter((entry) => entry.parentID === instance.parentID && !entry.unsafeReason)
    const target = siblings[siblings.indexOf(instance) + (direction === 'up' ? -1 : 1)]
    if (!target) throw new Error('This component is already at the end of its group.')
    const [first, second] = target.start < instance.start ? [target, instance] : [instance, target]
    const gap = source.slice(first.end, second.start)
    if (!onlyWhitespace(gap)) throw new Error('Reorder components around expressions or comments in the TSX source.')
    return source.slice(0, first.start) + source.slice(second.start, second.end) + gap + source.slice(first.start, first.end) + source.slice(second.end)
}

/** Adds the selected catalog component without copying its canvas metadata or setup code. */
export function appendSceneComponent(source: string, snapshot: SceneSnapshot, exampleSource: string, componentName: string, targetID?: string): string {
    const root = currentInstance(source, snapshot, snapshot.rootID)
    const example = analyzeScene(exampleSource)
    let component = example.instances.find((entry) => entry.name === componentName)
    if (!component && /^[A-Za-z_$][\w$]*$/.test(componentName)) {
        // Some catalog helpers return text or positioned elements instead of JSX components.
        const call = new RegExp(`\\b${componentName}\\s*\\(`)
        component = example.instances.find((entry) => !entry.unsafeReason && entry.parentID === example.rootID
            && call.test(exampleSource.slice(entry.start, entry.end)))
    }
    while (component?.unsafeReason && component.parentID) {
        component = example.instances.find((entry) => entry.id === component!.parentID)
    }
    if (!component || component.unsafeReason) throw new Error('This example requires TSX source editing to add it to a scene.')
    // Drawing primitives require their native SVG coordinate space.
    for (let parent = example.instances.find((entry) => entry.id === component!.parentID); parent; parent = example.instances.find((entry) => entry.id === parent!.parentID)) {
        if (parent.name === 'svg') component = parent
    }
    let snippet = exampleSource.slice(component.start, component.end)
    const target = targetID ? currentInstance(source, snapshot, targetID) : root
    if (target.unsafeReason) throw new Error(target.unsafeReason)
    if (target.name === 'Board' && component.name !== 'CanvasItem') {
        const dimensions = Object.fromEntries(component.attributes.map((attribute) => [attribute.prop, attribute.value]))
        const width = typeof dimensions.width === 'number' ? dimensions.width : 320
        const height = typeof dimensions.height === 'number' ? dimensions.height : 220
        const count = snapshot.instances.filter((entry) => entry.name === 'CanvasItem' && entry.parentID === target.id).length
        const offset = 40 + (count % 8) * 24
        snippet = `<CanvasItem x={${offset}} y={${offset}} width={${width}} height={${height}}>\n${indentAt(source, target.start)}    ${snippet}\n${indentAt(source, target.start)}  </CanvasItem>`
    }
    if (containers.has(target.name)) {
        const indent = indentAt(source, target.start)
        const added = indent + '  ' + snippet
        if (target.selfClosing) {
            const opening = source.slice(target.start, target.end).replace(/\/\s*>$/, '>')
            const closing = target.name === 'Fragment' ? '</>' : `</${target.name}>`
            return source.slice(0, target.start) + opening + '\n' + added + '\n' + indent + closing + source.slice(target.end)
        }
        const at = target.closingStart!
        const before = source.slice(0, at)
        const trailingIndent = before.match(/(?:\n|^)\s*$/)?.[0] ?? ''
        const insertion = at - trailingIndent.length
        return source.slice(0, insertion) + '\n' + added + '\n' + indent + source.slice(at)
    }
    if (target.id !== root.id) throw new Error('Select a Scene, Canvas, Row, Column, or Stack to add a component.')
    const indent = indentAt(source, root.start)
    return source.slice(0, root.start) + '<Scene gap={18}>\n'
        + indent + '  ' + source.slice(root.start, root.end) + '\n'
        + indent + '  ' + snippet + '\n' + indent + '</Scene>' + source.slice(root.end)
}
