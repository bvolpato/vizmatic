import React, { isValidElement, type ReactNode } from 'react'
import { parse } from 'sucrase/dist/esm/parser/index.js'
import { TokenType as tt } from 'sucrase/dist/esm/parser/tokenizer/types.js'
import type { SatoriNode } from 'satori/standalone'
import { extractRootJsx, findBareRootJsxStart } from './bare-source'
import type { PlaygroundTextSource, PlaygroundTextTarget } from './playground-text-types'
import { CANVAS_ITEM_COMPONENT } from './primitives/board'
import type { PlaygroundCanvasItemTarget } from './playground-builder-types'
import { analyzeScene } from './playground-scene'
import { structuredControlKind } from './playground-data'

const SCOPE_PROP = '__vizmaticTextScope'
const TEXT_FIELDS = new Set(['title', 'subtitle', 'label', 'text', 'value', 'detail', 'description', 'caption', 'name', 'note', 'formula', 'legend', 'header', 'footer', 'valueLabel', 'eyebrow', 'code'])

export interface PlaygroundTextMapping {
    source: string
    scopes: Map<number, PlaygroundTextSource[]>
    elements: Map<number, { start: number; end: number; name: string }>
    canvasScopes: Set<number>
}

function decodeEntities(value: string): string {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
    return value.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, name: string) => {
        if (!name.startsWith('#')) return named[name] ?? entity
        const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    })
}

