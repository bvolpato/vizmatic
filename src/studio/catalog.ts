/**
 * Everything that can go on stage, in one table. Each kind builds a real engine
 * node and writes the same thing as source code, side by side, so the live
 * canvas and the generated TSX cannot drift apart without a test noticing.
 */
import {
    arrayCells, arrow, axes, axes3d, barChart, bitField, brace, card, codeBlock, complexPlane, connector, curve3d, decimal, dot, dotChart, donut,
    ellipse, eventLog, graph, group, heatmap, histogram, infoBox, lanes, layerStack, line, lineChart, matrix, neuralNet, numberLine, passage,
    pictogram, PICTOGRAMS, pie, pipeline, plane, rect, regularPolygon, requestQueue, ringBuffer, scatter, scene3d, segmentedBar, sparkline, sphere,
    stateGrid, steps, surface, table, terminal, tex, text, tokens, tree, unitChart, vectorField, zone,
    type BitFieldPart, type ColorInput, type DotDatum, type GraphEdgeSpec, type GraphNodeSpec, type InfoRow, type LaneTimelineEvent,
    type LogRow, type Node, type PictogramName, type QueueItem, type ScatterPoint, type SegmentedBarPart, type ShapeStyle, type StackLayer,
    type Stage, type Step, type TableRow, type TerminalLine, type TreeSpec, type UnitGroup, type Value,
} from '../stage/index'
import { parseExpr } from './expr'
import type { ObjectProps, PropValue, StudioObject } from './model'

export type FieldType = 'number' | 'text' | 'longtext' | 'tex' | 'expr' | 'color' | 'select' | 'bool'

export interface Field {
    key: string
    label: string
    type: FieldType
    min?: number
    max?: number
    step?: number
    options?: readonly (readonly [string, string])[]
    /** Colors only: the value may be turned off. */
    nullable?: boolean
    /** Variable names allowed besides those listed in the project, such as x for a plot. */
    scope?: readonly string[]
    help?: string
}

export interface BuildContext {
    stage: Stage
    values: ReadonlyMap<string, Value>
}

export interface CodeContext {
    name: string
    /** Reserve a helper identifier in the generated film's scope. */
    identifier: (suffix: string) => string
    variables: readonly string[]
    /** JavaScript identifier for a project variable. */
    variableName: (variable: string) => string
}

export interface CodeResult {
    /** Statements that run before the object goes on stage. */
    setup?: string[]
    /** Statements that run after it does. */
    after?: string[]
    /** An expression that makes the node. A bare identifier when setup declared it. */
    expr: string
}

export interface KindDef {
    kind: string
    label: string
    group: string
    /** How the resize handles change this kind. */
    resize: { type: 'props'; keys: readonly string[] } | { type: 'scale' }
    /** Pick by outline instead of by bounding box, so large open shapes do not block what is under them. */
    pick: 'bounds' | 'shape'
    /** The object has its own staged entrance, reached with .enter(). */
    enters?: boolean
    /** Entrance suggested first in the picker. */
    entrance?: string
    defaults: ObjectProps
    fields: readonly Field[]
    build(props: ObjectProps, ctx: BuildContext): Node
    code(props: ObjectProps, ctx: CodeContext): CodeResult
}

/** One entry on the Add panel: a kind with a useful starting point. */
export interface PaletteEntry {
    id: string
    label: string
    kind: string
    group: string
    /** Single key that adds this entry, if any. */
    key?: string
    props?: ObjectProps
    icon: string
}

// ── Source writing helpers ──────────────────────────────────────────────────

export function str(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029')}'`
}

export function num(value: number): string {
    return String(Math.round(value * 1000) / 1000)
}

/** Write an options object, skipping values that match the defaults. */
export function options(entries: readonly (readonly [string, PropValue | readonly number[] | undefined, PropValue?])[]): string {
    const parts: string[] = []
    for (const [key, value, fallback] of entries) {
        if (value === undefined || value === fallback) continue
        let written: string
        if (typeof value === 'string') written = str(value)
        else if (typeof value === 'number') written = num(value)
        else if (Array.isArray(value)) written = `[${value.map((item) => num(item as number)).join(', ')}]`
        else written = String(value)
        parts.push(`${key}: ${written}`)
    }
    return parts.length ? `{ ${parts.join(', ')} }` : ''
}

function call(name: string, ...args: string[]): string {
    return `${name}(${args.filter(Boolean).join(', ')})`
}

// ── Reusable pieces of style ────────────────────────────────────────────────

const DASHES: Record<string, readonly number[] | undefined> = {
    solid: undefined,
    dashed: [12, 9],
    dotted: [1, 9],
}

const strokeFields: readonly Field[] = [
    { key: 'stroke', label: 'Stroke', type: 'color', nullable: true },
    { key: 'width', label: 'Width', type: 'number', min: 0, max: 60, step: 0.5 },
    { key: 'dash', label: 'Line', type: 'select', options: [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] },
    { key: 'glow', label: 'Glow', type: 'number', min: 0, max: 80, step: 1 },
]

const shapeFields: readonly Field[] = [
    { key: 'fill', label: 'Fill', type: 'color', nullable: true },
    ...strokeFields,
]

function shapeStyle(props: ObjectProps): ShapeStyle {
    const style: ShapeStyle = {}
    if (props['fill']) style.fill = props['fill'] as string
    style.stroke = (props['stroke'] as string | null) ?? null
    if (props['stroke']) style.width = props['width'] as number
    const dash = DASHES[props['dash'] as string]
    if (dash && props['stroke']) style.dash = dash
    if (props['glow']) style.glow = props['glow'] as number
    return style
}

function shapeStyleCode(props: ObjectProps): readonly (readonly [string, PropValue | readonly number[] | undefined, PropValue?])[] {
    const dash = DASHES[props['dash'] as string]
    return [
        ['fill', props['fill'] || undefined],
        ['stroke', props['stroke'] ?? null],
        ['width', props['stroke'] ? props['width'] as number : undefined],
        ['dash', dash && props['stroke'] ? dash : undefined],
        ['glow', props['glow'] || undefined],
    ]
}

function exprEnv(ctx: BuildContext, scope: Readonly<Record<string, number>> = {}): Record<string, number> {
    const env: Record<string, number> = { ...scope }
    for (const [name, value] of ctx.values) env[name] = value.value
    return env
}

// ── The kinds ───────────────────────────────────────────────────────────────

const FONT_OPTIONS = [['sans', 'Inter'], ['serif', 'Instrument Serif'], ['text-serif', 'Source Serif 4'], ['mono', 'JetBrains Mono']] as const

const textKind: KindDef = {
    kind: 'text', label: 'Text', group: 'Type',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { content: 'Text', size: 44, font: 'sans', weight: '400', italic: false, color: 'ink', align: 'center', maxWidth: 0, tracking: 0, uppercase: false },
    fields: [
        { key: 'content', label: 'Text', type: 'longtext' },
        { key: 'size', label: 'Size', type: 'number', min: 6, max: 400, step: 1 },
        { key: 'font', label: 'Font', type: 'select', options: FONT_OPTIONS },
        { key: 'weight', label: 'Weight', type: 'select', options: [['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold']] },
        { key: 'italic', label: 'Italic', type: 'bool' },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'align', label: 'Align', type: 'select', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
        { key: 'maxWidth', label: 'Wrap at', type: 'number', min: 0, max: 4000, step: 10, help: '0 keeps one line per paragraph' },
        { key: 'tracking', label: 'Tracking', type: 'number', min: -0.2, max: 1, step: 0.01 },
        { key: 'uppercase', label: 'Uppercase', type: 'bool' },
    ],
    build(p) {
        return text(String(p['content'] || ' '), {
            size: p['size'] as number, font: p['font'] as 'sans', weight: Number(p['weight']) as 400, italic: p['italic'] as boolean,
            color: p['color'] as string, align: p['align'] as 'left', tracking: p['tracking'] as number, uppercase: p['uppercase'] as boolean,
            ...(p['maxWidth'] ? { maxWidth: p['maxWidth'] as number } : {}),
        })
    },
    code(p) {
        return {
            expr: call('text', str(String(p['content'] || ' ')), options([
                ['size', p['size'] as number], ['font', p['font'] as string, 'sans'], ['weight', Number(p['weight']), 400],
                ['italic', p['italic'] as boolean, false], ['color', p['color'] as string, 'ink'], ['align', p['align'] as string],
                ['tracking', p['tracking'] as number, 0], ['uppercase', p['uppercase'] as boolean, false],
                ['maxWidth', (p['maxWidth'] as number) || undefined],
            ])),
        }
    },
}

const texKind: KindDef = {
    kind: 'tex', label: 'Equation', group: 'Type',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { source: 'e^{i\\pi} + 1 = 0', size: 72, color: 'ink' },
    fields: [
        { key: 'source', label: 'TeX', type: 'tex' },
        { key: 'size', label: 'Size', type: 'number', min: 8, max: 400, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        return tex(String(p['source'] || '{}'), { size: p['size'] as number, color: p['color'] as string })
    },
    code(p) {
        return { expr: call('tex', str(String(p['source'] || '{}')), options([['size', p['size'] as number], ['color', p['color'] as string, 'ink']])) }
    },
}

const rectKind: KindDef = {
    kind: 'rect', label: 'Rectangle', group: 'Shape',
    resize: { type: 'props', keys: ['width_', 'height_'] }, pick: 'shape',
    defaults: { width_: 360, height_: 220, radius: 0, fill: null, stroke: 'ink', width: 3, dash: 'solid', glow: 0 },
    fields: [
        { key: 'width_', label: 'Width', type: 'number', min: 1, max: 4000, step: 1 },
        { key: 'height_', label: 'Height', type: 'number', min: 1, max: 4000, step: 1 },
        { key: 'radius', label: 'Radius', type: 'number', min: 0, max: 400, step: 1 },
        ...shapeFields,
    ],
    build(p) {
        return rect(p['width_'] as number, p['height_'] as number, { radius: p['radius'] as number, ...shapeStyle(p) })
    },
    code(p) {
        return { expr: call('rect', num(p['width_'] as number), num(p['height_'] as number), options([['radius', p['radius'] as number, 0], ...shapeStyleCode(p)])) }
    },
}

const ellipseKind: KindDef = {
    kind: 'ellipse', label: 'Ellipse', group: 'Shape',
    resize: { type: 'props', keys: ['rx', 'ry'] }, pick: 'shape',
    defaults: { rx: 130, ry: 130, fill: null, stroke: 'blue', width: 4, dash: 'solid', glow: 0 },
    fields: [
        { key: 'rx', label: 'Radius X', type: 'number', min: 1, max: 2000, step: 1 },
        { key: 'ry', label: 'Radius Y', type: 'number', min: 1, max: 2000, step: 1 },
        ...shapeFields,
    ],
    build(p) {
        return ellipse(p['rx'] as number, p['ry'] as number, shapeStyle(p))
    },
    code(p) {
        return { expr: call('ellipse', num(p['rx'] as number), num(p['ry'] as number), options(shapeStyleCode(p))) }
    },
}

const polygonKind: KindDef = {
    kind: 'polygon', label: 'Polygon', group: 'Shape',
    resize: { type: 'props', keys: ['radius'] }, pick: 'shape',
    defaults: { sides: 6, radius: 130, fill: null, stroke: 'teal', width: 4, dash: 'solid', glow: 0 },
    fields: [
        { key: 'sides', label: 'Sides', type: 'number', min: 3, max: 32, step: 1 },
        { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 2000, step: 1 },
        ...shapeFields,
    ],
    build(p) {
        return regularPolygon(Math.round(p['sides'] as number), p['radius'] as number, shapeStyle(p))
    },
    code(p) {
        return { expr: call('regularPolygon', num(Math.round(p['sides'] as number)), num(p['radius'] as number), options(shapeStyleCode(p))) }
    },
}

const lineKind: KindDef = {
    kind: 'line', label: 'Line', group: 'Shape',
    resize: { type: 'props', keys: ['length'] }, pick: 'shape',
    defaults: { length: 420, stroke: 'ink', width: 4, dash: 'solid', glow: 0 },
    fields: [
        { key: 'length', label: 'Length', type: 'number', min: 1, max: 6000, step: 1 },
        ...strokeFields,
    ],
    build(p) {
        const half = (p['length'] as number) / 2
        return line([-half, 0], [half, 0], shapeStyle(p))
    },
    code(p) {
        const half = num((p['length'] as number) / 2)
        return { expr: call('line', `[-${half}, 0]`, `[${half}, 0]`, options(shapeStyleCode(p))) }
    },
}

const arrowKind: KindDef = {
    kind: 'arrow', label: 'Arrow', group: 'Shape',
    resize: { type: 'props', keys: ['length'] }, pick: 'shape',
    defaults: { length: 420, stroke: 'yellow', width: 4, tip: 22, bend: 0, both: false, dash: 'solid', glow: 0 },
    fields: [
        { key: 'length', label: 'Length', type: 'number', min: 2, max: 6000, step: 1 },
        { key: 'tip', label: 'Tip', type: 'number', min: 2, max: 120, step: 1 },
        { key: 'bend', label: 'Bend', type: 'number', min: -1000, max: 1000, step: 2 },
        { key: 'both', label: 'Two heads', type: 'bool' },
        ...strokeFields,
    ],
    build(p) {
        const half = (p['length'] as number) / 2
        return arrow([-half, 0], [half, 0], {
            ...shapeStyle(p), stroke: (p['stroke'] as string) ?? 'ink',
            tip: p['tip'] as number, bend: p['bend'] as number, both: p['both'] as boolean,
        })
    },
    code(p) {
        const half = num((p['length'] as number) / 2)
        return {
            expr: call('arrow', `[-${half}, 0]`, `[${half}, 0]`, options([
                ['stroke', (p['stroke'] as string) ?? 'ink'], ['width', p['width'] as number],
                ['tip', p['tip'] as number], ['bend', p['bend'] as number, 0], ['both', p['both'] as boolean, false],
                ['dash', DASHES[p['dash'] as string]], ['glow', p['glow'] as number, 0],
            ])),
        }
    },
}

const dotKind: KindDef = {
    kind: 'dot', label: 'Dot', group: 'Shape',
    resize: { type: 'props', keys: ['radius'] }, pick: 'bounds',
    defaults: { radius: 12, color: 'yellow', glow: 0 },
    fields: [
        { key: 'radius', label: 'Radius', type: 'number', min: 1, max: 400, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'glow', label: 'Glow', type: 'number', min: 0, max: 80, step: 1 },
    ],
    build(p) {
        return dot(p['radius'] as number, p['color'] as ColorInput, p['glow'] ? { glow: p['glow'] as number } : {})
    },
    code(p) {
        return { expr: call('dot', num(p['radius'] as number), str(p['color'] as string), options([['glow', p['glow'] as number, 0]])) }
    },
}

const braceKind: KindDef = {
    kind: 'brace', label: 'Brace', group: 'Shape',
    resize: { type: 'props', keys: ['length'] }, pick: 'bounds',
    defaults: { length: 320, color: 'ink', depth: 26 },
    fields: [
        { key: 'length', label: 'Length', type: 'number', min: 8, max: 4000, step: 1 },
        { key: 'depth', label: 'Depth', type: 'number', min: 4, max: 120, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        const half = (p['length'] as number) / 2
        return brace([-half, 0], [half, 0], { fill: p['color'] as string, depth: p['depth'] as number })
    },
    code(p) {
        const half = num((p['length'] as number) / 2)
        return { expr: call('brace', `[-${half}, 0]`, `[${half}, 0]`, options([['fill', p['color'] as string], ['depth', p['depth'] as number]])) }
    },
}

const graphKind: KindDef = {
    kind: 'graph', label: 'Graph', group: 'Math',
    resize: { type: 'props', keys: ['plotWidth', 'plotHeight'] }, pick: 'bounds',
    defaults: {
        expr: 'sin(x)', stroke: 'blue', width: 4, glow: 6,
        xMin: -6.28, xMax: 6.28, yMin: -2, yMax: 2, plotWidth: 1100, plotHeight: 520,
        grid: true, labels: true, axisColor: 'dim',
    },
    fields: [
        { key: 'expr', label: 'y =', type: 'expr', scope: ['x'], help: 'Use x and project variables. Try a*sin(2x)' },
        { key: 'stroke', label: 'Curve', type: 'color', nullable: true },
        { key: 'width', label: 'Weight', type: 'number', min: 0.5, max: 30, step: 0.5 },
        { key: 'glow', label: 'Glow', type: 'number', min: 0, max: 80, step: 1 },
        { key: 'xMin', label: 'x from', type: 'number', min: -1e6, max: 1e6, step: 0.5 },
        { key: 'xMax', label: 'x to', type: 'number', min: -1e6, max: 1e6, step: 0.5 },
        { key: 'yMin', label: 'y from', type: 'number', min: -1e6, max: 1e6, step: 0.5 },
        { key: 'yMax', label: 'y to', type: 'number', min: -1e6, max: 1e6, step: 0.5 },
        { key: 'plotWidth', label: 'Width', type: 'number', min: 80, max: 4000, step: 10 },
        { key: 'plotHeight', label: 'Height', type: 'number', min: 60, max: 3000, step: 10 },
        { key: 'grid', label: 'Grid', type: 'bool' },
        { key: 'labels', label: 'Numbers', type: 'bool' },
        { key: 'axisColor', label: 'Axes', type: 'color' },
    ],
    build(p, ctx) {
        const [x0, x1] = ascending(p['xMin'] as number, p['xMax'] as number)
        const [y0, y1] = ascending(p['yMin'] as number, p['yMax'] as number)
        const ax = axes({
            x: [x0, x1], y: [y0, y1], width: p['plotWidth'] as number, height: p['plotHeight'] as number,
            grid: p['grid'] as boolean, labels: p['labels'] as boolean, color: p['axisColor'] as string,
        })
        if (p['stroke'] && p['expr']) {
            const expr = parseExpr(String(p['expr']), ['x', ...ctx.values.keys()])
            const f = (x: number) => expr.run(exprEnv(ctx, { x }))
            const curve = ax.plot(f, { stroke: p['stroke'] as string, width: p['width'] as number, ...(p['glow'] ? { glow: p['glow'] as number } : {}) })
            ax.data['curve'] = curve
            // A curve that reads a variable redraws as the variable moves.
            if (expr.variables.size > (expr.variables.has('x') ? 1 : 0)) {
                ctx.stage.update(curve, (node) => {
                    node.set('path', ax.plotPath(f))
                })
            }
        }
        return ax
    },
    code(p, ctx) {
        const [x0, x1] = ascending(p['xMin'] as number, p['xMax'] as number)
        const [y0, y1] = ascending(p['yMin'] as number, p['yMax'] as number)
        const setup = [`const ${ctx.name} = ${call('axes', options([
            ['x', [x0, x1]], ['y', [y0, y1]], ['width', p['plotWidth'] as number], ['height', p['plotHeight'] as number],
            ['grid', p['grid'] as boolean], ['labels', p['labels'] as boolean], ['color', p['axisColor'] as string],
        ]))}`]
        const after: string[] = []
        if (p['stroke'] && p['expr']) {
            const expr = parseExpr(String(p['expr']), ['x', ...ctx.variables])
            const body = expr.js((name) => name === 'x' ? 'x' : ctx.variables.includes(name) ? `${ctx.variableName(name)}.value` : name)
            const style = options([['stroke', p['stroke'] as string], ['width', p['width'] as number], ['glow', p['glow'] as number, 0]])
            const curve = ctx.identifier('Curve')
            setup.push(`const ${curve} = ${ctx.name}.plot((x) => ${body}, ${style})`)
            if (expr.variables.size > (expr.variables.has('x') ? 1 : 0)) {
                after.push(`s.update(${curve}, (node) => node.set('path', ${ctx.name}.plotPath((x) => ${body})))`)
            }
        }
        return { setup, after, expr: ctx.name }
    },
}

function ascending(a: number, b: number): [number, number] {
    if (a === b) return [a, a + 1]
    return a < b ? [a, b] : [b, a]
}

const planeKind: KindDef = {
    kind: 'plane', label: 'Number plane', group: 'Math',
    resize: { type: 'props', keys: ['unit'] }, pick: 'shape',
    defaults: { unit: 120, color: 'blue', axisColor: 'ink', lineWidth: 1.6, minor: 0 },
    fields: [
        { key: 'unit', label: 'Unit', type: 'number', min: 8, max: 800, step: 2, help: 'Stage pixels per unit' },
        { key: 'color', label: 'Lines', type: 'color' },
        { key: 'axisColor', label: 'Axes', type: 'color' },
        { key: 'lineWidth', label: 'Weight', type: 'number', min: 0.25, max: 12, step: 0.25 },
        { key: 'minor', label: 'Minor', type: 'number', min: 0, max: 8, step: 1, help: 'Divisions per unit' },
    ],
    build(p) {
        return plane({ unit: p['unit'] as number, color: p['color'] as string, axisColor: p['axisColor'] as string, width: p['lineWidth'] as number, minor: p['minor'] as number })
    },
    code(p) {
        return { expr: call('plane', options([['unit', p['unit'] as number], ['color', p['color'] as string], ['axisColor', p['axisColor'] as string], ['width', p['lineWidth'] as number], ['minor', p['minor'] as number, 0]])) }
    },
}

const readoutKind: KindDef = {
    kind: 'readout', label: 'Number readout', group: 'Math',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { expr: '0', digits: 2, size: 48, color: 'yellow', font: 'mono', prefix: '', suffix: '' },
    fields: [
        { key: 'expr', label: 'Value', type: 'expr', help: 'Reads project variables, for example 2 + h' },
        { key: 'digits', label: 'Digits', type: 'number', min: 0, max: 8, step: 1 },
        { key: 'size', label: 'Size', type: 'number', min: 6, max: 400, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'font', label: 'Font', type: 'select', options: FONT_OPTIONS },
        { key: 'prefix', label: 'Before', type: 'text' },
        { key: 'suffix', label: 'After', type: 'text' },
    ],
    build(p, ctx) {
        const expr = parseExpr(String(p['expr'] || '0'), [...ctx.values.keys()])
        return decimal(() => expr.run(exprEnv(ctx)), {
            digits: p['digits'] as number, size: p['size'] as number, color: p['color'] as string,
            font: p['font'] as 'mono', prefix: p['prefix'] as string, suffix: p['suffix'] as string,
        })
    },
    code(p, ctx) {
        const expr = parseExpr(String(p['expr'] || '0'), [...ctx.variables])
        const body = expr.js((name) => ctx.variables.includes(name) ? `${ctx.variableName(name)}.value` : name)
        return {
            expr: call('decimal', `() => ${body}`, options([
                ['digits', p['digits'] as number], ['size', p['size'] as number], ['color', p['color'] as string],
                ['font', p['font'] as string], ['prefix', p['prefix'] as string, ''], ['suffix', p['suffix'] as string, ''],
            ])),
        }
    },
}


// ── Data written as plain text ──────────────────────────────────────────────

/** Rows of values: "1 2; 3 4" or one row per line. */
export function parseRows(source: string): string[][] {
    return source.split(/[;\n]/).map((row) => row.trim()).filter(Boolean).map((row) => row.split(/[\s,]+/).filter(Boolean))
}

export function parseNumberRows(source: string): number[][] {
    return parseRows(source).map((row) => row.map((value) => Number(value)).map((value) => Number.isFinite(value) ? value : 0))
}

/** Numbers separated by commas or spaces. */
export function parseNumbers(source: string): number[] {
    return source.split(/[\s,;]+/).filter(Boolean).map(Number).filter((value) => Number.isFinite(value))
}

export interface LabeledValue {
    label: string
    value: number
    color?: string
}

/** One "label: value" per line or per comma. Text after a second colon names a color. */
export function parseLabeled(source: string): LabeledValue[] {
    return source.split(/[,\n]/).map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => {
        const [label, value, color] = entry.split(':').map((part) => part.trim())
        const number = Number(value)
        if (!label || !Number.isFinite(number)) return []
        return [{ label, value: number, ...(color ? { color } : {}) }]
    })
}

/** Edges such as "API -> Queue: publish". Lone names on a line add a node. */
export function parseNetwork(source: string): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] } {
    const nodes = new Map<string, GraphNodeSpec>()
    const edges: GraphEdgeSpec[] = []
    const addNode = (id: string) => {
        if (!nodes.has(id)) nodes.set(id, { id, label: id, width: Math.max(96, id.length * 12 + 36), height: 46 })
    }
    for (const raw of source.split('\n')) {
        const entry = raw.trim()
        if (!entry) continue
        const [path, label] = entry.split(/\s*:\s*/, 2) as [string, string | undefined]
        const parts = path.split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean)
        parts.forEach(addNode)
        for (let i = 0; i + 1 < parts.length; i++) {
            edges.push({ from: parts[i]!, to: parts[i + 1]!, ...(label && i + 2 === parts.length ? { label } : {}) })
        }
    }
    return { nodes: [...nodes.values()], edges }
}

/** Rows of an info box: "Latency: 428 ms" per line. */
export function parseInfoRows(source: string): InfoRow[] {
    return source.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const at = entry.indexOf(':')
        return at < 0 ? { label: entry } : { label: entry.slice(0, at).trim(), value: entry.slice(at + 1).trim() }
    })
}

function literal(value: unknown): string {
    if (typeof value === 'string') return str(value)
    if (typeof value === 'number') return num(value)
    if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`
    if (value && typeof value === 'object') {
        const parts = Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => `${/^[A-Za-z_]\w*$/.test(key) ? key : str(key)}: ${literal(entry)}`)
        return `{ ${parts.join(', ')} }`
    }
    return String(value)
}

