export type SceneJsonValue = string | number | boolean | null | SceneJsonValue[] | { [key: string]: SceneJsonValue }
export type StructuredControlKind = 'values' | 'points' | 'rows' | 'json'

export interface StructuredSceneControl {
    prop: string
    label: string
    kind: StructuredControlKind
    value?: SceneJsonValue
    start: number
    end: number
    required?: boolean
    initialValue?: SceneJsonValue
}

const structuredSpecs: Record<string, Record<string, StructuredControlKind>> = {
    PieChart: { segments: 'values' }, DonutChart: { segments: 'values' }, StackedBar: { segments: 'values' },
    BarChart: { data: 'values' }, ParetoBarChart: { data: 'values' },
    ScatterPlot: { points: 'points' }, ParetoChart: { points: 'points' }, QuadrantChart: { points: 'points' },
    LineChart: { series: 'json', labels: 'json' }, IntervalPlot: { data: 'json' },
    DataTable: { rows: 'rows' },
    GraphDiagram: { nodes: 'json', edges: 'json', groups: 'json' },
}

export function structuredControlKind(component: string, prop: string): StructuredControlKind | undefined {
    return structuredSpecs[component]?.[prop]
}

function record(value: SceneJsonValue, at: string): { [key: string]: SceneJsonValue } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object.`)
    return value
}

function text(value: SceneJsonValue | undefined, at: string, optional = false): void {
    if (optional && value === undefined) return
    if (typeof value !== 'string') throw new Error(`${at} must be text.`)
}

function number(value: SceneJsonValue | undefined, at: string, optional = false): void {
    if (optional && value === undefined) return
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${at} must be a finite number.`)
}

/** Rejects values that cannot be represented faithfully as safe JavaScript JSON literals. */
export function validateSceneJson(value: SceneJsonValue, depth = 0): void {
    if (depth > 12) throw new Error('Data may be nested at most 12 levels deep.')
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Data numbers must be finite.')
    if (typeof value === 'string' && value.length > 10_000) throw new Error('Keep individual data fields below 10,000 characters.')
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
    if (!value || typeof value !== 'object') throw new Error('Use JSON values: text, numbers, booleans, null, arrays, or objects.')
    if (Array.isArray(value)) {
        if (value.length > 1000) throw new Error('Data arrays may contain at most 1,000 items.')
        value.forEach((item) => validateSceneJson(item, depth + 1))
    } else {
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) throw new Error('Use plain JSON objects for data.')
        const entries = Object.entries(value)
        if (entries.length > 1000) throw new Error('Data objects may contain at most 1,000 properties.')
        for (const [key, item] of entries) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`The data key "${key}" is not supported.`)
            validateSceneJson(item, depth + 1)
        }
    }
}

/** Validates data shapes before a builder edit changes source or triggers rendering. */
export function validateStructuredSceneValue(component: string, prop: string, value: SceneJsonValue, related: Record<string, SceneJsonValue> = {}): void {
    validateSceneJson(value)
    const kind = structuredControlKind(component, prop)
    if (!kind) throw new Error(`No structured editor is available for ${component}.${prop}.`)
    if (!Array.isArray(value)) throw new Error(`${prop} must be a JSON array.`)
    if (value.length > (kind === 'json' ? 1000 : 200)) throw new Error(`${prop} contains too many rows for the builder.`)
    if (kind === 'values' || kind === 'points') {
        value.forEach((item, index) => {
            const at = `${prop} row ${index + 1}`
            const row = record(item, at)
            text(row.label, `${at} label`, kind === 'points')
            text(row.color, `${at} color`, true)
            if (kind === 'values') {
                number(row.value, `${at} value`)
                text(row.valueLabel, `${at} valueLabel`, true)
                if (['PieChart', 'ParetoBarChart'].includes(component) && (row.value as number) < 0) throw new Error(`${at} value must be non-negative.`)
            } else {
                number(row.x, `${at} x`)
                number(row.y, `${at} y`)
                number(row.size, `${at} size`, true)
                if (row.size !== undefined && (row.size as number) <= 0) throw new Error(`${at} size must be greater than zero.`)
            }
        })
    } else if (kind === 'rows') {
        value.forEach((row, index) => {
            if (!Array.isArray(row) || row.length > 50) throw new Error(`Table row ${index + 1} must be an array with at most 50 cells.`)
            if (row.some((cell) => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))) throw new Error(`Table row ${index + 1} cells must be text, numbers, booleans, or null.`)
        })
    } else if (component === 'LineChart') {
        if (prop === 'labels') value.forEach((label, index) => text(label, `Label ${index + 1}`))
        else value.forEach((item, index) => {
            const row = record(item, `Series ${index + 1}`)
            text(row.name, `Series ${index + 1} name`)
            if (!Array.isArray(row.points)) throw new Error(`Series ${index + 1} points must be an array of numbers.`)
            row.points.forEach((point, at) => number(point, `Series ${index + 1} point ${at + 1}`))
            text(row.color, `Series ${index + 1} color`, true)
            if (row.area !== undefined && typeof row.area !== 'boolean') throw new Error(`Series ${index + 1} area must be true or false.`)
        })
    } else if (component === 'IntervalPlot') {
        value.forEach((item, index) => {
            const row = record(item, `Interval ${index + 1}`)
            text(row.label, `Interval ${index + 1} label`)
            number(row.low, `Interval ${index + 1} low`)
            number(row.high, `Interval ${index + 1} high`)
            number(row.mid, `Interval ${index + 1} mid`)
            if ((row.low as number) > (row.high as number)) throw new Error(`Interval ${index + 1} low must not exceed high.`)
        })
    } else if (component === 'GraphDiagram') {
        const ids = new Set<string>()
        value.forEach((item, index) => {
            const at = `${prop} row ${index + 1}`
            const row = record(item, at)
            if (prop === 'edges') {
                text(row.from, `${at} from`)
                text(row.to, `${at} to`)
                text(row.label, `${at} label`, true)
            } else {
                text(row.id, `${at} id`)
                if (!(row.id as string).trim()) throw new Error(`${at} id must not be empty.`)
                if (ids.has(row.id as string)) throw new Error(`Duplicate ${prop} id "${row.id}".`)
                ids.add(row.id as string)
                if (typeof row.label !== 'string' && typeof row.label !== 'number') throw new Error(`${at} label must be text or a number.`)
                if (prop === 'nodes') {
                    for (const field of ['x', 'y', 'width', 'height']) number(row[field], `${at} ${field}`, true)
                    if ((row.x === undefined) !== (row.y === undefined)) throw new Error(`${at} must define both x and y, or omit both.`)
                }
            }
        })
        const nodes = prop === 'nodes' ? value : related.nodes
        const edges = prop === 'edges' ? value : related.edges
        if (Array.isArray(nodes) && Array.isArray(edges)) {
            const nodeIds = new Set(nodes.map((node) => record(node, 'Node').id))
            edges.forEach((edge, index) => {
                const row = record(edge, `Edge ${index + 1}`)
                if (!nodeIds.has(row.from) || !nodeIds.has(row.to)) throw new Error(`Edge ${index + 1} references a missing node. Update the edges before removing a node.`)
            })
        }
    }
}