function decodeString(raw: string): string | undefined {
    let value = ''
    for (let i = 1; i < raw.length - 1; i += 1) {
        if (raw[i] !== '\\') { value += raw[i]; continue }
        const escape = raw[++i]
        const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' }
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

function decodeJsxText(raw: string): string {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n')
    return decodeEntities(lines.map((line, index) => {
        let value = line.replace(/\t/g, ' ')
        if (index > 0) value = value.trimStart()
        if (index < lines.length - 1) value = value.trimEnd()
        return value
    }).filter(Boolean).join(' '))
}

// Sucrase is pinned in package.json. Keep its token API confined to this worker-only module.
export function mapPlaygroundText(source: string): PlaygroundTextMapping {
    const scene = analyzeScene(source)
    const blockedTextRanges: Array<{ start: number; end: number }> = []
    for (const instance of scene.instances) {
        if (instance.unsafeReason) blockedTextRanges.push({ start: instance.start, end: instance.end })
        const attributesByProp = new Map<string, typeof instance.attributes>()
        for (const attribute of instance.attributes) {
            const related = attributesByProp.get(attribute.prop) ?? []
            related.push(attribute)
            attributesByProp.set(attribute.prop, related)
        }
        for (const attributes of attributesByProp.values()) {
            for (const attribute of attributes) {
                const spreadCanOverride = !attribute.editable && attribute.readOnlyReason?.includes('spread')
                const computedNonDataProp = !attribute.editable && !structuredControlKind(instance.name, attribute.prop)
                if (attributes.length > 1 || spreadCanOverride || computedNonDataProp) {
                    blockedTextRanges.push({ start: attribute.start, end: attribute.end })
                }
            }
        }
    }
    const editableCanvasStarts = new Set(scene.instances.filter((instance) => {
        if (instance.name !== 'CanvasItem' || instance.unsafeReason) return false
        return ['x', 'y', 'width', 'height'].every((prop) => {
            const attributes = instance.attributes.filter((attribute) => attribute.prop === prop)
            if (!attributes.length) return prop === 'width' || prop === 'height'
            return attributes.length === 1 && attributes[0].editable && typeof attributes[0].value === 'number'
        })
    }).map((instance) => instance.start))
    const root = findBareRootJsxStart(source)
    const jsx = extractRootJsx(source.slice(root).trim().replace(/^export\s+default\s+/, ''))
    const jsxStart = source.indexOf(jsx, root)
    const prefix = source.slice(0, root)
    const parsedSource = `${prefix};\n(${jsx})`
    const offset = prefix.length + 3 - jsxStart
    const originalOffset = (position: number) => position < prefix.length ? position : position - offset
    const { tokens } = parse(parsedSource, true, true, false)
    for (let i = 1; i < tokens.length; i += 1) {
        // Strings inside a JSX spread are values from an ambiguous props source.
        // Literal attributes that a later spread can override are covered by
        // SceneAttribute.editable above; this covers literals inside the spread.
        if (tokens[i].type !== tt.ellipsis || tokens[i - 1]?.type !== tt.braceL) continue
        let depth = 1
        for (let end = i + 1; end < tokens.length; end += 1) {
            if (tokens[end].type === tt.braceL) depth += 1
            else if (tokens[end].type === tt.braceR && --depth === 0) {
                blockedTextRanges.push({ start: originalOffset(tokens[i - 1].start), end: originalOffset(tokens[end].end) })
                break
            }
        }
    }
    const scopes = new Map<number, PlaygroundTextSource[]>()
    const elementSources: PlaygroundTextMapping['elements'] = new Map()
    const canvasScopes = new Set<number>()
    const insertions: Array<{ at: number; value: string }> = []
    const elements: number[] = []
    const heads: Array<{ id: number; closing: boolean; fragment: boolean }> = []
    let nextId = 0
    const raw = (index: number) => tokens[index] ? parsedSource.slice(tokens[index].start, tokens[index].end) : ''

    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]
        if (token.type === tt.jsxTagStart) {
            const closing = tokens[i + 1]?.type === tt.slash
            const nameStart = i + (closing ? 2 : 1)
            const fragment = tokens[nameStart]?.type === tt.jsxTagEnd
            const id = closing ? elements.at(-1) ?? -1 : fragment ? heads.at(-1)?.id ?? elements.at(-1) ?? ++nextId : ++nextId
            heads.push({ id, closing, fragment })
            if (!closing) {
                if (!scopes.has(id)) scopes.set(id, [])
                if (!fragment) {
                    let end = nameStart
                    while (tokens[end + 1]?.type === tt.dot || (tokens[end]?.type === tt.dot && tokens[end + 1]?.type === tt.jsxName)) end += 1
                    elementSources.set(id, { start: originalOffset(token.start), end: originalOffset(tokens[end].end), name: parsedSource.slice(tokens[nameStart].start, tokens[end].end) })
                    if (editableCanvasStarts.has(originalOffset(token.start))) canvasScopes.add(id)
                    insertions.push({ at: originalOffset(tokens[end].end), value: ` ${SCOPE_PROP}={${id}}` })
                }
            }
            continue
        }
        if (token.type === tt.jsxTagEnd) {
            const head = heads.pop()
            if (!head) continue
            if (!head.fragment && (head.closing || tokens[i - 1]?.type === tt.slash)) {
                const element = elementSources.get(head.id)
                if (element) element.end = originalOffset(token.end)
            }
            if (head.closing) elements.pop()
            else if (tokens[i - 1]?.type !== tt.slash) elements.push(head.id)
            continue
        }
        const head = heads.at(-1)
        const scope = head && !head.closing ? head.id : elements.at(-1)
        if (scope === undefined) continue
        let kind: PlaygroundTextSource['kind'] = 'string'
        let value: string | undefined
        if (token.type === tt.jsxText) {
            kind = 'jsx-text'
            value = decodeJsxText(raw(i))
        } else if (token.type === tt.string && !token.isType) {
            const previous = tokens[i - 1]
            const next = tokens[i + 1]
            if (previous?.type === tt.eq && tokens[i - 2]?.type === tt.jsxName && TEXT_FIELDS.has(raw(i - 2))) {
                kind = 'jsx-attribute'
                value = decodeEntities(raw(i).slice(1, -1).replace(/\n\s+/g, ' '))
            } else {
                const property = previous?.type === tt.colon && TEXT_FIELDS.has(raw(i - 2))
                const expressionProp = previous?.type === tt.braceL && tokens[i - 2]?.type === tt.eq && TEXT_FIELDS.has(raw(i - 3))
                const child = previous?.type === tt.braceL && !head && scope !== undefined
                const arrayValue = scope !== undefined && [tt.bracketL, tt.comma].includes(previous?.type)
                const standalone = [tt.braceR, tt.comma, tt.bracketR].includes(next?.type)
                if ((property || expressionProp || child || arrayValue) && standalone) value = decodeString(raw(i))
            }
        }
        if (value === undefined || !value.trim()) continue
        const start = originalOffset(token.start)
        const end = originalOffset(token.end)
        if (blockedTextRanges.some((range) => start >= range.start && end <= range.end)) continue
        const reference = { start, end, original: source.slice(start, end), value, kind }
        scopes.get(scope)?.push(reference)
    }
    let instrumented = source
    for (const insertion of insertions.sort((a, b) => b.at - a.at)) {
        instrumented = instrumented.slice(0, insertion.at) + insertion.value + instrumented.slice(insertion.at)
    }
    return { source: instrumented, scopes, elements: elementSources, canvasScopes }
}