const matrixKind: KindDef = {
    kind: 'matrix', label: 'Matrix', group: 'Math', entrance: 'write',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { rows: '1 1; 0 1', size: 56, color: 'ink', bracket: '[' },
    fields: [
        { key: 'rows', label: 'Entries', type: 'longtext', help: 'Separate rows with ; and values with spaces' },
        { key: 'size', label: 'Size', type: 'number', min: 8, max: 300, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'bracket', label: 'Brackets', type: 'select', options: [['[', '[ ]'], ['(', '( )'], ['|', '| |']] },
    ],
    build(p) {
        const rows = parseRows(String(p['rows']))
        if (rows.length === 0) throw new Error('Add at least one row.')
        return matrix(rows, { size: p['size'] as number, color: p['color'] as string, bracket: p['bracket'] as '[' })
    },
    code(p) {
        return { expr: call('matrix', literal(parseRows(String(p['rows']))), options([['size', p['size'] as number], ['color', p['color'] as string], ['bracket', p['bracket'] as string]])) }
    },
}

const numberLineKind: KindDef = {
    kind: 'numberLine', label: 'Number line', group: 'Math', entrance: 'draw',
    resize: { type: 'props', keys: ['length'] }, pick: 'bounds',
    defaults: { min: -5, max: 5, step: 1, length: 900, color: 'dim', labels: true },
    fields: [
        { key: 'min', label: 'From', type: 'number', min: -1e6, max: 1e6, step: 1 },
        { key: 'max', label: 'To', type: 'number', min: -1e6, max: 1e6, step: 1 },
        { key: 'step', label: 'Tick', type: 'number', min: 0.01, max: 1e5, step: 0.25 },
        { key: 'length', label: 'Length', type: 'number', min: 40, max: 6000, step: 10 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'labels', label: 'Numbers', type: 'bool' },
    ],
    build(p) {
        const [a, b] = ascending(p['min'] as number, p['max'] as number)
        return numberLine({ range: [a, b], step: p['step'] as number, length: p['length'] as number, color: p['color'] as string, labels: p['labels'] as boolean })
    },
    code(p) {
        const [a, b] = ascending(p['min'] as number, p['max'] as number)
        return { expr: call('numberLine', options([['range', [a, b]], ['step', p['step'] as number], ['length', p['length'] as number], ['color', p['color'] as string], ['labels', p['labels'] as boolean]])) }
    },
}

const complexKind: KindDef = {
    kind: 'complex', label: 'Complex plane', group: 'Math', entrance: 'draw',
    resize: { type: 'props', keys: ['unit'] }, pick: 'shape',
    defaults: { unit: 120, color: 'blue', axisColor: 'ink', lineWidth: 1.6, labelRange: 3 },
    fields: [
        { key: 'unit', label: 'Unit', type: 'number', min: 8, max: 800, step: 2 },
        { key: 'color', label: 'Lines', type: 'color' },
        { key: 'axisColor', label: 'Axes', type: 'color' },
        { key: 'lineWidth', label: 'Weight', type: 'number', min: 0.25, max: 12, step: 0.25 },
        { key: 'labelRange', label: 'Labels to', type: 'number', min: 0, max: 20, step: 1 },
    ],
    build(p) {
        return complexPlane({ unit: p['unit'] as number, color: p['color'] as string, axisColor: p['axisColor'] as string, width: p['lineWidth'] as number, labelRange: p['labelRange'] as number })
    },
    code(p) {
        return { expr: call('complexPlane', options([['unit', p['unit'] as number], ['color', p['color'] as string], ['axisColor', p['axisColor'] as string], ['width', p['lineWidth'] as number], ['labelRange', p['labelRange'] as number]])) }
    },
}

