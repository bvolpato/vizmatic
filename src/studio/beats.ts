/**
 * Everything an object can do on the timeline. Like the object table, each beat
 * builds a real animation and writes the same animation as source code.
 */
import {
    along, appear, applyMatrix, bounce, circumscribe, draw, easeInExpo, easeInOutCubic, easeInOutQuint, easeInQuad, easeOutCubic,
    easeOutExpo, easeOutQuint, erase, fade, fadeIn, fadeOut, flash, grow, indicate, linear, moveTo, morph, morphMatching, overshoot,
    morphCode, pulse, recolor, ripple, rotate, rushFrom, rushInto, scaleBy, shake, slowInto, smooth, smoother, spring, vanish, write,
    type Anim, type BarChart, type CodeBlock, type Ease, type NeuralNet, type Node, type PieChart, type Scene3D, type Value,
} from '../stage/index'
import { KINDS, num, options, parseLabeled, parseNumbers, str, type Field } from './catalog'
import type { Beat, ObjectProps } from './model'

export interface EaseDef {
    name: string
    label: string
    fn: Ease
    /** Source text in generated code. */
    code: string
}

export const EASES: Readonly<Record<string, EaseDef>> = Object.freeze({
    smooth: { name: 'smooth', label: 'Smooth', fn: smooth, code: 'smooth' },
    smoother: { name: 'smoother', label: 'Smoother', fn: smoother, code: 'smoother' },
    linear: { name: 'linear', label: 'Linear', fn: linear, code: 'linear' },
    rushInto: { name: 'rushInto', label: 'Rush in', fn: rushInto, code: 'rushInto' },
    rushFrom: { name: 'rushFrom', label: 'Rush out', fn: rushFrom, code: 'rushFrom' },
    slowInto: { name: 'slowInto', label: 'Glide', fn: slowInto, code: 'slowInto' },
    easeInQuad: { name: 'easeInQuad', label: 'In', fn: easeInQuad, code: 'easeInQuad' },
    easeOutCubic: { name: 'easeOutCubic', label: 'Out', fn: easeOutCubic, code: 'easeOutCubic' },
    easeInOutCubic: { name: 'easeInOutCubic', label: 'In out', fn: easeInOutCubic, code: 'easeInOutCubic' },
    easeOutQuint: { name: 'easeOutQuint', label: 'Out strong', fn: easeOutQuint, code: 'easeOutQuint' },
    easeInOutQuint: { name: 'easeInOutQuint', label: 'In out strong', fn: easeInOutQuint, code: 'easeInOutQuint' },
    easeOutExpo: { name: 'easeOutExpo', label: 'Out sharp', fn: easeOutExpo, code: 'easeOutExpo' },
    easeInExpo: { name: 'easeInExpo', label: 'In sharp', fn: easeInExpo, code: 'easeInExpo' },
    overshoot: { name: 'overshoot', label: 'Overshoot', fn: overshoot(), code: 'overshoot()' },
    spring: { name: 'spring', label: 'Spring', fn: spring(), code: 'spring()' },
    bounce: { name: 'bounce', label: 'Bounce', fn: bounce, code: 'bounce' },
})

export const DEFAULT_EASE = 'smooth'

export interface BeatBuild {
    node: Node
    nodes: ReadonlyMap<string, Node>
    values: ReadonlyMap<string, Value>
    objectKind: (id: string) => string | undefined
}

export interface BeatCode {
    /** JavaScript name of the target object. */
    name: string
    names: ReadonlyMap<string, string>
    variableName: (variable: string) => string
    objectKind: (id: string) => string | undefined
}

export type BeatGroup = 'Enter' | 'Exit' | 'Change' | 'Emphasis' | 'Value'