export function prepareEditableText(element: ReactNode, mapping: PlaygroundTextMapping): { element: ReactNode; references: Map<string, PlaygroundTextSource>; canvasItems: Map<string, { sourceStart: number; sourceEnd: number; x: number; y: number }> } {
    const references = new Map<string, PlaygroundTextSource>()
    const canvasItems = new Map<string, { sourceStart: number; sourceEnd: number; x: number; y: number }>()
    const scopeReferences = new Map(mapping.scopes)
    let nextKey = 0
    const visit = (node: ReactNode, scope?: number): ReactNode => {
        if (Array.isArray(node)) return node.map((child) => visit(child, scope))
        if (!isValidElement<Record<string, unknown>>(node)) return node
        const { [SCOPE_PROP]: ownScope, ...props } = node.props
        const activeScope = typeof ownScope === 'number' ? ownScope : scope
        if (typeof ownScope === 'number') {
            const counts = new Map<string, number>()
            const countText = (value: unknown, field: string) => {
                if (isValidElement(value)) return
                if (typeof value === 'string' && (TEXT_FIELDS.has(field) || field === 'children')) counts.set(value, (counts.get(value) ?? 0) + 1)
                else if (Array.isArray(value)) value.forEach((entry) => countText(entry, field))
                else if (value && typeof value === 'object' && !['c', 'style'].includes(field)) Object.entries(value).forEach(([key, entry]) => countText(entry, key))
            }
            Object.entries(props).forEach(([field, value]) => countText(value, field))
            const local = mapping.scopes.get(ownScope) ?? []
            scopeReferences.set(ownScope, local.filter((reference) => (counts.get(reference.value) ?? 1) <= local.filter((entry) => entry.value === reference.value).length))
        }
        const children = props.children as ReactNode
        if (node.type === React.Fragment) return visit(children, activeScope)
        if (typeof node.type === 'function') {
            const resolved = visit((node.type as (props: Record<string, unknown>) => ReactNode)(props), activeScope)
            const sourceElement = typeof ownScope === 'number' ? mapping.elements.get(ownScope) : undefined
            if (sourceElement && mapping.canvasScopes.has(ownScope as number) && (node.type as unknown as Record<symbol, unknown>)[CANVAS_ITEM_COMPONENT]
                && typeof props.x === 'number' && typeof props.y === 'number' && isValidElement(resolved)) {
                const itemKey = `vizmatic-canvas-item-${ownScope}`
                canvasItems.set(itemKey, { sourceStart: sourceElement.start, sourceEnd: sourceElement.end, x: props.x, y: props.y })
                return React.cloneElement(resolved, { key: itemKey })
            }
            return resolved
        }
        const resolvedChildren = visit(children, activeScope)
        const text = typeof resolvedChildren === 'string' ? resolvedChildren : Array.isArray(resolvedChildren) && resolvedChildren.length === 1 && typeof resolvedChildren[0] === 'string' ? resolvedChildren[0] : undefined
        let key = node.key
        if (text !== undefined) {
            const local = activeScope === undefined ? [] : scopeReferences.get(activeScope) ?? []
            const candidates = local.filter((reference) => reference.value === text)
            if (candidates.length === 1) {
                key = `vizmatic-edit-text-${++nextKey}`
                references.set(key, candidates[0])
            }
        }
        return React.createElement(node.type, { ...props, key }, resolvedChildren)
    }
    const resolved = visit(element)
    const counts = new Map<number, number>()
    references.forEach((reference) => counts.set(reference.start, (counts.get(reference.start) ?? 0) + 1))
    references.forEach((reference, key) => { if (counts.get(reference.start)! > 1) references.delete(key) })
    return { element: resolved, references, canvasItems }
}

export function editableCanvasItems(nodes: SatoriNode[], references: ReturnType<typeof prepareEditableText>['canvasItems']): PlaygroundCanvasItemTarget[] {
    const targets: PlaygroundCanvasItemTarget[] = []
    for (const node of nodes) {
        const item = references.get(String(node.key))
        if (item && node.width > 0 && node.height > 0) targets.push({ ...item, left: node.left, top: node.top, width: node.width, height: node.height })
    }
    return targets
}

export function editableTextTargets(nodes: SatoriNode[], references: Map<string, PlaygroundTextSource>): PlaygroundTextTarget[] {
    const targets: PlaygroundTextTarget[] = []
    for (const node of nodes) {
        const reference = references.get(String(node.key))
        if (!reference || node.width <= 0 || node.height <= 0) continue
        const style = node.props.style ?? {}
        targets.push({ ...reference, left: node.left, top: node.top, width: node.width, height: node.height, fontSize: Number(style.fontSize) || 16, color: typeof style.color === 'string' ? style.color : '' })
    }
    return targets
}