const fieldKind: KindDef = {
    kind: 'field', label: 'Vector field', group: 'Math', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['unit'] }, pick: 'bounds',
    defaults: { fx: '-y', fy: 'x', unit: 90, spacing: 1, lenMax: 70 },
    fields: [
        { key: 'fx', label: 'x arrow', type: 'expr', scope: ['x', 'y', 't'] },
        { key: 'fy', label: 'y arrow', type: 'expr', scope: ['x', 'y', 't'], help: 'Reads x, y, t, and project variables' },
        { key: 'unit', label: 'Unit', type: 'number', min: 8, max: 600, step: 2 },
        { key: 'spacing', label: 'Spacing', type: 'number', min: 0.1, max: 8, step: 0.1 },
        { key: 'lenMax', label: 'Longest', type: 'number', min: 4, max: 400, step: 2 },
    ],
    build(p, ctx) {
        const scope = ['x', 'y', 't', ...ctx.values.keys()]
        const fx = parseExpr(String(p['fx'] || '0'), scope), fy = parseExpr(String(p['fy'] || '0'), scope)
        const moves = [...fx.variables, ...fy.variables].some((name) => name !== 'x' && name !== 'y')
        return vectorField((x, y, t) => {
            const env = exprEnv(ctx, { x, y, t })
            return [fx.run(env), fy.run(env)]
        }, { unit: p['unit'] as number, step: p['spacing'] as number, maxLength: p['lenMax'] as number, animate: moves })
    },
    code(p, ctx) {
        const scope = ['x', 'y', 't', ...ctx.variables]
        const fx = parseExpr(String(p['fx'] || '0'), scope), fy = parseExpr(String(p['fy'] || '0'), scope)
        const name = (variable: string) => ctx.variables.includes(variable) ? `${ctx.variableName(variable)}.value` : variable
        const moves = [...fx.variables, ...fy.variables].some((entry) => entry !== 'x' && entry !== 'y')
        return {
            expr: call('vectorField', `(x, y, t) => [${fx.js(name)}, ${fy.js(name)}]`, options([
                ['unit', p['unit'] as number], ['step', p['spacing'] as number], ['maxLength', p['lenMax'] as number], ['animate', moves, false],
            ])),
        }
    },
}

const barsKind: KindDef = {
    kind: 'bars', label: 'Bar chart', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['chartWidth', 'chartHeight'] }, pick: 'bounds',
    defaults: { data: 'Q1: 42\nQ2: 58\nQ3: 71\nQ4: 96', chartWidth: 820, chartHeight: 440, labelSize: 22, horizontal: false, showValues: true, color: 'blue' },
    fields: [
        { key: 'data', label: 'Data', type: 'longtext', help: 'One "label: value" per line. A third part sets a color: Q4: 96: yellow' },
        { key: 'chartWidth', label: 'Width', type: 'number', min: 80, max: 4000, step: 10 },
        { key: 'chartHeight', label: 'Height', type: 'number', min: 60, max: 3000, step: 10 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'horizontal', label: 'Horizontal', type: 'bool' },
        { key: 'showValues', label: 'Values', type: 'bool' },
    ],
    build(p) {
        const data = parseLabeled(String(p['data']))
        if (data.length === 0) throw new Error('Add at least one "label: value" line.')
        return barChart(data, { width: p['chartWidth'] as number, height: p['chartHeight'] as number, labelSize: p['labelSize'] as number, color: p['color'] as string, horizontal: p['horizontal'] as boolean, showValues: p['showValues'] as boolean })
    },
    code(p) {
        return {
            expr: call('barChart', literal(parseLabeled(String(p['data']))), options([
                ['width', p['chartWidth'] as number], ['height', p['chartHeight'] as number], ['labelSize', p['labelSize'] as number], ['color', p['color'] as string],
                ['horizontal', p['horizontal'] as boolean, false], ['showValues', p['showValues'] as boolean],
            ])),
        }
    },
}

const pieKind: KindDef = {
    kind: 'pie', label: 'Pie chart', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['radius'] }, pick: 'bounds',
    defaults: { data: 'Search: 38\nDirect: 26\nReferral: 21\nSocial: 15', radius: 220, hole: 0.55, labelSize: 22, percent: true },
    fields: [
        { key: 'data', label: 'Data', type: 'longtext', help: 'One "label: value" per line' },
        { key: 'radius', label: 'Radius', type: 'number', min: 20, max: 2000, step: 2 },
        { key: 'hole', label: 'Hole', type: 'number', min: 0, max: 0.95, step: 0.05 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'percent', label: 'Percent', type: 'bool' },
    ],
    build(p) {
        const data = parseLabeled(String(p['data']))
        if (data.length === 0) throw new Error('Add at least one "label: value" line.')
        const hole = p['hole'] as number
        const opts = { radius: p['radius'] as number, labelSize: p['labelSize'] as number, percent: p['percent'] as boolean }
        return hole > 0 ? donut(data, { ...opts, hole }) : pie(data, opts)
    },
    code(p) {
        const hole = p['hole'] as number
        const data = literal(parseLabeled(String(p['data'])))
        return { expr: call(hole > 0 ? 'donut' : 'pie', data, options([['radius', p['radius'] as number], ['labelSize', p['labelSize'] as number], ['percent', p['percent'] as boolean], ['hole', hole > 0 ? hole : undefined]])) }
    },
}

const linesKind: KindDef = {
    kind: 'lines', label: 'Line chart', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['chartWidth', 'chartHeight'] }, pick: 'bounds',
    defaults: { series: '3 5 4 7 9 8 12\n2 3 3 4 6 5 7', chartWidth: 900, chartHeight: 460, labelSize: 20, color: 'blue', area: 0 },
    fields: [
        { key: 'series', label: 'Series', type: 'longtext', help: 'One line per series, values separated by spaces' },
        { key: 'chartWidth', label: 'Width', type: 'number', min: 80, max: 4000, step: 10 },
        { key: 'chartHeight', label: 'Height', type: 'number', min: 60, max: 3000, step: 10 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'color', label: 'First line', type: 'color' },
        { key: 'area', label: 'Area', type: 'number', min: 0, max: 1, step: 0.05 },
    ],
    build(p) {
        const rows = parseNumberRows(String(p['series']).replace(/;/g, '\n'))
        if (rows.length === 0 || rows.some((row) => row.length < 2)) throw new Error('Each series needs at least two values.')
        const palette = [p['color'] as string, 'yellow', 'teal', 'pink', 'orange']
        return lineChart(rows.map((values, i) => ({ values, color: palette[i % palette.length]!, ...(p['area'] ? { area: p['area'] as number } : {}) })), { width: p['chartWidth'] as number, height: p['chartHeight'] as number, labelSize: p['labelSize'] as number })
    },
    code(p) {
        const palette = [p['color'] as string, 'yellow', 'teal', 'pink', 'orange']
        const rows = parseNumberRows(String(p['series']).replace(/;/g, '\n'))
        return {
            expr: call('lineChart', literal(rows.map((values, i) => ({ values, color: palette[i % palette.length]!, ...(p['area'] ? { area: p['area'] as number } : {}) }))), options([
                ['width', p['chartWidth'] as number], ['height', p['chartHeight'] as number], ['labelSize', p['labelSize'] as number],
            ])),
        }
    },
}

const heatmapKind: KindDef = {
    kind: 'heatmap', label: 'Heatmap', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['cell'] }, pick: 'bounds',
    defaults: { values: '1 3 2 5; 2 6 4 7; 1 4 8 9', cell: 72, showValues: true },
    fields: [
        { key: 'values', label: 'Values', type: 'longtext', help: 'Separate rows with ; and values with spaces' },
        { key: 'cell', label: 'Cell', type: 'number', min: 6, max: 400, step: 2 },
        { key: 'showValues', label: 'Numbers', type: 'bool' },
    ],
    build(p) {
        const rows = parseNumberRows(String(p['values']))
        if (rows.length === 0 || rows[0]!.length === 0) throw new Error('Add at least one row of values.')
        if (rows.some((row) => row.length !== rows[0]!.length)) throw new Error('Every row needs the same number of values.')
        return heatmap(rows, { cell: p['cell'] as number, values: p['showValues'] as boolean })
    },
    code(p) {
        return { expr: call('heatmap', literal(parseNumberRows(String(p['values']))), options([['cell', p['cell'] as number], ['values', p['showValues'] as boolean]])) }
    },
}

const networkKind: KindDef = {
    kind: 'network', label: 'Node graph', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'scale' }, pick: 'bounds',
    defaults: { edges: 'Client -> API: HTTPS\nAPI -> Queue: publish\nQueue -> Worker\nWorker -> Store: write\nAPI -> Store: read', direction: 'LR', labelSize: 20, nodeColor: 'blue', edgeColor: 'dim' },
    fields: [
        { key: 'edges', label: 'Edges', type: 'longtext', help: 'One "A -> B: label" per line' },
        { key: 'direction', label: 'Direction', type: 'select', options: [['LR', 'Left to right'], ['TB', 'Top to bottom'], ['RL', 'Right to left'], ['BT', 'Bottom to top']] },
        { key: 'labelSize', label: 'Text', type: 'number', min: 8, max: 60, step: 1 },
        { key: 'nodeColor', label: 'Nodes', type: 'color' },
        { key: 'edgeColor', label: 'Edges', type: 'color' },
    ],
    build(p) {
        const { nodes, edges } = parseNetwork(String(p['edges']))
        if (nodes.length === 0) throw new Error('Add an edge such as: A -> B')
        return graph(nodes, edges, { direction: p['direction'] as 'LR', directed: true, labelSize: p['labelSize'] as number, nodeColor: p['nodeColor'] as string, edgeColor: p['edgeColor'] as string })
    },
    code(p) {
        const { nodes, edges } = parseNetwork(String(p['edges']))
        return {
            expr: call('graph', literal(nodes), literal(edges), options([
                ['direction', p['direction'] as string], ['directed', true], ['labelSize', p['labelSize'] as number], ['nodeColor', p['nodeColor'] as string], ['edgeColor', p['edgeColor'] as string],
            ])),
        }
    },
}

const infoBoxKind: KindDef = {
    kind: 'infobox', label: 'Info box', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { title: 'Checkout API', subtitle: 'us-east-1, 12 pods', badge: 'p99', rows: 'Latency: 428 ms\nError rate: 0.07%\nThroughput: 2.1k req/s', tags: 'go, grpc', size: 18, boxWidth: 0, accent: 'blue' },
    fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'subtitle', label: 'Subtitle', type: 'text' },
        { key: 'badge', label: 'Badge', type: 'text' },
        { key: 'rows', label: 'Rows', type: 'longtext', help: 'One "label: value" per line' },
        { key: 'tags', label: 'Tags', type: 'text', help: 'Separate with commas' },
        { key: 'size', label: 'Text size', type: 'number', min: 8, max: 80, step: 1, help: 'Everything scales from it. Raise it for a talk' },
        { key: 'boxWidth', label: 'Width', type: 'number', min: 0, max: 3000, step: 10, help: '0 fits the content' },
        { key: 'accent', label: 'Accent', type: 'color' },
    ],
    build(p) {
        const tags = String(p['tags']).split(',').map((tag) => tag.trim()).filter(Boolean)
        return infoBox({
            title: String(p['title']) || ' ', size: p['size'] as number, accent: p['accent'] as string, rows: parseInfoRows(String(p['rows'])),
            ...(p['subtitle'] ? { subtitle: String(p['subtitle']) } : {}), ...(p['badge'] ? { badge: String(p['badge']) } : {}),
            ...(tags.length ? { tags } : {}), ...(p['boxWidth'] ? { width: p['boxWidth'] as number } : {}),
        })
    },
    code(p) {
        const tags = String(p['tags']).split(',').map((tag) => tag.trim()).filter(Boolean)
        return {
            expr: call('infoBox', literal({
                title: String(p['title']) || ' ', size: p['size'], accent: p['accent'], rows: parseInfoRows(String(p['rows'])),
                ...(p['subtitle'] ? { subtitle: String(p['subtitle']) } : {}), ...(p['badge'] ? { badge: String(p['badge']) } : {}),
                ...(tags.length ? { tags } : {}), ...(p['boxWidth'] ? { width: p['boxWidth'] } : {}),
            })),
        }
    },
}

const sparkKind: KindDef = {
    kind: 'spark', label: 'Sparkline', group: 'Data', entrance: 'draw',
    resize: { type: 'props', keys: ['sparkWidth', 'sparkHeight'] }, pick: 'bounds',
    defaults: { values: '3 5 4 7 9 8 12 10 14', sparkWidth: 240, sparkHeight: 60, color: 'teal', weight: 2.5, dotted: true },
    fields: [
        { key: 'values', label: 'Values', type: 'longtext' },
        { key: 'sparkWidth', label: 'Width', type: 'number', min: 10, max: 3000, step: 5 },
        { key: 'sparkHeight', label: 'Height', type: 'number', min: 6, max: 1000, step: 2 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'weight', label: 'Weight', type: 'number', min: 0.5, max: 20, step: 0.5 },
        { key: 'dotted', label: 'End dot', type: 'bool' },
    ],
    build(p) {
        const values = parseNumbers(String(p['values']))
        if (values.length < 2) throw new Error('A sparkline needs at least two values.')
        return sparkline(values, { width: p['sparkWidth'] as number, height: p['sparkHeight'] as number, color: p['color'] as string, weight: p['weight'] as number, dotted: p['dotted'] as boolean })
    },
    code(p) {
        return { expr: call('sparkline', literal(parseNumbers(String(p['values']))), options([['width', p['sparkWidth'] as number], ['height', p['sparkHeight'] as number], ['color', p['color'] as string], ['weight', p['weight'] as number], ['dotted', p['dotted'] as boolean]])) }
    },
}

const codeKind: KindDef = {
    kind: 'code', label: 'Code block', group: 'System', entrance: 'write',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { source: 'function area(r: number) {\n    return Math.PI * r ** 2\n}', language: 'ts', size: 28, lineNumbers: true, panel: true },
    fields: [
        { key: 'source', label: 'Code', type: 'longtext' },
        { key: 'language', label: 'Language', type: 'select', options: [['ts', 'TypeScript'], ['js', 'JavaScript'], ['py', 'Python'], ['go', 'Go'], ['rust', 'Rust'], ['sql', 'SQL'], ['text', 'Plain text']] },
        { key: 'size', label: 'Size', type: 'number', min: 8, max: 120, step: 1 },
        { key: 'lineNumbers', label: 'Line numbers', type: 'bool' },
        { key: 'panel', label: 'Panel', type: 'bool' },
    ],
    build(p) {
        return codeBlock(String(p['source'] || ' '), { language: p['language'] as string, size: p['size'] as number, lineNumbers: p['lineNumbers'] as boolean, panel: p['panel'] as boolean })
    },
    code(p) {
        return { expr: call('codeBlock', str(String(p['source'] || ' ')), options([['language', p['language'] as string], ['size', p['size'] as number], ['lineNumbers', p['lineNumbers'] as boolean], ['panel', p['panel'] as boolean]])) }
    },
}

const neuralKind: KindDef = {
    kind: 'neural', label: 'Neural net', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['netWidth', 'netHeight'] }, pick: 'bounds',
    defaults: { layers: '3 5 5 2', netWidth: 760, netHeight: 460, radius: 16 },
    fields: [
        { key: 'layers', label: 'Layers', type: 'text', help: 'Neurons per layer, separated by spaces' },
        { key: 'netWidth', label: 'Width', type: 'number', min: 80, max: 4000, step: 10 },
        { key: 'netHeight', label: 'Height', type: 'number', min: 60, max: 3000, step: 10 },
        { key: 'radius', label: 'Neuron', type: 'number', min: 2, max: 80, step: 1 },
    ],
    build(p) {
        const layers = parseNumbers(String(p['layers'])).map(Math.round).filter((value) => value > 0).slice(0, 12)
        if (layers.length < 2) throw new Error('A network needs at least two layers.')
        return neuralNet(layers.map((value) => Math.min(value, 64)), { width: p['netWidth'] as number, height: p['netHeight'] as number, radius: p['radius'] as number })
    },
    code(p) {
        const layers = parseNumbers(String(p['layers'])).map(Math.round).filter((value) => value > 0).slice(0, 12).map((value) => Math.min(value, 64))
        return { expr: call('neuralNet', literal(layers), options([['width', p['netWidth'] as number], ['height', p['netHeight'] as number], ['radius', p['radius'] as number]])) }
    },
}

