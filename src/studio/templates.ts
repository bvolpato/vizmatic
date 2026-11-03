import { defaultProps } from './catalog'
import { emptyProject, VALUE_TRACK, type Beat, type ObjectProps, type StudioObject, type StudioProject } from './model'

export interface Template {
    id: string
    title: string
    description: string
    /** Time at which to show the thumbnail. */
    thumb: number
    project: () => StudioProject
}

function object(id: string, kind: string, x: number, y: number, props: ObjectProps = {}, extra: Partial<StudioObject> = {}): StudioObject {
    const name = extra.name ?? id.replace(/(^|-)(\w)/g, (_, gap: string, letter: string) => `${gap ? ' ' : ''}${gap ? letter : letter.toUpperCase()}`)
    return { id, kind, name, x, y, rotation: 0, scale: 1, opacity: 1, hidden: false, locked: false, props: defaultProps(kind, props), ...extra }
}

let beatSerial = 0

function beat(target: string, kind: string, start: number, duration: number, params: ObjectProps = {}, ease = 'smooth'): Beat {
    beatSerial += 1
    return { id: `b-${target.replace(/[^A-Za-z0-9_-]/g, '')}-${beatSerial}`, target, kind, start, duration, ease, params }
}

function explainer(): StudioProject {
    return {
        ...emptyProject('Why the derivative is a slope'),
        hold: 1.5,
        variables: [{ name: 'h', value: 1.6 }],
        objects: [
            object('graph', 'graph', -290, 90, { expr: 'x^2', xMin: -1, xMax: 3, yMin: -1, yMax: 9, plotWidth: 980, plotHeight: 640, stroke: 'blue', width: 5, glow: 8 }, { name: 'Curve' }),
            object('title', 'text', 0, -462, { content: 'Two points become one tangent', font: 'text-serif', size: 72 }),
            object('secant-formula', 'tex', 590, -180, { source: 'm = \\frac{f(1+h) - f(1)}{h}', size: 58 }, { name: 'Secant slope' }),
            object('simplified', 'tex', 590, -180, { source: 'm = 2 + h', size: 72, color: 'yellow' }, { name: 'Simplified' }),
            object('slope-readout', 'readout', 590, -30, { expr: '2 + h', prefix: 'm = ', size: 50, digits: 2 }, { name: 'Slope readout' }),
            object('increment-readout', 'readout', 590, 50, { expr: 'h', prefix: 'h = ', size: 34, digits: 2, color: 'dim' }, { name: 'h readout' }),
        ],
        beats: [
            beat('title', 'write', 0, 1.5),
            beat('graph', 'draw', 0.8, 1.8),
            beat('secant-formula', 'write', 2.6, 1.6),
            beat('secant-formula', 'morph', 4.8, 1.4, { into: 'simplified', matching: true }),
            beat('slope-readout', 'fadeIn', 6.2, 0.6, { direction: 'up', distance: 24 }),
            beat('increment-readout', 'fadeIn', 6.2, 0.6, { direction: 'up', distance: 24 }),
            beat(VALUE_TRACK, 'value', 6.8, 4, { variable: 'h', to: 0.02 }, 'easeOutCubic'),
            beat('simplified', 'indicate', 10.9, 1, { color: 'teal', amount: 1.12 }),
        ],
        markers: [{ id: 'm-1', time: 2.6, title: 'The formula' }, { id: 'm-2', time: 6.8, title: 'Shrink h' }],
    }
}

function equationStory(): StudioProject {
    return {
        ...emptyProject('An equation in three moves'),
        look: 'chalk',
        hold: 1.2,
        objects: [
            object('label', 'text', 0, -280, { content: 'Start from the theorem', font: 'mono', size: 22, color: 'dim', uppercase: true, tracking: 0.14 }),
            object('step-1', 'tex', 0, -40, { source: 'a^2 + b^2 = c^2', size: 130 }, { name: 'Theorem' }),
            object('step-2', 'tex', 0, -40, { source: 'c^2 = a^2 + b^2', size: 130 }, { name: 'Swapped' }),
            object('step-3', 'tex', 0, -40, { source: 'c = \\sqrt{a^2 + b^2}', size: 130, color: 'yellow' }, { name: 'Solved' }),
            object('note', 'text', 0, 190, { content: 'The same symbols, carried to new places.', font: 'text-serif', italic: true, size: 50, color: 'dim' }),
        ],
        beats: [
            beat('label', 'fadeIn', 0, 0.7, { direction: 'up', distance: 20 }),
            beat('step-1', 'write', 0.3, 2),
            beat('step-1', 'morph', 3, 1.3, { into: 'step-2', matching: true }),
            beat('step-2', 'morph', 5.2, 1.5, { into: 'step-3', matching: true }),
            beat('step-3', 'circumscribe', 7, 1.3, { color: 'yellow' }),
            beat('note', 'write', 7.4, 1.6),
        ],
        markers: [],
    }
}