export interface BeatDef {
    kind: string
    label: string
    group: BeatGroup
    /** The object stays hidden until its first beat, when that beat is an entrance. */
    entrance?: boolean
    /** Instant beats have no length. */
    instant?: boolean
    /** Whether the easing picker applies. Emphasis beats have their own shape in time. */
    eases?: boolean
    /** Offer this beat only for these object kinds. */
    only?: (kind: string) => boolean
    duration: number
    params: ObjectProps
    fields: readonly Field[]
    /** Short helper text shown in the preset picker. */
    hint: string
    build(beat: Beat, ctx: BeatBuild): Anim | null
    code(beat: Beat, ctx: BeatCode): string | null
}

const DIRECTIONS = [['none', 'In place'], ['up', 'Rise up'], ['down', 'Drop down'], ['left', 'From right'], ['right', 'From left']] as const

function fadeVector(direction: PropValueLike, distance: PropValueLike): readonly [number, number] | undefined {
    const d = Number(distance) || 0
    switch (direction) {
        case 'up': return [0, d]
        case 'down': return [0, -d]
        case 'left': return [d, 0]
        case 'right': return [-d, 0]
        default: return undefined
    }
}

type PropValueLike = string | number | boolean | null | undefined

const directionFields: readonly Field[] = [
    { key: 'direction', label: 'Direction', type: 'select', options: DIRECTIONS },
    { key: 'distance', label: 'Distance', type: 'number', min: 0, max: 2000, step: 5 },
]

const colorField = (label = 'Color'): Field => ({ key: 'color', label, type: 'color' })

function vec(v: readonly [number, number]): string {
    return `[${num(v[0])}, ${num(v[1])}]`
}

const write_: BeatDef = {
    kind: 'write', label: 'Write', group: 'Enter', entrance: true, eases: true, duration: 1.4, params: {}, fields: [],
    hint: 'Hand-draws glyphs, then fills them',
    build: (_, { node }) => write(node),
    code: (_, { name }) => `write(${name})`,
}

const draw_: BeatDef = {
    kind: 'draw', label: 'Draw', group: 'Enter', entrance: true, eases: true, duration: 1.4, params: {}, fields: [],
    hint: 'Traces strokes from start to end',
    build: (_, { node }) => draw(node),
    code: (_, { name }) => `draw(${name})`,
}

const fadeIn_: BeatDef = {
    kind: 'fadeIn', label: 'Fade in', group: 'Enter', entrance: true, eases: true, duration: 0.8,
    params: { direction: 'up', distance: 36 }, fields: directionFields,
    hint: 'Fades in, with an optional drift',
    build: (beat, { node }) => {
        const shift = fadeVector(beat.params['direction'], beat.params['distance'])
        return fadeIn(node, shift ? { shift } : {})
    },
    code: (beat, { name }) => {
        const shift = fadeVector(beat.params['direction'], beat.params['distance'])
        return shift ? `fadeIn(${name}, { shift: ${vec(shift)} })` : `fadeIn(${name})`
    },
}

const grow_: BeatDef = {
    kind: 'grow', label: 'Grow', group: 'Enter', entrance: true, eases: true, duration: 0.9, params: {}, fields: [],
    hint: 'Scales up from nothing',
    build: (_, { node }) => grow(node),
    code: (_, { name }) => `grow(${name})`,
}

const appear_: BeatDef = {
    kind: 'appear', label: 'Appear', group: 'Enter', entrance: true, instant: true, duration: 0, params: {}, fields: [],
    hint: 'Shows at once',
    build: (_, { node }) => appear(node),
    code: (_, { name }) => `appear(${name})`,
}

const enter_: BeatDef = {
    kind: 'enter', label: 'Build in', group: 'Enter', entrance: true, eases: true, duration: 1.6, params: {}, fields: [],
    hint: 'The staged entrance this object was designed with',
    only: (kind) => KINDS[kind]?.enters === true,
    build: (_, { node }) => {
        const staged = node as Node & { enter?: () => Anim }
        return typeof staged.enter === 'function' ? staged.enter() : fadeIn(node)
    },
    code: (_, { name }) => `${name}.enter()`,
}

