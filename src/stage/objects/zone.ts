import { parseSvgPath, unionBounds, type Bounds } from '../geometry'
import { Node } from '../node'
import { rect, shape } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'

export interface ZoneOptions {
    /** The name of the zone. It sits in a gap of the top border. */
    label?: string
    /** Where the label sits along the top border. Defaults to left. */
    labelAlign?: 'left' | 'center' | 'right'
    /** Space between the content and the border. Defaults to 32. */
    padding?: number
    /** The color of the border and the label. Defaults to dim. */
    color?: ColorInput
    /** A dashed border, for a boundary that is a rule and not a wall. Pass true for the default pattern. */
    dash?: boolean | readonly number[]
    /** The fill inside the border. Defaults to none. */
    fill?: ColorInput | null
    /** Opacity of the fill. Defaults to 0.12, so that the content stays the strongest thing in the zone. */
    fillOpacity?: number
    radius?: number
    /** Width of the border. Defaults to 2.5. */
    borderWidth?: number
    /** Font size of the label. Defaults to 26. */
    labelSize?: number
    font?: TextOptions['font']
    /** Give the zone this size when the content is smaller, so that zones of a row have one size. */
    minWidth?: number
    minHeight?: number
}

/**
 * A border around a group of nodes, with a name on it: a host, a network, a sandbox, a boundary of trust.
 * The zone measures its content when it is built and takes the content as its children, so the zone and
 * what it holds move, fade, and scale as one node. A zone can hold other zones.
 */
export class Zone extends Node {
    /** The border. With a label it is an open line, so `draw(zone.frame)` traces it from one side of the label to the other. */
    readonly frame: Node
    /** The fill inside the border, or null when the zone has none. */
    readonly backdrop: Node | null
    /** The label, or null when the zone has none. */
    readonly caption: Node | null
    /** The nodes inside the border, in the order given. */
    readonly content: readonly Node[]
    /** The inner edge of the border, in the coordinates in which the content was built. */
    readonly box: Bounds

    constructor(content: Node | readonly Node[], options: ZoneOptions = {}) {
        super()
        const nodes = content instanceof Node ? [content] : [...content]
        if (nodes.length === 0) throw new Error('zone: give it at least one node to enclose')
        for (const node of nodes) {
            if (node.parent) throw new Error('zone: a node of the content is already on the stage or in a group. Build the zone first, then add the zone')
        }
        let around: Bounds | null = null
        for (const node of nodes) around = unionBounds(around, node.bounds())
        if (!around) throw new Error('zone: the content has no size')

        const padding = options.padding ?? 32
        const color = options.color ?? 'dim'
        const labelSize = options.labelSize ?? 26
        const borderWidth = options.borderWidth ?? 2.5
        const label = options.label ? text(options.label, { size: labelSize, font: options.font, color }) : null
        const labelWidth = label ? label.get('px') * 2 : 0
        const inset = Math.max(options.radius ?? 16, 20)
        // The label needs the top border to be wider than itself, with room on both sides.
        const width = Math.max(around.width + padding * 2, options.minWidth ?? 0, label ? labelWidth + inset * 2 + labelSize * 1.6 : 0)
        // Half of the label is inside the border, so the content gets that much more room at the top.
        const head = label ? labelSize * 0.5 : 0
        const height = Math.max(around.height + padding * 2 + head, options.minHeight ?? 0)
        const cx = around.x + around.width / 2, cy = around.y + around.height / 2 - head / 2
        this.box = { x: cx - width / 2, y: cy - height / 2, width, height }

        const radius = Math.min(options.radius ?? 16, width / 2, height / 2)
        const { x, y } = this.box
        const right = x + width, bottom = y + height
        let gap: [number, number] | null = null
        if (label) {
            const align = options.labelAlign ?? 'left'
            const half = labelWidth / 2 + labelSize * 0.45
            const at = align === 'left' ? x + inset + half : align === 'right' ? right - inset - half : cx
            gap = [at - half, at + half]
            label.at(at, y)
        }
        // With a label, the border starts after the label, goes around, and stops before it.
        this.frame = gap
            ? shape(parseSvgPath(`M${gap[1]} ${y}H${right - radius}A${radius} ${radius} 0 0 1 ${right} ${y + radius}V${bottom - radius}A${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`
                + `H${x + radius}A${radius} ${radius} 0 0 1 ${x} ${bottom - radius}V${y + radius}A${radius} ${radius} 0 0 1 ${x + radius} ${y}H${gap[0]}`), { stroke: color, width: borderWidth })
            : rect(width, height, { radius, stroke: color, width: borderWidth }).at(cx, cy)
        if (options.dash) this.frame.dash(options.dash === true ? [borderWidth * 4, borderWidth * 3.2] : options.dash)
        this.backdrop = options.fill ? rect(width, height, { radius, fill: options.fill, stroke: null }).at(cx, cy) : null
        if (this.backdrop) this.backdrop.set('fillOpacity', options.fillOpacity ?? 0.12)
        this.add(...(this.backdrop ? [this.backdrop] : []), this.frame, ...nodes)
        this.content = nodes
        this.caption = label
        if (label) this.add(label)
    }
}

/** A named border around nodes, such as `zone([vmm, guest], { label: 'jail', dash: true })`. */
export function zone(content: Node | readonly Node[], options: ZoneOptions = {}): Zone {
    return new Zone(content, options)
}