const cellsKind: KindDef = {
    kind: 'cells', label: 'Array', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['cell'] }, pick: 'bounds',
    defaults: { values: '3 1 4 1 5 9', cell: 72, size: 30, indices: true, color: 'blue' },
    fields: [
        { key: 'values', label: 'Values', type: 'text', help: 'Separate with spaces' },
        { key: 'cell', label: 'Cell', type: 'number', min: 12, max: 300, step: 2 },
        { key: 'size', label: 'Text', type: 'number', min: 6, max: 120, step: 1 },
        { key: 'indices', label: 'Indices', type: 'bool' },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        const values = String(p['values']).split(/\s+/).filter(Boolean).slice(0, 80)
        if (values.length === 0) throw new Error('Add at least one value.')
        return arrayCells(values, { cell: p['cell'] as number, size: p['size'] as number, indices: p['indices'] as boolean, color: p['color'] as string })
    },
    code(p) {
        return { expr: call('arrayCells', literal(String(p['values']).split(/\s+/).filter(Boolean).slice(0, 80)), options([['cell', p['cell'] as number], ['size', p['size'] as number], ['indices', p['indices'] as boolean], ['color', p['color'] as string]])) }
    },
}

const tokensKind: KindDef = {
    kind: 'tokens', label: 'Tokens', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { source: 'The quick brown fox jumps', size: 30, color: 'blue', maxWidth: 0 },
    fields: [
        { key: 'source', label: 'Text', type: 'text', help: 'Each word becomes a token' },
        { key: 'size', label: 'Size', type: 'number', min: 8, max: 120, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'maxWidth', label: 'Wrap at', type: 'number', min: 0, max: 4000, step: 10 },
    ],
    build(p) {
        const items = String(p['source']).split(/\s+/).filter(Boolean).slice(0, 120)
        if (items.length === 0) throw new Error('Add at least one word.')
        return tokens(items, { size: p['size'] as number, color: p['color'] as string, ...(p['maxWidth'] ? { maxWidth: p['maxWidth'] as number } : {}) })
    },
    code(p) {
        return { expr: call('tokens', literal(String(p['source']).split(/\s+/).filter(Boolean).slice(0, 120)), options([['size', p['size'] as number], ['color', p['color'] as string], ['maxWidth', (p['maxWidth'] as number) || undefined]])) }
    },
}

const SURFACE_RESOLUTION = 36

const surfaceKind: KindDef = {
    kind: 'surface3d', label: '3D surface', group: '3D', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['unit'] }, pick: 'bounds',
    defaults: { expr: 'sin(x) * cos(y)', range: 3.5, unit: 110, phi: 62, theta: -40, spin: 0.14, axes: true, colorA: 'blue', colorB: 'teal', colorC: 'yellow', mesh: true },
    fields: [
        { key: 'expr', label: 'z =', type: 'expr', scope: ['x', 'y', 't'], help: 'Reads x, y, t, and project variables' },
        { key: 'range', label: 'Extent', type: 'number', min: 0.5, max: 40, step: 0.5 },
        { key: 'unit', label: 'Scale', type: 'number', min: 8, max: 600, step: 2 },
        { key: 'phi', label: 'Tilt', type: 'number', min: 0, max: 180, step: 1 },
        { key: 'theta', label: 'Turn', type: 'number', min: -720, max: 720, step: 1 },
        { key: 'spin', label: 'Spin', type: 'number', min: -3, max: 3, step: 0.01, help: 'Radians per second' },
        { key: 'axes', label: 'Axes', type: 'bool' },
        { key: 'mesh', label: 'Mesh', type: 'bool' },
        { key: 'colorA', label: 'Low', type: 'color' },
        { key: 'colorB', label: 'Middle', type: 'color' },
        { key: 'colorC', label: 'High', type: 'color' },
    ],
    build(p, ctx) {
        const range = p['range'] as number
        const scene = scene3d({ phi: (p['phi'] as number) * Math.PI / 180, theta: (p['theta'] as number) * Math.PI / 180, unit: p['unit'] as number })
        const expr = parseExpr(String(p['expr'] || '0'), ['x', 'y', 't', ...ctx.values.keys()])
        const moves = [...expr.variables].some((name) => name !== 'x' && name !== 'y')
        const made = surface((x, y, t) => expr.run(exprEnv(ctx, { x, y, t })), {
            x: [-range, range], y: [-range, range], resolution: SURFACE_RESOLUTION, animate: moves,
            colors: [p['colorA'] as string, p['colorB'] as string, p['colorC'] as string],
            ...(p['mesh'] ? {} : { mesh: false }),
        })
        scene.add(made)
        if (p['axes']) scene.add(axes3d({ x: [-range, range], y: [-range, range], z: [-range * 0.7, range * 0.7] }))
        if (p['spin']) scene.spin(p['spin'] as number)
        // Scenes paint themselves and report no outline, so this empty box gives them a size to pick and place.
        const reach = (p['unit'] as number) * range * 1.6
        scene.add(rect(reach * 2, reach * 1.5, { stroke: null }))
        return scene
    },
    code(p, ctx) {
        const range = p['range'] as number
        const scope = ['x', 'y', 't', ...ctx.variables]
        const expr = parseExpr(String(p['expr'] || '0'), scope)
        const body = expr.js((name) => ctx.variables.includes(name) ? `${ctx.variableName(name)}.value` : name)
        const moves = [...expr.variables].some((name) => name !== 'x' && name !== 'y')
        const setup = [
            `const ${ctx.name} = scene3d({ phi: ${num(p['phi'] as number)} * Math.PI / 180, theta: ${num(p['theta'] as number)} * Math.PI / 180, unit: ${num(p['unit'] as number)} })`,
            `${ctx.name}.add(surface((x, y, t) => ${body}, ${options([
                ['x', [-range, range]], ['y', [-range, range]], ['resolution', SURFACE_RESOLUTION], ['animate', moves, false],
            ]).replace(/ }$/, `, colors: ${literal([p['colorA'], p['colorB'], p['colorC']])}${p['mesh'] ? '' : ', mesh: false'} }`)}))`,
        ]
        if (p['axes']) setup.push(`${ctx.name}.add(axes3d(${options([['x', [-range, range]], ['y', [-range, range]], ['z', [-range * 0.7, range * 0.7]]])}))`)
        if (p['spin']) setup.push(`${ctx.name}.spin(${num(p['spin'] as number)})`)
        const reach = (p['unit'] as number) * range * 1.6
        setup.push(`${ctx.name}.add(rect(${num(reach * 2)}, ${num(reach * 1.5)}, { stroke: null }))`)
        return { setup, expr: ctx.name }
    },
}

const PICTOGRAM_OPTIONS = PICTOGRAMS.map((name) => [name, name] as const)

function parseSteps(source: string): (string | Step)[] {
    return source.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const at = entry.indexOf(':')
        if (at < 0) return entry
        const label = entry.slice(0, at).trim()
        const note = entry.slice(at + 1).trim()
        return note ? { label, note } : label
    })
}

function parseTree(source: string): TreeSpec {
    const childrenMap = new Map<string, string[]>()
    const meta = new Map<string, { edge?: string; weight?: number }>()
    const order: string[] = []
    const hasParent = new Set<string>()
    const touch = (id: string) => {
        if (!childrenMap.has(id)) {
            childrenMap.set(id, [])
            order.push(id)
        }
    }
    for (const raw of source.split('\n')) {
        const entry = raw.trim()
        if (!entry) continue
        const [path, edgeText] = entry.split(/\s*:\s*/, 2) as [string, string | undefined]
        const parts = path.split(/\s*->\s*/).map((part) => part.trim()).filter(Boolean)
        parts.forEach(touch)
        for (let i = 0; i + 1 < parts.length; i++) {
            const parent = parts[i]!, child = parts[i + 1]!
            if (child === parent || hasParent.has(child)) continue
            childrenMap.get(parent)!.push(child)
            hasParent.add(child)
            if (edgeText && i + 2 === parts.length) {
                const asNum = Number(edgeText)
                meta.set(child, Number.isFinite(asNum) ? { weight: asNum } : { edge: edgeText })
            }
        }
    }
    if (order.length === 0) throw new Error('Add at least one node or edge such as Root -> Child.')
    const rootId = order.find((id) => !hasParent.has(id)) ?? order[0]!
    const seen = new Set<string>()
    const buildNode = (id: string): TreeSpec => {
        seen.add(id)
        const kids = (childrenMap.get(id) ?? []).filter((child) => !seen.has(child)).map(buildNode)
        const info = meta.get(id)
        return {
            id,
            label: id,
            ...(info?.weight !== undefined ? { weight: info.weight } : {}),
            ...(info?.edge ? { edge: info.edge } : {}),
            ...(kids.length ? { children: kids } : {}),
        }
    }
    return buildNode(rootId)
}

function parseScatterPoints(source: string): ScatterPoint[] {
    return source.split(/[;\n]/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const parts = line.split(/[\s,]+/).filter(Boolean)
        const x = Number(parts[0]), y = Number(parts[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) return []
        const groupName = parts[2]
        const pointName = parts[3]
        return [{ x, y, ...(groupName ? { group: groupName } : {}), ...(pointName ? { name: pointName } : {}) }]
    })
}

function parseDotData(source: string): DotDatum[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const parts = line.split(':').map((part) => part.trim())
        const label = parts[0]
        const value = Number(parts[1])
        if (!label || !Number.isFinite(value)) return []
        const low = Number(parts[2]), high = Number(parts[3])
        const hasBand = parts.length >= 4 && Number.isFinite(low) && Number.isFinite(high)
        return [{ label, value, ...(hasBand ? { low: Math.min(low, high), high: Math.max(low, high) } : {}) }]
    })
}

function parseUnitGroups(source: string): UnitGroup[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const [label, rawCount, color] = line.split(':').map((part) => part.trim())
        const count = Math.max(0, Math.round(Number(rawCount)))
        if (!label || !Number.isFinite(count)) return []
        return [{ label, count, ...(color ? { color } : {}) }]
    })
}

function parseSegmentedParts(source: string): SegmentedBarPart[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const [name, rawVal, color] = line.split(':').map((part) => part.trim())
        const value = Number(rawVal)
        if (!name || !Number.isFinite(value) || value < 0) return []
        return [{ name, value, ...(color ? { color } : {}) }]
    })
}

function parseLanesEvents(source: string): LaneTimelineEvent[] {
    const events: LaneTimelineEvent[] = []
    for (const raw of source.split('\n')) {
        const entry = raw.trim()
        if (!entry) continue
        const colon = entry.indexOf(':')
        const head = (colon < 0 ? entry : entry.slice(0, colon)).trim()
        const label = colon < 0 ? undefined : entry.slice(colon + 1).trim() || undefined
        const handoff = /^(.+?)\s*->\s*(.+?)\s*@\s*([+-]?\d+(?:\.\d+)?)$/.exec(head)
        if (handoff) {
            events.push({ from: handoff[1]!.trim(), to: handoff[2]!.trim(), at: Number(handoff[3]), ...(label ? { label } : {}) })
            continue
        }
        const span = /^(.+?)\s+([+-]?\d+(?:\.\d+)?)\s*\.\.\s*([+-]?\d+(?:\.\d+)?)$/.exec(head)
        if (span) {
            const a = Number(span[2]), b = Number(span[3])
            if (b > a) events.push({ lane: span[1]!.trim(), start: a, end: b, ...(label ? { label } : {}) })
            continue
        }
        const mark = /^(.+?)\s*@\s*([+-]?\d+(?:\.\d+)?)$/.exec(head)
        if (mark) {
            events.push({ lane: mark[1]!.trim(), at: Number(mark[2]), ...(label ? { label } : {}) })
        }
    }
    return events
}

function parseQueueItems(source: string): QueueItem[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [id, rawWork, mode] = line.split(':').map((part) => part.trim())
        const work = Number(rawWork)
        return {
            id: id || 'R1',
            ...(Number.isFinite(work) && work >= 1 ? { work: Math.round(work) } : {}),
            ...(mode === 'running' ? { running: true } : {}),
        }
    })
}

function parseBitFields(source: string): BitFieldPart[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line) => {
        const [label, rawBits, color, value] = line.split(':').map((part) => part.trim())
        const bits = Math.round(Number(rawBits))
        if (!label || !Number.isFinite(bits) || bits < 1) return []
        return [{
            label,
            bits,
            ...(color ? { color } : {}),
            ...(value ? { value } : {}),
        }]
    })
}

const TABLE_VERDICTS = new Set(['pass', 'fail', 'warn', 'pending', 'skip'])

function parseTableData(columnsSource: string, rowsSource: string): { columns: string[]; rows: TableRow[] } {
    const columns = columnsSource.split(',').map((col) => col.trim()).filter(Boolean)
    const rows: TableRow[] = rowsSource.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
        const cells = line.split('|').map((cell) => cell.trim())
        const row: TableRow = { id: `r${index + 1}` }
        columns.forEach((col, colIndex) => {
            const token = cells[colIndex] ?? ''
            if (TABLE_VERDICTS.has(token)) {
                row[col] = { value: token, state: token }
            } else if (token !== '' && Number.isFinite(Number(token))) {
                row[col] = Number(token)
            } else {
                row[col] = token
            }
        })
        return row
    })
    return { columns, rows }
}

const LOG_VERDICTS = new Set(['stored', 'new', 'answered', 'waiting', 'failed'])

function parseEventLogRows(source: string): LogRow[] {
    return source.split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
        const parts = line.split('|').map((part) => part.trim())
        if (parts.length === 1) return { id: index + 1, name: parts[0]! }
        const idRaw = parts[0]!
        const idNum = Number(idRaw)
        const id = idRaw !== '' && Number.isFinite(idNum) ? idNum : idRaw || index + 1
        const name = parts[1] || `Event${index + 1}`
        const detail = parts[2] || undefined
        const state = parts[3] && LOG_VERDICTS.has(parts[3]) ? parts[3] : undefined
        return {
            id,
            name,
            ...(detail ? { detail } : {}),
            ...(state ? { state } : {}),
        }
    })
}

function parseTerminalLines(source: string): (string | TerminalLine)[] {
    return source.split('\n').filter((line) => line.trim().length > 0).map((line) => {
        if (line.startsWith('$ ')) return { text: line.slice(2), kind: 'command' as const }
        if (line.startsWith('# ')) return { text: line.slice(2), kind: 'note' as const }
        return line
    })
}