const fadeOut_: BeatDef = {
    kind: 'fadeOut', label: 'Fade out', group: 'Exit', eases: true, duration: 0.6,
    params: { direction: 'none', distance: 36 }, fields: directionFields,
    hint: 'Fades away, with an optional drift',
    build: (beat, { node }) => {
        const shift = fadeVector(beat.params['direction'], beat.params['distance'])
        return fadeOut(node, shift ? { shift: [-shift[0], -shift[1]] } : {})
    },
    code: (beat, { name }) => {
        const shift = fadeVector(beat.params['direction'], beat.params['distance'])
        return shift ? `fadeOut(${name}, { shift: ${vec([-shift[0], -shift[1]])} })` : `fadeOut(${name})`
    },
}

const erase_: BeatDef = {
    kind: 'erase', label: 'Erase', group: 'Exit', eases: true, duration: 0.8, params: {}, fields: [],
    hint: 'Un-draws the shape',
    build: (_, { node }) => erase(node),
    code: (_, { name }) => `erase(${name})`,
}

const vanish_: BeatDef = {
    kind: 'vanish', label: 'Vanish', group: 'Exit', instant: true, duration: 0, params: {}, fields: [],
    hint: 'Hides at once',
    build: (_, { node }) => vanish(node),
    code: (_, { name }) => `vanish(${name})`,
}

const move_: BeatDef = {
    kind: 'move', label: 'Move', group: 'Change', eases: true, duration: 1,
    params: { x: 0, y: 0 },
    fields: [
        { key: 'x', label: 'To X', type: 'number', min: -8000, max: 8000, step: 1 },
        { key: 'y', label: 'To Y', type: 'number', min: -8000, max: 8000, step: 1 },
    ],
    hint: 'Travels to a point. Drag on canvas to set it',
    build: (beat, { node }) => moveTo(node, [Number(beat.params['x']), Number(beat.params['y'])]),
    code: (beat, { name }) => `moveTo(${name}, ${vec([Number(beat.params['x']), Number(beat.params['y'])])})`,
}

const scale_: BeatDef = {
    kind: 'scale', label: 'Scale', group: 'Change', eases: true, duration: 1, params: { factor: 1.5 },
    fields: [{ key: 'factor', label: 'Factor', type: 'number', min: 0.01, max: 50, step: 0.05 }],
    hint: 'Grows or shrinks around its center',
    build: (beat, { node }) => scaleBy(node, Number(beat.params['factor'])),
    code: (beat, { name }) => `scaleBy(${name}, ${num(Number(beat.params['factor']))})`,
}

const rotate_: BeatDef = {
    kind: 'rotate', label: 'Rotate', group: 'Change', eases: true, duration: 1, params: { degrees: 90 },
    fields: [{ key: 'degrees', label: 'Degrees', type: 'number', min: -7200, max: 7200, step: 5 }],
    hint: 'Turns around its center',
    build: (beat, { node }) => rotate(node, Number(beat.params['degrees']) * Math.PI / 180),
    code: (beat, { name }) => `rotate(${name}, ${num(Number(beat.params['degrees']))} * Math.PI / 180)`,
}

const recolor_: BeatDef = {
    kind: 'recolor', label: 'Recolor', group: 'Change', eases: true, duration: 0.8, params: { color: 'yellow' },
    fields: [colorField('To color')],
    hint: 'Blends to a new color',
    build: (beat, { node }) => recolor(node, String(beat.params['color'])),
    code: (beat, { name }) => `recolor(${name}, ${str(String(beat.params['color']))})`,
}

const fadeTo_: BeatDef = {
    kind: 'fade', label: 'Dim', group: 'Change', eases: true, duration: 0.6, params: { opacity: 0.25 },
    fields: [{ key: 'opacity', label: 'Opacity', type: 'number', min: 0, max: 1, step: 0.05 }],
    hint: 'Changes opacity and stays on stage',
    build: (beat, { node }) => fade(node, Number(beat.params['opacity'])),
    code: (beat, { name }) => `fade(${name}, ${num(Number(beat.params['opacity']))})`,
}