function architecture(): StudioProject {
    // Dense on purpose: each node carries live numbers, as an engineering figure does.
    const node = (id: string, x: number, y: number, title: string, subtitle: string, accent: string, rows: string, badge = '', tags = '') =>
        object(id, 'infobox', x, y, { title, subtitle, accent, rows, badge, tags, size: 19, boxWidth: 320 }, { name: title })
    const arrow = (id: string, x: number, y: number, length: number, rotation = 0, color = 'dim') =>
        object(id, 'arrow', x, y, { length, stroke: color, width: 2.5, tip: 15 }, { rotation, name: id.replace(/-/g, ' ') })
    const label = (id: string, x: number, y: number, content: string) =>
        object(id, 'text', x, y, { content, font: 'mono', size: 15, color: 'dim' }, { name: `${id} label` })
    return {
        ...emptyProject('Request path walkthrough'),
        look: 'blueprint',
        hold: 1.2,
        objects: [
            object('title', 'text', -541, -440, { content: 'How one request crosses the system', font: 'text-serif', size: 54, align: 'left' }),
            object('caption', 'text', -651, -386, { content: 'p99 budget 450 ms, measured at the edge', font: 'mono', size: 18, color: 'dim' }, { name: 'Budget' }),
            node('client', -700, -130, 'Web client', 'React, 1.4M sessions/day', 'blue', 'TTFB: 86 ms\nRetry rate: 0.4%', 'edge', 'https, cdn'),
            node('api', -180, -130, 'API gateway', 'us-east-1, 12 pods', 'teal', 'p99: 128 ms\nThroughput: 2.1k req/s\nError rate: 0.07%', 'healthy', 'go, grpc'),
            node('queue', 380, -130, 'Event queue', 'Kafka, 48 partitions', 'gold', 'Lag: 1.8 s\nIn flight: 4,120\nRetention: 7 d', 'watch', 'at least once'),
            node('worker', 380, 240, 'Fulfillment worker', 'Autoscaled, 6 to 40', 'teal', 'p99: 212 ms\nConcurrency: 31\nDead letters: 2/h', 'healthy', 'go'),
            node('store', -180, 240, 'Orders store', 'Postgres, 3 replicas', 'green', 'Write p99: 18 ms\nReplica lag: 90 ms\nRows: 2.3B', 'primary', 'sql'),
            object('budget', 'spark', -710, 250, { values: '140 150 148 210 180 170 160 155 150 148', sparkWidth: 300, sparkHeight: 64, color: 'yellow' }, { name: 'p99 trend' }),
            object('budget-label', 'text', -799, 180, { content: 'p99 over 24 h', font: 'mono', size: 16, color: 'dim' }, { name: 'Trend label' }),
            arrow('client-to-api', -440, -130, 150),
            arrow('api-to-queue', 100, -130, 150),
            arrow('queue-to-worker', 380, 70, 110, 90),
            arrow('worker-to-store', 100, 240, 150, 180),
            label('https', -440, -156, 'HTTPS'),
            label('publish', 100, -156, 'publish'),
            label('consume', 440, 70, 'consume'),
            label('write', 100, 214, 'write'),
        ],
        beats: [
            beat('title', 'write', 0, 1.2),
            beat('caption', 'fadeIn', 0.8, 0.5, { direction: 'none', distance: 0 }),
            ...['client', 'api', 'queue', 'worker', 'store'].map((id, i) => beat(id, 'enter', 0.9 + i * 0.3, 1.1)),
            beat('client-to-api', 'draw', 2.6, 0.4),
            beat('https', 'fadeIn', 2.7, 0.3, { direction: 'none', distance: 0 }),
            beat('api-to-queue', 'draw', 2.8, 0.4),
            beat('publish', 'fadeIn', 2.9, 0.3, { direction: 'none', distance: 0 }),
            beat('queue-to-worker', 'draw', 3, 0.4),
            beat('consume', 'fadeIn', 3.1, 0.3, { direction: 'none', distance: 0 }),
            beat('worker-to-store', 'draw', 3.2, 0.4),
            beat('write', 'fadeIn', 3.3, 0.3, { direction: 'none', distance: 0 }),
            beat('budget-label', 'fadeIn', 3.3, 0.4, { direction: 'none', distance: 0 }),
            beat('budget', 'draw', 3.4, 0.9),
            beat('client-to-api', 'pulse', 4.4, 0.8, { color: 'yellow' }),
            beat('api', 'circumscribe', 5.1, 0.9, { color: 'teal' }),
            beat('api-to-queue', 'pulse', 5.8, 0.8, { color: 'yellow' }),
            beat('queue', 'circumscribe', 6.5, 0.9, { color: 'gold' }),
            beat('queue-to-worker', 'pulse', 7.2, 0.7, { color: 'yellow' }),
            beat('worker', 'circumscribe', 7.8, 0.9, { color: 'teal' }),
            beat('worker-to-store', 'pulse', 8.5, 0.8, { color: 'yellow' }),
            beat('store', 'flash', 9.2, 0.8, { color: 'green' }),
        ],
        markers: [{ id: 'm-1', time: 4.4, title: 'Follow one request' }],
    }
}