function parseLayerStackSpec(source: string): StackLayer[] {
    const out: StackLayer[] = []
    for (const raw of source.split('\n')) {
        const entry = raw.trim()
        if (!entry) continue
        const repeatMatch = /^repeat\s+(\d+)\s*:\s*(.+)$/i.exec(entry)
        if (repeatMatch) {
            const count = Math.max(2, Number(repeatMatch[1]))
            const sub = repeatMatch[2]!.split('|').map((part) => part.trim()).filter(Boolean).map((part) => {
                const blocks = part.split(',').map((b) => b.trim()).filter(Boolean)
                return blocks.length > 1 ? { branch: blocks } : blocks[0]!
            })
            if (sub.length) out.push({ repeat: count, layers: sub })
            continue
        }
        const branchMatch = /^branch\s*:\s*(.+)$/i.exec(entry)
        if (branchMatch) {
            const blocks = branchMatch[1]!.split(',').map((b) => b.trim()).filter(Boolean)
            if (blocks.length) out.push({ branch: blocks })
            continue
        }
        out.push(entry)
    }
    return out
}

const passageKind: KindDef = {
    kind: 'passage', label: 'Passage', group: 'Type', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['boxWidth'] }, pick: 'bounds',
    defaults: { body: 'Requests enter through an edge proxy, check policy in memory, and commit one durable event before answering.', title: 'architecture.md', boxWidth: 760, size: 28, panel: true },
    fields: [
        { key: 'body', label: 'Passage', type: 'longtext' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'boxWidth', label: 'Width', type: 'number', min: 200, max: 3000, step: 10 },
        { key: 'size', label: 'Size', type: 'number', min: 12, max: 96, step: 1 },
        { key: 'panel', label: 'Panel', type: 'bool' },
    ],
    build(p) {
        const body = String(p['body'] || '').trim()
        if (!body) throw new Error('Write at least one word in the passage.')
        return passage(body, {
            width: p['boxWidth'] as number, size: p['size'] as number, panel: p['panel'] as boolean,
            ...(p['title'] ? { title: String(p['title']) } : {}),
        })
    },
    code(p) {
        const body = String(p['body'] || '').trim()
        return {
            expr: call('passage', str(body), options([
                ['width', p['boxWidth'] as number], ['size', p['size'] as number], ['panel', p['panel'] as boolean],
                ['title', p['title'] ? String(p['title']) : undefined],
            ])),
        }
    },
}

const histogramKind: KindDef = {
    kind: 'histogram', label: 'Histogram', group: 'Data', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['chartWidth', 'chartHeight'] }, pick: 'bounds',
    defaults: { samples: '12 18 21 22 24 25 26 28 29 31 33 35 36 38 41 44 48 52', bins: 8, chartWidth: 840, chartHeight: 440, labelSize: 20, barColor: 'blue' },
    fields: [
        { key: 'samples', label: 'Samples', type: 'longtext', help: 'Numbers separated by spaces or commas' },
        { key: 'bins', label: 'Bins', type: 'number', min: 2, max: 80, step: 1 },
        { key: 'chartWidth', label: 'Width', type: 'number', min: 120, max: 4000, step: 10 },
        { key: 'chartHeight', label: 'Height', type: 'number', min: 80, max: 3000, step: 10 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'barColor', label: 'Color', type: 'color' },
    ],
    build(p) {
        const samples = parseNumbers(String(p['samples']))
        if (samples.length < 2) throw new Error('Add at least two numeric samples.')
        return histogram(samples, {
            bins: Math.round(p['bins'] as number), width: p['chartWidth'] as number, height: p['chartHeight'] as number,
            labelSize: p['labelSize'] as number, colors: [p['barColor'] as string],
        })
    },
    code(p) {
        const samples = parseNumbers(String(p['samples']))
        return {
            expr: call('histogram', literal(samples), literal({
                bins: Math.round(p['bins'] as number), width: p['chartWidth'] as number, height: p['chartHeight'] as number,
                labelSize: p['labelSize'] as number, colors: [p['barColor'] as string],
            })),
        }
    },
}

const scatterKind: KindDef = {
    kind: 'scatter', label: 'Scatter plot', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['chartWidth', 'chartHeight'] }, pick: 'bounds',
    defaults: { points: '1.2 2.4 fast\n2.1 3.1 fast\n1.8 2.8 fast\n4.2 1.5 batch\n4.8 2.1 batch\n5.2 1.8 batch', chartWidth: 840, chartHeight: 460, radius: 8, labelSize: 20, xLabel: 'Latency', yLabel: 'Cost', groupLabels: true },
    fields: [
        { key: 'points', label: 'Points', type: 'longtext', help: 'One "x y group name" per line' },
        { key: 'chartWidth', label: 'Width', type: 'number', min: 120, max: 4000, step: 10 },
        { key: 'chartHeight', label: 'Height', type: 'number', min: 80, max: 3000, step: 10 },
        { key: 'radius', label: 'Dot size', type: 'number', min: 2, max: 40, step: 1 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'xLabel', label: 'X label', type: 'text' },
        { key: 'yLabel', label: 'Y label', type: 'text' },
        { key: 'groupLabels', label: 'Group names', type: 'bool' },
    ],
    build(p) {
        const points = parseScatterPoints(String(p['points']))
        if (points.length < 2) throw new Error('Add at least two "x y" points.')
        return scatter(points, {
            width: p['chartWidth'] as number, height: p['chartHeight'] as number, radius: p['radius'] as number,
            labelSize: p['labelSize'] as number, groupLabels: p['groupLabels'] as boolean,
            ...(p['xLabel'] ? { xLabel: String(p['xLabel']) } : {}),
            ...(p['yLabel'] ? { yLabel: String(p['yLabel']) } : {}),
        })
    },
    code(p) {
        return {
            expr: call('scatter', literal(parseScatterPoints(String(p['points']))), options([
                ['width', p['chartWidth'] as number], ['height', p['chartHeight'] as number], ['radius', p['radius'] as number],
                ['labelSize', p['labelSize'] as number], ['groupLabels', p['groupLabels'] as boolean],
                ['xLabel', p['xLabel'] ? String(p['xLabel']) : undefined],
                ['yLabel', p['yLabel'] ? String(p['yLabel']) : undefined],
            ])),
        }
    },
}

const dotChartKind: KindDef = {
    kind: 'dotChart', label: 'Dot chart', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['chartWidth'] }, pick: 'bounds',
    defaults: { data: 'Baseline: 62: 57: 67\nCached: 79: 75: 83\nBatched: 92: 89: 95', chartWidth: 780, labelSize: 22, dotColor: 'blue', xLabel: 'Score', grid: true },
    fields: [
        { key: 'data', label: 'Rows', type: 'longtext', help: 'One "label: value" or "label: value: low: high" per line' },
        { key: 'chartWidth', label: 'Axis width', type: 'number', min: 120, max: 4000, step: 10 },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
        { key: 'dotColor', label: 'Color', type: 'color' },
        { key: 'xLabel', label: 'Axis label', type: 'text' },
        { key: 'grid', label: 'Grid', type: 'bool' },
    ],
    build(p) {
        const rows = parseDotData(String(p['data']))
        if (rows.length === 0) throw new Error('Add at least one "label: value" row.')
        return dotChart(rows, {
            width: p['chartWidth'] as number, labelSize: p['labelSize'] as number, dotColor: p['dotColor'] as string, grid: p['grid'] as boolean,
            ...(p['xLabel'] ? { xLabel: String(p['xLabel']) } : {}),
        })
    },
    code(p) {
        return {
            expr: call('dotChart', literal(parseDotData(String(p['data']))), options([
                ['width', p['chartWidth'] as number], ['labelSize', p['labelSize'] as number], ['dotColor', p['dotColor'] as string], ['grid', p['grid'] as boolean],
                ['xLabel', p['xLabel'] ? String(p['xLabel']) : undefined],
            ])),
        }
    },
}

const unitChartKind: KindDef = {
    kind: 'unitChart', label: 'Unit chart', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['cell'] }, pick: 'bounds',
    defaults: { groups: 'Passed: 36: teal\nRetried: 8: yellow\nFailed: 2: red', rows: 6, cell: 18, shape: 'dot', split: true, mixed: false, labelSize: 24 },
    fields: [
        { key: 'groups', label: 'Groups', type: 'longtext', help: 'One "label: count: color" per line' },
        { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 50, step: 1 },
        { key: 'cell', label: 'Mark size', type: 'number', min: 4, max: 120, step: 1 },
        { key: 'shape', label: 'Shape', type: 'select', options: [['dot', 'Dot'], ['square', 'Square']] },
        { key: 'split', label: 'Split blocks', type: 'bool' },
        { key: 'mixed', label: 'Shuffle', type: 'bool' },
        { key: 'labelSize', label: 'Labels', type: 'number', min: 8, max: 80, step: 1 },
    ],
    build(p) {
        const groups = parseUnitGroups(String(p['groups']))
        if (groups.length === 0) throw new Error('Add at least one "label: count" group.')
        const split = Boolean(p['split']) && !p['mixed']
        return unitChart(groups, {
            rows: Math.round(p['rows'] as number), cell: p['cell'] as number, shape: p['shape'] as 'dot',
            split, mixed: Boolean(p['mixed']), labelSize: p['labelSize'] as number,
        })
    },
    code(p) {
        const split = Boolean(p['split']) && !p['mixed']
        return {
            expr: call('unitChart', literal(parseUnitGroups(String(p['groups']))), options([
                ['rows', Math.round(p['rows'] as number)], ['cell', p['cell'] as number], ['shape', p['shape'] as string],
                ['split', split], ['mixed', Boolean(p['mixed'])], ['labelSize', p['labelSize'] as number],
            ])),
        }
    },
}

const segmentedBarKind: KindDef = {
    kind: 'segmentedBar', label: 'Segmented bar', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['barWidth'] }, pick: 'bounds',
    defaults: { parts: 'System: 1800: blue\nHistory: 6400: teal\nTools: 2200: yellow', barWidth: 1100, capacity: 16000, title: 'Context window', free: 'free', size: 26 },
    fields: [
        { key: 'parts', label: 'Parts', type: 'longtext', help: 'One "name: amount: color" per line' },
        { key: 'barWidth', label: 'Width', type: 'number', min: 240, max: 4000, step: 10 },
        { key: 'capacity', label: 'Capacity', type: 'number', min: 0, max: 1e9, step: 100, help: '0 uses sum of parts' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'free', label: 'Free label', type: 'text' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 80, step: 1 },
    ],
    build(p) {
        const parts = parseSegmentedParts(String(p['parts']))
        if (parts.length === 0) throw new Error('Add at least one "name: amount" part.')
        const capacity = Number(p['capacity'])
        return segmentedBar(parts, {
            width: p['barWidth'] as number, size: p['size'] as number,
            ...(capacity > 0 ? { capacity } : {}),
            ...(p['title'] ? { title: String(p['title']) } : {}),
            ...(p['free'] && capacity > 0 ? { free: String(p['free']) } : {}),
        })
    },
    code(p) {
        const capacity = Number(p['capacity'])
        return {
            expr: call('segmentedBar', literal(parseSegmentedParts(String(p['parts']))), options([
                ['width', p['barWidth'] as number], ['size', p['size'] as number],
                ['capacity', capacity > 0 ? capacity : undefined],
                ['title', p['title'] ? String(p['title']) : undefined],
                ['free', p['free'] && capacity > 0 ? String(p['free']) : undefined],
            ])),
        }
    },
}

const tableKind: KindDef = {
    kind: 'table', label: 'Table', group: 'Data', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { columns: 'Case, Baseline, Candidate, Score', rows: 'Auth check | pass | pass | 0.98\nRetry storm | fail | pass | 0.95\nCold start | warn | pass | 0.91', tableWidth: 0, size: 26 },
    fields: [
        { key: 'columns', label: 'Columns', type: 'text', help: 'Comma-separated column headers' },
        { key: 'rows', label: 'Rows', type: 'longtext', help: 'Pipe-separated cells per line. pass/fail/warn/pending/skip show status marks' },
        { key: 'tableWidth', label: 'Width', type: 'number', min: 0, max: 4000, step: 10, help: '0 fits columns' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 80, step: 1 },
    ],
    build(p) {
        const { columns, rows } = parseTableData(String(p['columns']), String(p['rows']))
        if (columns.length === 0 || rows.length === 0) throw new Error('Add at least one column and one row.')
        const width = Number(p['tableWidth'])
        return table(columns, rows, { size: p['size'] as number, ...(width > 0 ? { width } : {}) })
    },
    code(p) {
        const { columns, rows } = parseTableData(String(p['columns']), String(p['rows']))
        const width = Number(p['tableWidth'])
        return {
            expr: call('table', literal(columns), literal(rows), options([
                ['size', p['size'] as number], ['width', width > 0 ? width : undefined],
            ])),
        }
    },
}

const connectorKind: KindDef = {
    kind: 'connector', label: 'Connector', group: 'System', entrance: 'draw',
    resize: { type: 'props', keys: ['dx', 'dy'] }, pick: 'shape',
    defaults: { dx: 380, dy: 120, route: 'ortho', color: 'teal', width: 2.5, label: 'rpc', dashed: false, both: false },
    fields: [
        { key: 'dx', label: 'Span X', type: 'number', min: -4000, max: 4000, step: 10 },
        { key: 'dy', label: 'Span Y', type: 'number', min: -3000, max: 3000, step: 10 },
        { key: 'route', label: 'Route', type: 'select', options: [['ortho', 'Orthogonal'], ['curve', 'Curved'], ['straight', 'Straight']] },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'width', label: 'Width', type: 'number', min: 0.5, max: 20, step: 0.5 },
        { key: 'label', label: 'Label', type: 'text' },
        { key: 'dashed', label: 'Dashed', type: 'bool' },
        { key: 'both', label: 'Two heads', type: 'bool' },
    ],
    build(p) {
        const hx = (p['dx'] as number) / 2, hy = (p['dy'] as number) / 2
        const a = rect(1, 1, { stroke: null }).at(-hx, -hy)
        const b = rect(1, 1, { stroke: null }).at(hx, hy)
        const wire = connector(a, b, {
            gap: 0, route: p['route'] as 'ortho', color: p['color'] as string, width: p['width'] as number,
            ...(p['label'] ? { label: String(p['label']) } : {}),
            ...(p['dashed'] ? { dash: [8, 6] } : {}),
            ...(p['both'] ? { both: true } : {}),
        })
        return group(a, b, wire)
    },
    code(p, ctx) {
        const hx = (p['dx'] as number) / 2, hy = (p['dy'] as number) / 2
        const wireOpts = options([
            ['gap', 0], ['route', p['route'] as string], ['color', p['color'] as string], ['width', p['width'] as number],
            ['label', p['label'] ? String(p['label']) : undefined],
            ['dash', p['dashed'] ? [8, 6] : undefined],
            ['both', p['both'] ? true : undefined],
        ])
        const from = ctx.identifier('From'), to = ctx.identifier('To')
        const setup = [
            `const ${from} = rect(1, 1, { stroke: null }).at(${num(-hx)}, ${num(-hy)})`,
            `const ${to} = rect(1, 1, { stroke: null }).at(${num(hx)}, ${num(hy)})`,
            `const ${ctx.name} = group(${from}, ${to}, ${call('connector', from, to, wireOpts)})`,
        ]
        return { setup, expr: ctx.name }
    },
}