const morph_: BeatDef = {
    kind: 'morph', label: 'Morph into', group: 'Change', eases: true, duration: 1.3,
    params: { into: '', matching: true },
    fields: [
        { key: 'into', label: 'Into', type: 'select', options: [] },
        { key: 'matching', label: 'Match glyphs', type: 'bool', help: 'Equations and text keep matching symbols' },
    ],
    hint: 'Becomes another object, whatever its shape',
    build: (beat, { node, nodes, objectKind, }) => {
        const target = nodes.get(String(beat.params['into']))
        if (!target) throw new Error('Choose an object to morph into.')
        const into = String(beat.params['into'])
        if (objectKind(beat.target) === 'code' && objectKind(into) === 'code') return morphCode(node as CodeBlock, target as CodeBlock)
        return beat.params['matching'] && isType(objectKind(beat.target)) && isType(objectKind(into))
            ? morphMatching(node, target)
            : morph(node, target)
    },
    code: (beat, { name, names, objectKind }) => {
        const target = names.get(String(beat.params['into']))
        if (!target) return null
        const into = String(beat.params['into'])
        if (objectKind(beat.target) === 'code' && objectKind(into) === 'code') return `morphCode(${name}, ${target})`
        const matching = beat.params['matching'] && isType(objectKind(beat.target)) && isType(objectKind(into))
        return `${matching ? 'morphMatching' : 'morph'}(${name}, ${target})`
    },
}

function isType(kind: string | undefined): boolean {
    return kind === 'text' || kind === 'tex'
}

const along_: BeatDef = {
    kind: 'along', label: 'Follow path', group: 'Change', eases: true, duration: 2,
    params: { path: '', orient: false },
    fields: [
        { key: 'path', label: 'Along', type: 'select', options: [] },
        { key: 'orient', label: 'Turn with path', type: 'bool' },
    ],
    hint: 'Travels along the outline of another object',
    build: (beat, { node, nodes }) => {
        const source = nodes.get(String(beat.params['path']))
        const track = source?.leaves().find((leaf) => leaf.get('path'))
        if (!track) throw new Error('Choose a shape to follow.')
        return along(node, track, { orient: Boolean(beat.params['orient']) })
    },
    code: (beat, { name, names }) => {
        const source = names.get(String(beat.params['path']))
        if (!source) return null
        const opts = options([['orient', Boolean(beat.params['orient']), false]])
        return `along(${name}, ${source}.leaves().find((leaf) => leaf.get('path'))!${opts ? `, ${opts}` : ''})`
    },
}

const matrix_: BeatDef = {
    kind: 'applyMatrix', label: 'Apply matrix', group: 'Change', eases: true, duration: 2,
    params: { a: 1, b: 1, c: 0, d: 1 },
    fields: [
        { key: 'a', label: 'a', type: 'number', min: -20, max: 20, step: 0.1 },
        { key: 'b', label: 'b', type: 'number', min: -20, max: 20, step: 0.1 },
        { key: 'c', label: 'c', type: 'number', min: -20, max: 20, step: 0.1 },
        { key: 'd', label: 'd', type: 'number', min: -20, max: 20, step: 0.1 },
    ],
    hint: 'Bends a grid or shape by a 2x2 matrix',
    build: (beat, { node }) => applyMatrix(node, [
        [Number(beat.params['a']), Number(beat.params['b'])],
        [Number(beat.params['c']), Number(beat.params['d'])],
    ], { origin: node.center }),
    code: (beat, { name }) => `applyMatrix(${name}, [[${num(Number(beat.params['a']))}, ${num(Number(beat.params['b']))}], [${num(Number(beat.params['c']))}, ${num(Number(beat.params['d']))}]], { origin: ${name}.center })`,
}

