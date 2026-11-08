import { parseSvgPath, pathLength, unionBounds, type Bounds } from '../geometry'
import { Node } from '../node'
import { rect, shape } from '../shapes'
import { text, type TextOptions } from '../text'
import type { ColorInput } from '../color'

export interface ZoneOptions {
    /** The name of the zone. It sits in a gap of the top border. */
    title?: string
    /** Where the title sits along the top border. Defaults to left. */
    titleAlign?: 'left' | 'center' | 'right'
    /** Font size of the title. Defaults to 26. */
    titleSize?: number
    /** Space between the content and the border. Defaults to 32. */
    padding?: number
    /** The color of the border and the title. Defaults to dim. */
    color?: ColorInput
    /** A dashed border, for a boundary that is a rule and not a wall. Pass true for the default pattern. */
    dash?: boolean | readonly number[]
    /** The fill inside the border. Defaults to none. Its top edge runs behind the title, so keep it faint. */
    fill?: ColorInput | null
    /** Opacity of the fill. Defaults to 0.12, so that the content stays the strongest thing in the zone. */
    fillOpacity?: number
    radius?: number
    /** Width of the border. Defaults to 2.5. */
    borderWidth?: number
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
    /** The border. With a title it is an open line, so `draw(zone.frame)` traces it from one side of the title to the other. */
    readonly frame: Node
    /** The fill inside the border, or null when the zone has none. */
    readonly backdrop: Node | null
    /** The title on the border, or null when the zone has none. */
    readonly title: Node | null
    /** The nodes inside the border, in the order given. */
    readonly content: readonly Node[]
    /** The middle line of the border, in the coordinates of the zone, where (0, 0) is the middle of the border. */
    readonly box: Bounds

    constructor(content: Node | readonly Node[], options: ZoneOptions = {}) {
        super()
        const nodes = content instanceof Node ? [content] : [...content]
        if (nodes.length === 0) throw new Error('zone: give it at least one node to enclose')
        nodes.forEach((node, index) => {
            if (node.parent) throw new Error(`zone: node ${index} of the content${node.label ? ` (${node.label})` : ''} is already on the stage or in a group. Build the zone first, then add the zone`)
        })
        // An empty group has no size and no place, so it must not pull the border toward the origin.
        let around: Bounds | null = null
        for (const node of nodes) {
            const bounds = node.bounds()
            if (bounds.width > 0 || bounds.height > 0) around = unionBounds(around, bounds)
        }
        if (!around) throw new Error('zone: the content has no size')

        const padding = options.padding ?? 32
        const color = options.color ?? 'dim'
        const titleSize = options.titleSize ?? 26
        const borderWidth = options.borderWidth ?? 2.5
        const title = options.title ? text(options.title, { size: titleSize, font: options.font, color }) : null
        const titleWidth = title ? title.get('px') * 2 : 0
        // The lower half of the title is inside the border, so the content gets that much more room at the top.
        const head = title ? titleSize * 0.7 : 0
        const height = Math.max(around.height + padding * 2 + head, options.minHeight ?? 0)
        const radius = Math.max(0, Math.min(options.radius ?? 16, height / 2))
        const inset = Math.max(radius, 20)
        // The title needs the top border to be wider than itself, with a piece of line on both sides.
        const width = Math.max(around.width + padding * 2, options.minWidth ?? 0, title ? titleWidth + inset * 2 + titleSize * 1.6 : 0, radius * 2)
        const cx = around.x + around.width / 2, cy = around.y + around.height / 2 - head / 2
        const x = -width / 2, y = -height / 2, right = width / 2, bottom = height / 2
        this.box = { x, y, width, height }

        let gap: [number, number] | null = null
        if (title) {
            const align = options.titleAlign ?? 'left'
            const half = titleWidth / 2 + titleSize * 0.45
            const at = align === 'left' ? x + inset + half : align === 'right' ? right - inset - half : 0
            gap = [at - half, at + half]
            title.at(at, y)
        }
        // With a title, the border starts after the title, goes around, and stops before it.
        this.frame = gap
            ? shape(parseSvgPath(`M${gap[1]} ${y}H${right - radius}A${radius} ${radius} 0 0 1 ${right} ${y + radius}V${bottom - radius}A${radius} ${radius} 0 0 1 ${right - radius} ${bottom}`
                + `H${x + radius}A${radius} ${radius} 0 0 1 ${x} ${bottom - radius}V${y + radius}A${radius} ${radius} 0 0 1 ${x + radius} ${y}H${gap[0]}`), { stroke: color, width: borderWidth })
            : rect(width, height, { radius, stroke: color, width: borderWidth })
        if (options.dash) {
            const [on, off] = options.dash === true ? [borderWidth * 4, borderWidth * 3.2] : [options.dash[0] ?? 10, options.dash[1] ?? options.dash[0] ?? 10]
            // Fit a whole number of dashes to the border, so that it does not end in a stub beside the title.
            const length = pathLength(this.frame.get('path')!) + (gap ? off : 0)
            const scale = length / (Math.max(1, Math.round(length / (on + off))) * (on + off))
            this.frame.dash([on * scale, off * scale])
        }
        this.backdrop = options.fill ? rect(width, height, { radius, fill: options.fill, stroke: null }) : null
        if (this.backdrop) this.backdrop.set('fillOpacity', options.fillOpacity ?? 0.12)
        // The content was built in its own place. Keep it there, with the middle of the border as the origin of the zone.
        for (const node of nodes) node.shift(-cx, -cy)
        this.add(...(this.backdrop ? [this.backdrop] : []), this.frame, ...nodes)
        this.content = nodes
        this.title = title
        if (title) this.add(title)
        this.at(cx, cy)
    }
}

/** A named border around nodes, such as `zone([vmm, guest], { title: 'jail', dash: true })`. `.at(x, y)` places its middle. */
export function zone(content: Node | readonly Node[], options: ZoneOptions = {}): Zone {
    return new Zone(content, options)
}