const zoneKind: KindDef = {
    kind: 'zone', label: 'Zone', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['zoneWidth', 'zoneHeight'] }, pick: 'shape',
    defaults: { title: 'Sandbox boundary', titleAlign: 'left', zoneWidth: 560, zoneHeight: 320, titleSize: 24, color: 'yellow', dashed: true, fill: null, fillOpacity: 0.08 },
    fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'titleAlign', label: 'Title align', type: 'select', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
        { key: 'zoneWidth', label: 'Width', type: 'number', min: 80, max: 4000, step: 10 },
        { key: 'zoneHeight', label: 'Height', type: 'number', min: 60, max: 3000, step: 10 },
        { key: 'titleSize', label: 'Title size', type: 'number', min: 10, max: 80, step: 1 },
        { key: 'color', label: 'Border', type: 'color' },
        { key: 'dashed', label: 'Dashed', type: 'bool' },
        { key: 'fill', label: 'Backdrop', type: 'color', nullable: true },
        { key: 'fillOpacity', label: 'Backdrop alpha', type: 'number', min: 0.02, max: 0.6, step: 0.02 },
    ],
    build(p) {
        const w = Math.max(40, p['zoneWidth'] as number), h = Math.max(40, p['zoneHeight'] as number)
        return zone(rect(w, h, { stroke: null }), {
            padding: 0, titleAlign: p['titleAlign'] as 'left', titleSize: p['titleSize'] as number, color: p['color'] as string,
            ...(p['title'] ? { title: String(p['title']) } : {}),
            ...(p['dashed'] ? { dash: true } : {}),
            ...(p['fill'] ? { fill: p['fill'] as string, fillOpacity: p['fillOpacity'] as number } : {}),
        })
    },
    code(p) {
        const w = Math.max(40, p['zoneWidth'] as number), h = Math.max(40, p['zoneHeight'] as number)
        return {
            expr: call('zone', `rect(${num(w)}, ${num(h)}, { stroke: null })`, options([
                ['padding', 0], ['titleAlign', p['titleAlign'] as string], ['titleSize', p['titleSize'] as number], ['color', p['color'] as string],
                ['title', p['title'] ? String(p['title']) : undefined],
                ['dash', p['dashed'] ? true : undefined],
                ['fill', p['fill'] ? String(p['fill']) : undefined],
                ['fillOpacity', p['fill'] ? (p['fillOpacity'] as number) : undefined],
            ])),
        }
    },
}

const realCardKind: KindDef = {
    kind: 'card', label: 'Concept card', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['cardWidth'] }, pick: 'bounds',
    defaults: { title: 'Event log', icon: 'logs', caption: 'Append-only stream of durable facts', cardWidth: 420, iconSize: 108, accent: 'teal' },
    fields: [
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'icon', label: 'Pictogram', type: 'select', options: PICTOGRAM_OPTIONS },
        { key: 'caption', label: 'Caption', type: 'longtext' },
        { key: 'cardWidth', label: 'Width', type: 'number', min: 180, max: 2000, step: 10 },
        { key: 'iconSize', label: 'Icon size', type: 'number', min: 36, max: 360, step: 4 },
        { key: 'accent', label: 'Accent', type: 'color' },
    ],
    build(p) {
        const fig = pictogram(p['icon'] as PictogramName, { size: p['iconSize'] as number, color: 'dim', accent: p['accent'] as string })
        return card({
            width: p['cardWidth'] as number, color: p['accent'] as string, figure: fig,
            ...(p['title'] ? { title: String(p['title']) } : {}),
            ...(p['caption'] ? { caption: String(p['caption']) } : {}),
        })
    },
    code(p) {
        const figCode = call('pictogram', str(p['icon'] as string), options([['size', p['iconSize'] as number], ['color', 'dim'], ['accent', p['accent'] as string]]))
        const parts = [`width: ${num(p['cardWidth'] as number)}`, `color: ${str(p['accent'] as string)}`, `figure: ${figCode}`]
        if (p['title']) parts.push(`title: ${str(String(p['title']))}`)
        if (p['caption']) parts.push(`caption: ${str(String(p['caption']))}`)
        return { expr: `card({ ${parts.join(', ')} })` }
    },
}

const pictogramKind: KindDef = {
    kind: 'pictogram', label: 'Pictogram', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { icon: 'database', size: 120, color: 'ink', accent: 'teal', weight: 1.6 },
    fields: [
        { key: 'icon', label: 'Icon', type: 'select', options: PICTOGRAM_OPTIONS },
        { key: 'size', label: 'Size', type: 'number', min: 24, max: 600, step: 4 },
        { key: 'color', label: 'Line color', type: 'color' },
        { key: 'accent', label: 'Accent', type: 'color' },
        { key: 'weight', label: 'Weight', type: 'number', min: 0.6, max: 4, step: 0.1 },
    ],
    build(p) {
        return pictogram(p['icon'] as PictogramName, {
            size: p['size'] as number, color: p['color'] as string, accent: p['accent'] as string, weight: p['weight'] as number,
        })
    },
    code(p) {
        return {
            expr: call('pictogram', str(p['icon'] as string), options([
                ['size', p['size'] as number], ['color', p['color'] as string], ['accent', p['accent'] as string], ['weight', p['weight'] as number],
            ])),
        }
    },
}

const stepsKind: KindDef = {
    kind: 'steps', label: 'Steps', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['stripWidth'] }, pick: 'bounds',
    defaults: { items: 'Parse\nPlan\nExecute\nVerify', stripWidth: 1200, direction: 'row', numbered: true, current: 1, size: 28, color: 'blue' },
    fields: [
        { key: 'items', label: 'Steps', type: 'longtext', help: 'One step per line, or "Label: short note"' },
        { key: 'stripWidth', label: 'Width', type: 'number', min: 200, max: 4000, step: 10 },
        { key: 'direction', label: 'Layout', type: 'select', options: [['row', 'Row'], ['column', 'Column']] },
        { key: 'numbered', label: 'Numbered', type: 'bool' },
        { key: 'current', label: 'Active step', type: 'number', min: -1, max: 40, step: 1, help: '0-based index, or -1 for none' },
        { key: 'size', label: 'Text size', type: 'number', min: 12, max: 80, step: 1 },
        { key: 'color', label: 'Accent', type: 'color' },
    ],
    build(p) {
        const items = parseSteps(String(p['items']))
        if (items.length === 0) throw new Error('Add at least one step.')
        const rawCur = Math.round(Number(p['current']))
        const current = rawCur < 0 ? null : Math.min(items.length - 1, rawCur)
        return steps(items, {
            width: p['stripWidth'] as number, direction: p['direction'] as 'row', numbered: p['numbered'] as boolean,
            current, size: p['size'] as number, color: p['color'] as string,
        })
    },
    code(p) {
        const items = parseSteps(String(p['items']))
        const rawCur = Math.round(Number(p['current']))
        const current = rawCur < 0 ? null : Math.min(items.length - 1, rawCur)
        return {
            expr: call('steps', literal(items), options([
                ['width', p['stripWidth'] as number], ['direction', p['direction'] as string], ['numbered', p['numbered'] as boolean],
                ['current', current], ['size', p['size'] as number], ['color', p['color'] as string],
            ])),
        }
    },
}

const treeKind: KindDef = {
    kind: 'tree', label: 'Tree', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'scale' }, pick: 'bounds',
    defaults: { edges: 'Prompt -> Plan: 0.7\nPrompt -> Direct: 0.3\nPlan -> Tool: 0.8\nPlan -> Draft: 0.2', direction: 'down', shape: 'box', nodeColor: 'blue', edgeColor: 'dim' },
    fields: [
        { key: 'edges', label: 'Branches', type: 'longtext', help: 'One "Parent -> Child: label" per line' },
        { key: 'direction', label: 'Direction', type: 'select', options: [['down', 'Top down'], ['right', 'Left to right']] },
        { key: 'shape', label: 'Nodes', type: 'select', options: [['box', 'Boxes'], ['circle', 'Circles']] },
        { key: 'nodeColor', label: 'Node color', type: 'color' },
        { key: 'edgeColor', label: 'Edge color', type: 'color' },
    ],
    build(p) {
        const spec = parseTree(String(p['edges']))
        return tree(spec, {
            direction: p['direction'] as 'down', shape: p['shape'] as 'box',
            nodeColor: p['nodeColor'] as string, edgeColor: p['edgeColor'] as string,
        })
    },
    code(p) {
        return {
            expr: call('tree', literal(parseTree(String(p['edges']))), options([
                ['direction', p['direction'] as string], ['shape', p['shape'] as string],
                ['nodeColor', p['nodeColor'] as string], ['edgeColor', p['edgeColor'] as string],
            ])),
        }
    },
}

const lanesKind: KindDef = {
    kind: 'lanes', label: 'Swimlanes', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['laneWidth'] }, pick: 'bounds',
    defaults: { actors: 'Client, Gateway, Worker', events: 'Client 0..18: request\nClient -> Gateway @ 18: HTTPS\nGateway 18..46: auth\nGateway -> Worker @ 46: rpc\nWorker 46..90: compute', laneWidth: 1100, ticks: 5, size: 24 },
    fields: [
        { key: 'actors', label: 'Lanes', type: 'text', help: 'Comma-separated actor names' },
        { key: 'events', label: 'Events', type: 'longtext', help: '"Lane a..b: span" or "From -> To @ t: handoff"' },
        { key: 'laneWidth', label: 'Width', type: 'number', min: 240, max: 4000, step: 10 },
        { key: 'ticks', label: 'Ticks', type: 'number', min: 0, max: 20, step: 1, help: '0 hides time axis' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 60, step: 1 },
    ],
    build(p) {
        const actors = String(p['actors']).split(',').map((s) => s.trim()).filter(Boolean)
        const events = parseLanesEvents(String(p['events']))
        if (actors.length === 0 || events.length === 0) throw new Error('Add lane names and at least one span or handoff.')
        const ticks = Math.round(Number(p['ticks']))
        return lanes(actors, events, {
            width: p['laneWidth'] as number, size: p['size'] as number,
            ...(ticks > 0 ? { ticks } : {}),
        })
    },
    code(p) {
        const actors = String(p['actors']).split(',').map((s) => s.trim()).filter(Boolean)
        const events = parseLanesEvents(String(p['events']))
        const ticks = Math.round(Number(p['ticks']))
        return {
            expr: call('lanes', literal(actors), literal(events), options([
                ['width', p['laneWidth'] as number], ['size', p['size'] as number],
                ['ticks', ticks > 0 ? ticks : undefined],
            ])),
        }
    },
}

const pipelineKind: KindDef = {
    kind: 'pipeline', label: 'Pipeline', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['pipeWidth'] }, pick: 'bounds',
    defaults: { stages: 'Ingest, Validate, Authorize, Execute', pipeWidth: 1280, gates: true, counts: true, size: 26, color: 'blue' },
    fields: [
        { key: 'stages', label: 'Stages', type: 'text', help: 'Comma-separated stage names' },
        { key: 'pipeWidth', label: 'Width', type: 'number', min: 240, max: 4000, step: 10 },
        { key: 'gates', label: 'Gate diamonds', type: 'bool' },
        { key: 'counts', label: 'Counts', type: 'bool' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 72, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        const stageList = String(p['stages']).split(',').map((s) => s.trim()).filter(Boolean)
        if (stageList.length < 2) throw new Error('A pipeline needs at least two stages.')
        return pipeline(stageList, {
            width: p['pipeWidth'] as number, gates: p['gates'] as boolean, counts: p['counts'] as boolean,
            size: p['size'] as number, color: p['color'] as string,
        })
    },
    code(p) {
        const stageList = String(p['stages']).split(',').map((s) => s.trim()).filter(Boolean)
        return {
            expr: call('pipeline', literal(stageList), options([
                ['width', p['pipeWidth'] as number], ['gates', p['gates'] as boolean], ['counts', p['counts'] as boolean],
                ['size', p['size'] as number], ['color', p['color'] as string],
            ])),
        }
    },
}

const requestQueueKind: KindDef = {
    kind: 'requestQueue', label: 'Request queue', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['queueWidth'] }, pick: 'bounds',
    defaults: { items: 'R1: 2: running\nR2: 4: running\nR3: 3\nR4: 5\nR5: 2', slots: 2, queueWidth: 1200, counts: true, size: 26, color: 'blue' },
    fields: [
        { key: 'items', label: 'Requests', type: 'longtext', help: 'One "id: work" or "id: work: running" per line' },
        { key: 'slots', label: 'Worker slots', type: 'number', min: 1, max: 16, step: 1 },
        { key: 'queueWidth', label: 'Width', type: 'number', min: 320, max: 4000, step: 10 },
        { key: 'counts', label: 'Counts', type: 'bool' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 72, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        const items = parseQueueItems(String(p['items']))
        return requestQueue(items, {
            slots: Math.round(p['slots'] as number), width: p['queueWidth'] as number,
            counts: p['counts'] as boolean, size: p['size'] as number, color: p['color'] as string,
        })
    },
    code(p) {
        return {
            expr: call('requestQueue', literal(parseQueueItems(String(p['items']))), options([
                ['slots', Math.round(p['slots'] as number)], ['width', p['queueWidth'] as number],
                ['counts', p['counts'] as boolean], ['size', p['size'] as number], ['color', p['color'] as string],
            ])),
        }
    },
}

const ringBufferKind: KindDef = {
    kind: 'ringBuffer', label: 'Ring buffer', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['radius'] }, pick: 'bounds',
    defaults: { capacity: 8, radius: 170, label: 'submission ring', color: 'blue', counts: true, numbers: true, size: 24 },
    fields: [
        { key: 'capacity', label: 'Slots', type: 'number', min: 2, max: 32, step: 1 },
        { key: 'radius', label: 'Radius', type: 'number', min: 50, max: 800, step: 5 },
        { key: 'label', label: 'Caption', type: 'text' },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'counts', label: 'Pointer counts', type: 'bool' },
        { key: 'numbers', label: 'Slot numbers', type: 'bool' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 64, step: 1 },
    ],
    build(p) {
        return ringBuffer(Math.round(p['capacity'] as number), {
            radius: p['radius'] as number, color: p['color'] as string, counts: p['counts'] as boolean,
            numbers: p['numbers'] as boolean, size: p['size'] as number,
            ...(p['label'] ? { label: String(p['label']) } : {}),
        })
    },
    code(p) {
        return {
            expr: call('ringBuffer', num(Math.round(p['capacity'] as number)), options([
                ['radius', p['radius'] as number], ['color', p['color'] as string], ['counts', p['counts'] as boolean],
                ['numbers', p['numbers'] as boolean], ['size', p['size'] as number],
                ['label', p['label'] ? String(p['label']) : undefined],
            ])),
        }
    },
}