const indicate_: BeatDef = {
    kind: 'indicate', label: 'Indicate', group: 'Emphasis', duration: 0.9, params: { color: 'yellow', amount: 1.14 },
    fields: [colorField(), { key: 'amount', label: 'Swell', type: 'number', min: 1, max: 3, step: 0.02 }],
    hint: 'Swells and tints for a moment',
    build: (beat, { node }) => indicate(node, { color: String(beat.params['color']), scale: Number(beat.params['amount']) }),
    code: (beat, { name }) => `indicate(${name}, ${options([['color', String(beat.params['color'])], ['scale', Number(beat.params['amount'])]])})`,
}

const circumscribe_: BeatDef = {
    kind: 'circumscribe', label: 'Circumscribe', group: 'Emphasis', duration: 1.3, params: { color: 'yellow' },
    fields: [colorField()],
    hint: 'A line runs around the object',
    build: (beat, { node }) => circumscribe(node, { color: String(beat.params['color']) }),
    code: (beat, { name }) => `circumscribe(${name}, ${options([['color', String(beat.params['color'])]])})`,
}

const flash_: BeatDef = {
    kind: 'flash', label: 'Flash', group: 'Emphasis', duration: 0.7, params: { color: 'yellow' },
    fields: [colorField()],
    hint: 'A burst of rays at the center',
    build: (beat, { node }) => flash(node, { color: String(beat.params['color']) }),
    code: (beat, { name }) => `flash(${name}, ${options([['color', String(beat.params['color'])]])})`,
}

const ripple_: BeatDef = {
    kind: 'ripple', label: 'Ripple', group: 'Emphasis', duration: 1, params: { color: 'blue' },
    fields: [colorField()],
    hint: 'A ring expands outward and fades',
    build: (beat, { node }) => ripple(node, { color: String(beat.params['color']) }),
    code: (beat, { name }) => `ripple(${name}, ${options([['color', String(beat.params['color'])]])})`,
}

const pulse_: BeatDef = {
    kind: 'pulse', label: 'Pulse', group: 'Emphasis', duration: 1.1, params: { color: 'yellow' },
    fields: [colorField()],
    hint: 'A lit segment runs along a line',
    build: (beat, { node }) => {
        const shape = node.leaves().find((leaf) => leaf.get('path'))
        if (!shape) throw new Error('Pulse needs a line or a shape.')
        return pulse(shape, { color: String(beat.params['color']) })
    },
    code: (beat, { name }) => `pulse(${name}.leaves().find((leaf) => leaf.get('path'))!, ${options([['color', String(beat.params['color'])]])})`,
}

const shake_: BeatDef = {
    kind: 'shake', label: 'Shake', group: 'Emphasis', duration: 0.8, params: {}, fields: [],
    hint: 'A small tilt back and forth',
    build: (_, { node }) => shake(node),
    code: (_, { name }) => `shake(${name})`,
}

const updateData_: BeatDef = {
    kind: 'update', label: 'Update data', group: 'Change', eases: true, duration: 1.2, params: { data: '' },
    fields: [{ key: 'data', label: 'New values', type: 'text', help: 'Numbers in the same order as the chart. Labels are also fine' }],
    hint: 'Animates the chart to new numbers',
    only: (kind) => kind === 'bars' || kind === 'pie',
    build: (beat, { node }) => {
        const values = chartValues(String(beat.params['data']))
        if (values.length === 0) throw new Error('Type the new values, such as 12 30 44.')
        return (node as BarChart | PieChart).update(values)
    },
    code: (beat, { name }) => {
        const values = chartValues(String(beat.params['data']))
        return values.length ? `${name}.update([${values.map(num).join(', ')}])` : null
    },
}

function chartValues(source: string): number[] {
    const labeled = parseLabeled(source)
    return labeled.length ? labeled.map((entry) => entry.value) : parseNumbers(source)
}