function chartReveal(): StudioProject {
    const data: [string, number, string][] = [['Q1', 42, 'blue'], ['Q2', 58, 'blue'], ['Q3', 71, 'teal'], ['Q4', 96, 'yellow']]
    const left = -480, gap = 320, baseline = 320, unit = 6
    return {
        ...emptyProject('Quarterly reveal'),
        look: 'paper',
        hold: 1.2,
        objects: [
            object('title', 'text', 0, -430, { content: 'Growth doubled in the final quarter', font: 'text-serif', size: 72 }),
            object('axis', 'line', 0, baseline, { length: 1280, stroke: 'dim', width: 2 }, { name: 'Baseline' }),
            ...data.flatMap(([label, value, color], i) => {
                const height = value * unit
                const x = left + i * gap
                return [
                    object(`bar-${i}`, 'rect', x, baseline - height / 2, { width_: 170, height_: height, fill: color, stroke: null }, { name: `${label} bar` }),
                    object(`value-${i}`, 'text', x, baseline - height - 40, { content: String(value), font: 'mono', size: 38 }, { name: `${label} value` }),
                    object(`label-${i}`, 'text', x, baseline + 42, { content: label, font: 'mono', size: 26, color: 'dim' }, { name: `${label} label` }),
                ]
            }),
        ],
        beats: [
            beat('title', 'write', 0, 1.4),
            beat('axis', 'draw', 0.9, 0.7),
            ...data.flatMap((_, i) => [
                beat(`label-${i}`, 'fadeIn', 1.4 + i * 0.5, 0.4, { direction: 'none', distance: 0 }),
                beat(`bar-${i}`, 'grow', 1.5 + i * 0.5, 0.8, {}, 'overshoot'),
                beat(`value-${i}`, 'fadeIn', 2 + i * 0.5, 0.45, { direction: 'up', distance: 14 }),
            ]),
            beat('bar-3', 'indicate', 4.4, 1, { color: 'red', amount: 1.03 }),
        ],
        markers: [],
    }
}