const bitFieldKind: KindDef = {
    kind: 'bitField', label: 'Bit field', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['fieldWidth'] }, pick: 'bounds',
    defaults: { parts: 'dir: 10: blue\ntable: 10: teal\noffset: 12: yellow', fieldWidth: 1120, scale: 'proportional', numbers: 'bits', size: 26, color: 'blue' },
    fields: [
        { key: 'parts', label: 'Fields', type: 'longtext', help: 'One "label: bits: color: value" per line' },
        { key: 'fieldWidth', label: 'Width', type: 'number', min: 240, max: 4000, step: 10 },
        { key: 'scale', label: 'Sizing', type: 'select', options: [['proportional', 'By bit width'], ['even', 'Equal boxes']] },
        { key: 'numbers', label: 'Ruler', type: 'select', options: [['bits', 'Bit indices'], ['offsets', 'Byte offsets'], ['none', 'Hidden']] },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 64, step: 1 },
        { key: 'color', label: 'Default color', type: 'color' },
    ],
    build(p) {
        const parts = parseBitFields(String(p['parts']))
        if (parts.length === 0) throw new Error('Add at least one "label: bits" field.')
        const numbers = p['numbers'] === 'none' ? false : (p['numbers'] as 'bits' | 'offsets')
        return bitField(parts, {
            width: p['fieldWidth'] as number, scale: p['scale'] as 'proportional', numbers,
            size: p['size'] as number, color: p['color'] as string,
        })
    },
    code(p) {
        const numbers = p['numbers'] === 'none' ? false : (p['numbers'] as string)
        return {
            expr: call('bitField', literal(parseBitFields(String(p['parts']))), options([
                ['width', p['fieldWidth'] as number], ['scale', p['scale'] as string], ['numbers', numbers],
                ['size', p['size'] as number], ['color', p['color'] as string],
            ])),
        }
    },
}

const stateGridKind: KindDef = {
    kind: 'stateGrid', label: 'State grid', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['cell'] }, pick: 'bounds',
    defaults: { columns: 12, rows: 6, cell: 32, initial: 'present' },
    fields: [
        { key: 'columns', label: 'Columns', type: 'number', min: 1, max: 64, step: 1 },
        { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 64, step: 1 },
        { key: 'cell', label: 'Cell size', type: 'number', min: 6, max: 160, step: 2 },
        { key: 'initial', label: 'State', type: 'select', options: [['absent', 'Absent'], ['zero', 'Zero'], ['present', 'Present'], ['dirty', 'Dirty'], ['shared', 'Shared'], ['copied', 'Copied'], ['file', 'File'], ['swapped', 'Swapped']] },
    ],
    build(p) {
        return stateGrid({
            columns: Math.round(p['columns'] as number), rows: Math.round(p['rows'] as number),
            cell: p['cell'] as number, initial: p['initial'] as string,
        })
    },
    code(p) {
        return {
            expr: call('stateGrid', options([
                ['columns', Math.round(p['columns'] as number)], ['rows', Math.round(p['rows'] as number)],
                ['cell', p['cell'] as number], ['initial', p['initial'] as string],
            ])),
        }
    },
}

const eventLogKind: KindDef = {
    kind: 'eventLog', label: 'Event log', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['logWidth'] }, pick: 'bounds',
    defaults: { rows: '1 | WorkflowStarted | run_42 | stored\n2 | ActivityScheduled | fetch_doc | answered\n3 | ModelCompleted | 412 tok | answered\n4 | ToolCallWaiting | sql_query | waiting', title: 'event history', logWidth: 720, visible: 6, size: 22 },
    fields: [
        { key: 'rows', label: 'Events', type: 'longtext', help: 'One "id | name | detail | state" per line (stored/new/answered/waiting/failed)' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'logWidth', label: 'Width', type: 'number', min: 280, max: 3000, step: 10 },
        { key: 'visible', label: 'Visible rows', type: 'number', min: 2, max: 30, step: 1 },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 60, step: 1 },
    ],
    build(p) {
        const rows = parseEventLogRows(String(p['rows']))
        if (rows.length === 0) throw new Error('Add at least one event row.')
        return eventLog(rows, {
            width: p['logWidth'] as number, visible: Math.round(p['visible'] as number), size: p['size'] as number,
            ...(p['title'] ? { title: String(p['title']) } : {}),
        })
    },
    code(p) {
        return {
            expr: call('eventLog', literal(parseEventLogRows(String(p['rows']))), options([
                ['width', p['logWidth'] as number], ['visible', Math.round(p['visible'] as number)], ['size', p['size'] as number],
                ['title', p['title'] ? String(p['title']) : undefined],
            ])),
        }
    },
}

const terminalKind: KindDef = {
    kind: 'terminal', label: 'Terminal', group: 'System', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { lines: '$ vizmatic check film.ts\n0 errors, 0 warnings\n$ vizmatic render film.ts -o out.mp4\n# Rendered 420 frames at 30 fps', title: 'bash', note: 'linux-arm64', size: 24 },
    fields: [
        { key: 'lines', label: 'Transcript', type: 'longtext', help: 'Prefix commands with "$ " and dim notes with "# "' },
        { key: 'title', label: 'Title', type: 'text' },
        { key: 'note', label: 'Note', type: 'text' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 72, step: 1 },
    ],
    build(p) {
        const lines = parseTerminalLines(String(p['lines']))
        if (lines.length === 0) throw new Error('Add at least one terminal line.')
        return terminal(lines, {
            size: p['size'] as number, clip: true,
            ...(p['title'] ? { title: String(p['title']) } : {}),
            ...(p['note'] ? { note: String(p['note']) } : {}),
        })
    },
    code(p) {
        return {
            expr: call('terminal', literal(parseTerminalLines(String(p['lines']))), options([
                ['size', p['size'] as number], ['clip', true],
                ['title', p['title'] ? String(p['title']) : undefined],
                ['note', p['note'] ? String(p['note']) : undefined],
            ])),
        }
    },
}

const layerStackKind: KindDef = {
    kind: 'layerStack', label: 'Layer stack', group: 'System', enters: true, entrance: 'enter',
    resize: { type: 'props', keys: ['size'] }, pick: 'bounds',
    defaults: { layers: 'embed\nrepeat 12: norm, attention | norm, MLP\nunembed', size: 24, color: 'blue' },
    fields: [
        { key: 'layers', label: 'Layers', type: 'longtext', help: 'Block names, "branch: a, b", or "repeat N: a, b | c, d"' },
        { key: 'size', label: 'Text size', type: 'number', min: 10, max: 64, step: 1 },
        { key: 'color', label: 'Color', type: 'color' },
    ],
    build(p) {
        const layers = parseLayerStackSpec(String(p['layers']))
        if (layers.length === 0) throw new Error('Add at least one layer.')
        return layerStack(layers, { size: p['size'] as number, color: p['color'] as string })
    },
    code(p) {
        return {
            expr: call('layerStack', literal(parseLayerStackSpec(String(p['layers']))), options([
                ['size', p['size'] as number], ['color', p['color'] as string],
            ])),
        }
    },
}

const sphereKind: KindDef = {
    kind: 'sphere3d', label: '3D sphere', group: '3D', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['unit'] }, pick: 'bounds',
    defaults: { radius: 2, unit: 120, phi: 64, theta: -36, spin: 0.16, axes: true, mesh: true, colorA: 'blue', colorB: 'teal', colorC: 'yellow' },
    fields: [
        { key: 'radius', label: 'Radius', type: 'number', min: 0.2, max: 20, step: 0.1 },
        { key: 'unit', label: 'Scale', type: 'number', min: 8, max: 600, step: 2 },
        { key: 'phi', label: 'Tilt', type: 'number', min: 0, max: 180, step: 1 },
        { key: 'theta', label: 'Turn', type: 'number', min: -720, max: 720, step: 1 },
        { key: 'spin', label: 'Spin', type: 'number', min: -3, max: 3, step: 0.01 },
        { key: 'axes', label: 'Axes', type: 'bool' },
        { key: 'mesh', label: 'Mesh', type: 'bool' },
        { key: 'colorA', label: 'South', type: 'color' },
        { key: 'colorB', label: 'Equator', type: 'color' },
        { key: 'colorC', label: 'North', type: 'color' },
    ],
    build(p) {
        const r = p['radius'] as number
        const extent = r * 1.4
        const scene = scene3d({ phi: (p['phi'] as number) * Math.PI / 180, theta: (p['theta'] as number) * Math.PI / 180, unit: p['unit'] as number })
        scene.add(sphere(r, { colors: [p['colorA'] as string, p['colorB'] as string, p['colorC'] as string], ...(p['mesh'] ? {} : { mesh: false }) }))
        if (p['axes']) scene.add(axes3d({ x: [-extent, extent], y: [-extent, extent], z: [-extent, extent] }))
        if (p['spin']) scene.spin(p['spin'] as number)
        return scene
    },
    code(p, ctx) {
        const r = p['radius'] as number
        const extent = r * 1.4
        const setup = [
            `const ${ctx.name} = scene3d({ phi: ${num(p['phi'] as number)} * Math.PI / 180, theta: ${num(p['theta'] as number)} * Math.PI / 180, unit: ${num(p['unit'] as number)} })`,
            `${ctx.name}.add(sphere(${num(r)}, ${literal({ colors: [p['colorA'], p['colorB'], p['colorC']], ...(p['mesh'] ? {} : { mesh: false }) })}))`,
        ]
        if (p['axes']) setup.push(`${ctx.name}.add(axes3d(${options([['x', [-extent, extent]], ['y', [-extent, extent]], ['z', [-extent, extent]]])}))`)
        if (p['spin']) setup.push(`${ctx.name}.spin(${num(p['spin'] as number)})`)
        return { setup, expr: ctx.name }
    },
}

const curve3dKind: KindDef = {
    kind: 'curve3d', label: '3D curve', group: '3D', entrance: 'fadeIn',
    resize: { type: 'props', keys: ['unit'] }, pick: 'bounds',
    defaults: { fx: '2 * cos(u)', fy: '2 * sin(u)', fz: '0.32 * u', uMin: -6.28, uMax: 6.28, unit: 110, phi: 64, theta: -38, spin: 0.16, axes: true, color: 'yellow', width: 4, halo: true },
    fields: [
        { key: 'fx', label: 'x(u) =', type: 'expr', scope: ['u'] },
        { key: 'fy', label: 'y(u) =', type: 'expr', scope: ['u'] },
        { key: 'fz', label: 'z(u) =', type: 'expr', scope: ['u'] },
        { key: 'uMin', label: 'u from', type: 'number', min: -1000, max: 1000, step: 0.25 },
        { key: 'uMax', label: 'u to', type: 'number', min: -1000, max: 1000, step: 0.25 },
        { key: 'unit', label: 'Scale', type: 'number', min: 8, max: 600, step: 2 },
        { key: 'phi', label: 'Tilt', type: 'number', min: 0, max: 180, step: 1 },
        { key: 'theta', label: 'Turn', type: 'number', min: -720, max: 720, step: 1 },
        { key: 'spin', label: 'Spin', type: 'number', min: -3, max: 3, step: 0.01 },
        { key: 'axes', label: 'Axes', type: 'bool' },
        { key: 'color', label: 'Color', type: 'color' },
        { key: 'width', label: 'Width', type: 'number', min: 1, max: 20, step: 0.5 },
        { key: 'halo', label: 'Halo', type: 'bool' },
    ],
    build(p, ctx) {
        const [u0, u1] = ascending(p['uMin'] as number, p['uMax'] as number)
        const scope = ['u', ...ctx.values.keys()]
        const fx = parseExpr(String(p['fx'] || '0'), scope)
        const fy = parseExpr(String(p['fy'] || '0'), scope)
        const fz = parseExpr(String(p['fz'] || '0'), scope)
        const scene = scene3d({ phi: (p['phi'] as number) * Math.PI / 180, theta: (p['theta'] as number) * Math.PI / 180, unit: p['unit'] as number })
        scene.add(curve3d((u) => {
            const env = exprEnv(ctx, { u })
            return [fx.run(env), fy.run(env), fz.run(env)]
        }, u0, u1, { color: p['color'] as string, width: p['width'] as number, halo: p['halo'] as boolean }))
        if (p['axes']) scene.add(axes3d({ x: [-3, 3], y: [-3, 3], z: [-2.5, 2.5] }))
        if (p['spin']) scene.spin(p['spin'] as number)
        return scene
    },
    code(p, ctx) {
        const [u0, u1] = ascending(p['uMin'] as number, p['uMax'] as number)
        const scope = ['u', ...ctx.variables]
        const fx = parseExpr(String(p['fx'] || '0'), scope)
        const fy = parseExpr(String(p['fy'] || '0'), scope)
        const fz = parseExpr(String(p['fz'] || '0'), scope)
        const name = (variable: string) => ctx.variables.includes(variable) ? `${ctx.variableName(variable)}.value` : variable
        const setup = [
            `const ${ctx.name} = scene3d({ phi: ${num(p['phi'] as number)} * Math.PI / 180, theta: ${num(p['theta'] as number)} * Math.PI / 180, unit: ${num(p['unit'] as number)} })`,
            `${ctx.name}.add(${call('curve3d', `(u) => [${fx.js(name)}, ${fy.js(name)}, ${fz.js(name)}]`, num(u0), num(u1), options([['color', p['color'] as string], ['width', p['width'] as number], ['halo', p['halo'] as boolean]]))})`,
        ]
        if (p['axes']) setup.push(`${ctx.name}.add(axes3d(${options([['x', [-3, 3]], ['y', [-3, 3]], ['z', [-2.5, 2.5]]])}))`)
        if (p['spin']) setup.push(`${ctx.name}.spin(${num(p['spin'] as number)})`)
        return { setup, expr: ctx.name }
    },
}

export const KINDS: Readonly<Record<string, KindDef>> = Object.freeze({
    text: textKind, tex: texKind, passage: passageKind, rect: rectKind, ellipse: ellipseKind, polygon: polygonKind,
    line: lineKind, arrow: arrowKind, dot: dotKind, brace: braceKind,
    graph: graphKind, plane: planeKind, complex: complexKind, field: fieldKind, numberLine: numberLineKind, matrix: matrixKind, readout: readoutKind,
    bars: barsKind, histogram: histogramKind, scatter: scatterKind, dotChart: dotChartKind, unitChart: unitChartKind, segmentedBar: segmentedBarKind,
    pie: pieKind, lines: linesKind, heatmap: heatmapKind, table: tableKind, spark: sparkKind,
    infobox: infoBoxKind, card: realCardKind, pictogram: pictogramKind, zone: zoneKind, connector: connectorKind, steps: stepsKind,
    network: networkKind, tree: treeKind, lanes: lanesKind, pipeline: pipelineKind, requestQueue: requestQueueKind, ringBuffer: ringBufferKind,
    bitField: bitFieldKind, stateGrid: stateGridKind, eventLog: eventLogKind, terminal: terminalKind, layerStack: layerStackKind,
    code: codeKind, neural: neuralKind, cells: cellsKind, tokens: tokensKind,
    surface3d: surfaceKind, sphere3d: sphereKind, curve3d: curve3dKind,
})

const icon = (body: string) => `<svg viewBox="0 0 20 20" aria-hidden="true">${body}</svg>`