const forward_: BeatDef = {
    kind: 'forward', label: 'Forward pass', group: 'Emphasis', duration: 3, params: { color: 'yellow' },
    fields: [colorField()],
    hint: 'Runs a signal through the layers',
    only: (kind) => kind === 'neural',
    build: (beat, { node }) => (node as NeuralNet).forward({ color: String(beat.params['color']) }),
    code: (beat, { name }) => `${name}.forward(${options([['color', String(beat.params['color'])]])})`,
}

const orbit_: BeatDef = {
    kind: 'orbit', label: 'Orbit camera', group: 'Change', eases: true, duration: 3, params: { theta: 40, phi: 60 },
    fields: [
        { key: 'theta', label: 'Turn to', type: 'number', min: -1440, max: 1440, step: 1 },
        { key: 'phi', label: 'Tilt to', type: 'number', min: 0, max: 180, step: 1 },
    ],
    hint: 'Moves the 3D camera to a new angle',
    only: (kind) => kind === 'surface3d',
    build: (beat, { node }) => (node as Scene3D).orbit({ theta: Number(beat.params['theta']) * Math.PI / 180, phi: Number(beat.params['phi']) * Math.PI / 180 }),
    code: (beat, { name }) => `${name}.orbit({ theta: ${num(Number(beat.params['theta']))} * Math.PI / 180, phi: ${num(Number(beat.params['phi']))} * Math.PI / 180 })`,
}

const focus_: BeatDef = {
    kind: 'focus', label: 'Focus lines', group: 'Emphasis', duration: 0.6, params: { lines: '1' },
    fields: [{ key: 'lines', label: 'Lines', type: 'text', help: 'Line numbers from 1, separated by spaces' }],
    hint: 'Dims everything but the lines you name',
    only: (kind) => kind === 'code',
    build: (beat, { node }) => (node as CodeBlock).focus(parseNumbers(String(beat.params['lines'])).map((line) => line - 1)),
    code: (beat, { name }) => `${name}.focus([${parseNumbers(String(beat.params['lines'])).map((line) => num(line - 1)).join(', ')}])`,
}

const value_: BeatDef = {
    kind: 'value', label: 'Tween value', group: 'Value', eases: true, duration: 2, params: { variable: '', to: 1 },
    fields: [
        { key: 'variable', label: 'Variable', type: 'select', options: [] },
        { key: 'to', label: 'To', type: 'number', min: -1e6, max: 1e6, step: 0.1 },
    ],
    hint: 'Animates a variable, and everything reading it',
    build: (beat, { values }) => {
        const value = values.get(String(beat.params['variable']))
        if (!value) throw new Error('Choose a variable to tween.')
        return value.to(Number(beat.params['to']))
    },
    code: (beat, { variableName }) => beat.params['variable'] ? `${variableName(String(beat.params['variable']))}.to(${num(Number(beat.params['to']))})` : null,
}

export const BEATS: Readonly<Record<string, BeatDef>> = Object.freeze({
    enter: enter_, write: write_, draw: draw_, fadeIn: fadeIn_, grow: grow_, appear: appear_,
    fadeOut: fadeOut_, erase: erase_, vanish: vanish_,
    move: move_, scale: scale_, rotate: rotate_, recolor: recolor_, fade: fadeTo_, morph: morph_, along: along_, applyMatrix: matrix_,
    update: updateData_, orbit: orbit_,
    indicate: indicate_, circumscribe: circumscribe_, flash: flash_, ripple: ripple_, pulse: pulse_, shake: shake_, forward: forward_, focus: focus_,
    value: value_,
})

export const BEAT_GROUPS: readonly BeatGroup[] = ['Enter', 'Change', 'Emphasis', 'Exit', 'Value']

/** The entrance that suits an object: glyphs write, outlines draw, the rest fade. */
export function naturalEntrance(kind: string): string {
    const declared = KINDS[kind]?.entrance
    if (declared) return declared
    if (kind === 'text' || kind === 'tex') return 'write'
    if (kind === 'readout' || kind === 'dot') return 'fadeIn'
    return 'draw'
}