function slideDeck(): StudioProject {
    return {
        ...emptyProject('Three-slide deck'),
        hold: 0.6,
        objects: [
            object('s1-title', 'text', 0, -40, { content: 'Ship the idea, not the slides', font: 'text-serif', size: 104 }, { name: 'Slide 1 title' }),
            object('s1-sub', 'text', 0, 70, { content: 'A deck that animates with the argument', size: 34, color: 'dim' }, { name: 'Slide 1 subtitle' }),
            object('s2-title', 'text', -325, -280, { content: 'Claim', font: 'text-serif', size: 76 }, { name: 'Slide 2 title' }),
            object('s2-a', 'text', 15, -120, { content: 'Press the right arrow to step through chapters.', size: 38, align: 'left' }, { name: 'Point one' }),
            object('s2-b', 'text', -56, -30, { content: 'Each chapter plays, then waits for you.', size: 38, align: 'left' }, { name: 'Point two' }),
            object('s2-c', 'text', -12, 60, { content: 'Export the same film as an MP4 afterwards.', size: 38, align: 'left' }, { name: 'Point three' }),
            object('s3-eq', 'tex', 0, -30, { source: '\\int_0^1 x^2\\,dx = \\frac{1}{3}', size: 120, color: 'yellow' }, { name: 'Closing equation' }),
            object('s3-note', 'text', 0, 170, { content: 'Close on the one thing to remember.', font: 'text-serif', italic: true, size: 48, color: 'dim' }, { name: 'Closing note' }),
        ],
        beats: [
            beat('s1-title', 'write', 0, 1.5),
            beat('s1-sub', 'fadeIn', 1.3, 0.7, { direction: 'up', distance: 20 }),
            beat('s1-title', 'fadeOut', 3, 0.5, { direction: 'none', distance: 0 }),
            beat('s1-sub', 'fadeOut', 3, 0.5, { direction: 'none', distance: 0 }),
            beat('s2-title', 'write', 3.4, 0.9),
            beat('s2-a', 'fadeIn', 4.2, 0.6, { direction: 'right', distance: 30 }),
            beat('s2-b', 'fadeIn', 4.6, 0.6, { direction: 'right', distance: 30 }),
            beat('s2-c', 'fadeIn', 5, 0.6, { direction: 'right', distance: 30 }),
            beat('s2-title', 'fadeOut', 6.4, 0.5, { direction: 'none', distance: 0 }),
            beat('s2-a', 'fadeOut', 6.4, 0.5, { direction: 'none', distance: 0 }),
            beat('s2-b', 'fadeOut', 6.4, 0.5, { direction: 'none', distance: 0 }),
            beat('s2-c', 'fadeOut', 6.4, 0.5, { direction: 'none', distance: 0 }),
            beat('s3-eq', 'write', 6.8, 1.8),
            beat('s3-note', 'fadeIn', 8.4, 0.7, { direction: 'up', distance: 20 }),
        ],
        markers: [
            { id: 'm-1', time: 2.2, title: 'Title' },
            { id: 'm-2', time: 5.8, title: 'Claim' },
            { id: 'm-3', time: 9.2, title: 'Close' },
        ],
    }
}

function gridTransform(): StudioProject {
    return {
        ...emptyProject('A matrix bends space'),
        hold: 1.2,
        objects: [
            object('grid', 'plane', 0, 0, { unit: 130, color: 'blue', lineWidth: 1.5 }, { name: 'Plane' }),
            object('matrix', 'tex', -640, -370, { source: '\\begin{bmatrix} 1 & 1 \\\\ 0 & 1 \\end{bmatrix}', size: 70, color: 'yellow' }, { name: 'Matrix' }),
            object('caption', 'text', 560, 420, { content: 'Every line stays straight.', font: 'text-serif', size: 52 }),
        ],
        beats: [
            beat('grid', 'draw', 0, 2),
            beat('matrix', 'write', 1.6, 1.2),
            beat('grid', 'applyMatrix', 3.2, 2.4, { a: 1, b: 1, c: 0, d: 1 }),
            beat('caption', 'write', 5.4, 1.2),
        ],
        markers: [],
    }
}

export const TEMPLATES: readonly Template[] = [
    { id: 'explainer', title: 'Explainer', description: 'A curve, a formula, and a value that drives both.', thumb: 11.6, project: explainer },
    { id: 'equation', title: 'Equation story', description: 'Symbols travel from step to step.', thumb: 8.8, project: equationStory },
    { id: 'architecture', title: 'Architecture walkthrough', description: 'Dense system nodes draw in, then one request travels through.', thumb: 7.3, project: architecture },
    { id: 'chart', title: 'Chart reveal', description: 'Bars rise one at a time, on paper.', thumb: 5.6, project: chartReveal },
    { id: 'deck', title: 'Slide deck', description: 'Chapters for presenting, one arrow key at a time.', thumb: 5.8, project: slideDeck },
    { id: 'grid', title: 'Grid transformation', description: 'A number plane under a 2x2 matrix.', thumb: 7, project: gridTransform },
]