export const PALETTE: readonly PaletteEntry[] = [
    { id: 'title', label: 'Title', kind: 'text', group: 'Type', props: { content: 'A title worth reading', size: 96, font: 'text-serif' }, icon: icon('<path d="M4 5h12M10 5v11M7.5 16h5"/>') },
    { id: 'text', label: 'Text', kind: 'text', group: 'Type', key: 't', props: { content: 'Write something clear.', size: 40 }, icon: icon('<path d="M5 6V4.5h10V6M10 4.5V16M8 16h4"/>') },
    { id: 'label', label: 'Label', kind: 'text', group: 'Type', props: { content: 'Section label', size: 20, font: 'mono', color: 'dim', uppercase: true, tracking: 0.12 }, icon: icon('<path d="M3 8h14M3 12h9"/>') },
    { id: 'tex', label: 'Equation', kind: 'tex', group: 'Type', key: 'e', icon: icon('<path d="M4 4h10l-5 6 5 6H4"/>') },
    { id: 'passage', label: 'Passage', kind: 'passage', group: 'Type', icon: icon('<rect x="3" y="3.5" width="14" height="13" rx="1.5"/><path d="M5.5 7h9M5.5 10h9M5.5 13h6"/>') },
    { id: 'rect', label: 'Rectangle', kind: 'rect', group: 'Shape', key: 'r', icon: icon('<rect x="3.5" y="5" width="13" height="10"/>') },
    { id: 'panel', label: 'Panel', kind: 'rect', group: 'Shape', props: { radius: 14, fill: 'surface', stroke: 'faint', width: 1.5, width_: 420, height_: 240 }, icon: icon('<rect x="3.5" y="5" width="13" height="10" rx="2.5"/>') },
    { id: 'circle', label: 'Circle', kind: 'ellipse', group: 'Shape', key: 'c', icon: icon('<circle cx="10" cy="10" r="6.5"/>') },
    { id: 'polygon', label: 'Polygon', kind: 'polygon', group: 'Shape', icon: icon('<path d="M10 3.5l5.6 3.25v6.5L10 16.5l-5.6-3.25v-6.5z"/>') },
    { id: 'line', label: 'Line', kind: 'line', group: 'Shape', icon: icon('<path d="M4 16L16 4"/>') },
    { id: 'arrow', label: 'Arrow', kind: 'arrow', group: 'Shape', key: 'a', icon: icon('<path d="M4 16L15 5M9 5h6v6"/>') },
    { id: 'curved', label: 'Curved arrow', kind: 'arrow', group: 'Shape', props: { bend: 120 }, icon: icon('<path d="M4 15C6 7 11 5 15.5 6M11.5 3.5l4 2.5-3 3.5"/>') },
    { id: 'dot', label: 'Dot', kind: 'dot', group: 'Shape', icon: icon('<circle cx="10" cy="10" r="3.2" fill="currentColor"/>') },
    { id: 'brace', label: 'Brace', kind: 'brace', group: 'Shape', icon: icon('<path d="M3 7c0 3 2 3 3.5 3H8c1 0 2 .6 2 2.5 0-1.9 1-2.5 2-2.5h1.5c1.5 0 3.5 0 3.5-3"/>') },
    { id: 'graph', label: 'Graph', kind: 'graph', group: 'Math', key: 'g', icon: icon('<path d="M3.5 3.5v13h13M5.5 14c3-10 5 2 9-9"/>') },
    { id: 'plane', label: 'Number plane', kind: 'plane', group: 'Math', key: 'p', icon: icon('<path d="M3 7h14M3 13h14M7 3v14M13 3v14"/>') },
    { id: 'complex', label: 'Complex plane', kind: 'complex', group: 'Math', icon: icon('<path d="M3 10h14M10 3v14M4 5.5l12 9M4 14.5l12-9"/>') },
    { id: 'field', label: 'Vector field', kind: 'field', group: 'Math', icon: icon('<path d="M4 5h3M6 3.5L7.5 5 6 6.5M12 4.5l2.5 1.5M14 4l.5 2-2 .5M4 12l2.5 2M6.5 12l0 2-2 0M12 15l3-2M14 12.5l1 .5-.5 1.5"/>') },
    { id: 'numberLine', label: 'Number line', kind: 'numberLine', group: 'Math', icon: icon('<path d="M2.5 10h15M5 8v4M10 8v4M15 8v4"/>') },
    { id: 'matrix', label: 'Matrix', kind: 'matrix', group: 'Math', icon: icon('<path d="M6 3.5H3.5v13H6M14 3.5h2.5v13H14M7.5 7.5h1M11.5 7.5h1M7.5 12.5h1M11.5 12.5h1"/>') },
    { id: 'readout', label: 'Readout', kind: 'readout', group: 'Math', icon: icon('<path d="M4 6h3v8H4zM11 6c3 0 3 8 0 8s-3-8 0-8z"/>') },
    { id: 'bars', label: 'Bars', kind: 'bars', group: 'Data', key: 'b', icon: icon('<path d="M4.5 16V9M10 16V4M15.5 16v-5M3 16.5h14"/>') },
    { id: 'histogram', label: 'Histogram', kind: 'histogram', group: 'Data', icon: icon('<path d="M3.5 16V11h3v5M6.5 16V6h3v10M9.5 16V8h3v8M12.5 16v-3.5h3V16M2.5 16.5h15"/>') },
    { id: 'scatter', label: 'Scatter', kind: 'scatter', group: 'Data', icon: icon('<path d="M3.5 3.5v13h13"/><circle cx="7" cy="12" r="1.3" fill="currentColor"/><circle cx="10" cy="8" r="1.3" fill="currentColor"/><circle cx="14" cy="6" r="1.3" fill="currentColor"/><circle cx="13" cy="11" r="1.3" fill="currentColor"/>') },
    { id: 'dotChart', label: 'Dot chart', kind: 'dotChart', group: 'Data', icon: icon('<path d="M4 6h8M4 10h12M4 14h6"/><circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="13" cy="10" r="1.6" fill="currentColor"/><circle cx="7" cy="14" r="1.6" fill="currentColor"/>') },
    { id: 'unitChart', label: 'Unit chart', kind: 'unitChart', group: 'Data', icon: icon('<circle cx="5" cy="6" r="1.3" fill="currentColor"/><circle cx="9" cy="6" r="1.3" fill="currentColor"/><circle cx="13" cy="6" r="1.3" fill="currentColor"/><circle cx="5" cy="10" r="1.3" fill="currentColor"/><circle cx="9" cy="10" r="1.3" fill="currentColor"/><circle cx="13" cy="10" r="1.3"/><circle cx="5" cy="14" r="1.3" fill="currentColor"/><circle cx="9" cy="14" r="1.3"/>') },
    { id: 'segmentedBar', label: 'Segmented bar', kind: 'segmentedBar', group: 'Data', icon: icon('<rect x="2.5" y="7" width="15" height="6" rx="1"/><path d="M7.5 7v6M13 7v6"/>') },
    { id: 'pie', label: 'Donut', kind: 'pie', group: 'Data', icon: icon('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3"/><path d="M10 3.5V7M16.5 10H13"/>') },
    { id: 'lines', label: 'Lines', kind: 'lines', group: 'Data', icon: icon('<path d="M3.5 3.5v13h13M6 13l3-4 3 2 4-6"/>') },
    { id: 'heatmap', label: 'Heatmap', kind: 'heatmap', group: 'Data', icon: icon('<rect x="3.5" y="3.5" width="13" height="13"/><path d="M3.5 8h13M3.5 12h13M8 3.5v13M12 3.5v13"/>') },
    { id: 'table', label: 'Table', kind: 'table', group: 'Data', icon: icon('<rect x="2.5" y="4" width="15" height="12" rx="1"/><path d="M2.5 8h15M2.5 12h15M8.5 4v12"/>') },
    { id: 'spark', label: 'Sparkline', kind: 'spark', group: 'Data', icon: icon('<path d="M3 13l3-3 3 2 4-6 4 3"/><circle cx="17" cy="9" r="1" fill="currentColor"/>') },
    { id: 'infobox', label: 'Info box', kind: 'infobox', group: 'System', icon: icon('<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M6 7.5h5M6 10.5h8M6 13h8"/>') },
    { id: 'card', label: 'Card', kind: 'card', group: 'System', icon: icon('<rect x="3.5" y="3" width="13" height="14" rx="2"/><circle cx="10" cy="9.5" r="2.2"/><path d="M6.5 5.5h7M6 14h8"/>') },
    { id: 'pictogram', label: 'Pictogram', kind: 'pictogram', group: 'System', icon: icon('<ellipse cx="10" cy="5.5" rx="5.5" ry="2"/><path d="M4.5 5.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9M4.5 10c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2"/>') },
    { id: 'zone', label: 'Zone', kind: 'zone', group: 'System', icon: icon('<path d="M9 4.5h7.5v11h-13v-11H5" stroke-dasharray="2.5 2"/><path d="M5.5 4.5h2.5"/>') },
    { id: 'connector', label: 'Connector', kind: 'connector', group: 'System', icon: icon('<path d="M3.5 6h6.5v8h6.5M14 11.5l2.5 2.5-2.5 2.5"/>') },
    { id: 'steps', label: 'Steps', kind: 'steps', group: 'System', icon: icon('<rect x="2" y="7" width="4.5" height="6" rx="1"/><rect x="7.75" y="7" width="4.5" height="6" rx="1"/><rect x="13.5" y="7" width="4.5" height="6" rx="1"/>') },
    { id: 'network', label: 'Node graph', kind: 'network', group: 'System', icon: icon('<circle cx="5" cy="10" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="15" cy="15" r="2"/><path d="M6.8 9L13.2 6M6.8 11l6.4 3"/>') },
    { id: 'tree', label: 'Tree', kind: 'tree', group: 'System', icon: icon('<circle cx="10" cy="4.5" r="1.8"/><circle cx="5.5" cy="14.5" r="1.8"/><circle cx="14.5" cy="14.5" r="1.8"/><path d="M9 6L6.3 12.8M11 6l2.7 6.8"/>') },
    { id: 'lanes', label: 'Swimlanes', kind: 'lanes', group: 'System', icon: icon('<path d="M3 6h14M3 10h14M3 14h14M7 6v4M12 10v4"/>') },
    { id: 'pipeline', label: 'Pipeline', kind: 'pipeline', group: 'System', icon: icon('<path d="M3 10h14"/><path d="M6.5 7.5L9 10l-2.5 2.5L4 10zM13.5 7.5L16 10l-2.5 2.5L11 10z"/>') },
    { id: 'requestQueue', label: 'Request queue', kind: 'requestQueue', group: 'System', icon: icon('<rect x="2.5" y="7.5" width="3.5" height="5" rx="0.8"/><rect x="7" y="7.5" width="3.5" height="5" rx="0.8"/><rect x="13" y="4.5" width="4.5" height="4.8" rx="0.8"/><rect x="13" y="10.7" width="4.5" height="4.8" rx="0.8"/>') },
    { id: 'ringBuffer', label: 'Ring buffer', kind: 'ringBuffer', group: 'System', icon: icon('<circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="3.2"/><path d="M10 3.5v3.3M16.5 10h-3.3M10 16.5v-3.3M3.5 10h3.3"/>') },
    { id: 'bitField', label: 'Bit field', kind: 'bitField', group: 'System', icon: icon('<rect x="2.5" y="8" width="15" height="6"/><path d="M7.5 8v6M11.5 8v6M3 5.5h2M15 5.5h2"/>') },
    { id: 'stateGrid', label: 'State grid', kind: 'stateGrid', group: 'System', icon: icon('<rect x="3.5" y="4.5" width="3.5" height="3.5" rx="0.6"/><rect x="8.25" y="4.5" width="3.5" height="3.5" rx="0.6" fill="currentColor"/><rect x="13" y="4.5" width="3.5" height="3.5" rx="0.6"/><rect x="3.5" y="10" width="3.5" height="3.5" rx="0.6" fill="currentColor"/><rect x="8.25" y="10" width="3.5" height="3.5" rx="0.6"/><rect x="13" y="10" width="3.5" height="3.5" rx="0.6" fill="currentColor"/>') },
    { id: 'eventLog', label: 'Event log', kind: 'eventLog', group: 'System', icon: icon('<circle cx="4.5" cy="6" r="1" fill="currentColor"/><path d="M7.5 6h9"/><circle cx="4.5" cy="10" r="1" fill="currentColor"/><path d="M7.5 10h9"/><circle cx="4.5" cy="14" r="1"/><path d="M7.5 14h6"/>') },
    { id: 'terminal', label: 'Terminal', kind: 'terminal', group: 'System', icon: icon('<rect x="2.5" y="4" width="15" height="12" rx="1.5"/><path d="M5.5 8.5L8 10.5l-2.5 2M9.5 12.5h4"/>') },
    { id: 'layerStack', label: 'Layer stack', kind: 'layerStack', group: 'System', icon: icon('<rect x="5" y="3.5" width="10" height="3.2" rx="0.8"/><rect x="5" y="8.4" width="10" height="3.2" rx="0.8"/><rect x="5" y="13.3" width="10" height="3.2" rx="0.8"/>') },
    { id: 'code', label: 'Code', kind: 'code', group: 'System', icon: icon('<path d="M7 5.5L3 10l4 4.5M13 5.5l4 4.5-4 4.5"/>') },
    { id: 'neural', label: 'Neural net', kind: 'neural', group: 'System', icon: icon('<circle cx="4.5" cy="6.5" r="1.5"/><circle cx="4.5" cy="13.5" r="1.5"/><circle cx="15.5" cy="10" r="1.5"/><path d="M6 6.5L14 10M6 13.5L14 10"/>') },
    { id: 'cells', label: 'Array', kind: 'cells', group: 'System', icon: icon('<rect x="2.5" y="7" width="15" height="6"/><path d="M7.5 7v6M12.5 7v6"/>') },
    { id: 'tokens', label: 'Tokens', kind: 'tokens', group: 'System', icon: icon('<rect x="2.5" y="7.5" width="6" height="5" rx="1"/><rect x="10" y="7.5" width="7.5" height="5" rx="1"/>') },
    { id: 'surface3d', label: '3D surface', kind: 'surface3d', group: '3D', icon: icon('<path d="M3 13c2-5 4-5 7-3s5 1 7-3M3 13l4 3.5M7 16.5c2-4 4-4 7-2.5s3-1 3-7"/>') },
    { id: 'sphere3d', label: '3D sphere', kind: 'sphere3d', group: '3D', icon: icon('<circle cx="10" cy="10" r="6.5"/><ellipse cx="10" cy="10" rx="6.5" ry="2.5"/><ellipse cx="10" cy="10" rx="2.5" ry="6.5"/>') },
    { id: 'curve3d', label: '3D curve', kind: 'curve3d', group: '3D', icon: icon('<path d="M4 14c0-5 12-3 12-8s-12-1-12 4 12 6 12 2"/>') },
]

/** Default values merged with a palette entry's overrides. */
export function defaultProps(kind: string, overrides: ObjectProps = {}): ObjectProps {
    const def = KINDS[kind]
    if (!def) throw new Error(`Unknown object kind: ${kind}`)
    return { ...def.defaults, ...overrides }
}

export function displayName(object: StudioObject): string {
    return object.name || KINDS[object.kind]?.label || object.kind
}
