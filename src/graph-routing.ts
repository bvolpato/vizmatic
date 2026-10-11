export type GraphRouting = 'dagre' | 'straight' | 'orthogonal'
export type GraphPortSide = 'top' | 'right' | 'bottom' | 'left'

export interface RoutingPoint { x: number; y: number }
export interface RoutingPort { id: string; side: GraphPortSide; offset?: number }
export interface RoutingNode {
    id: string
    cx: number
    cy: number
    width: number
    height: number
    ports?: RoutingPort[]
}
export interface RoutingEdge {
    from: string
    to: string
    fromPort?: string
    toPort?: string
    fromSide?: GraphPortSide
    toSide?: GraphPortSide
}
export interface RoutingObstacle { left: number; top: number; right: number; bottom: number }
export interface RoutingFailure { index: number; reason: string }

const EPSILON = 0.001
const MAX_GRID_POINTS = 18_000
const MAX_SEARCH_STATES = 54_000
const MAX_TOTAL_SEARCH_STATES = 160_000
const MAX_ROUTED_EDGES = 256
const MAX_OBSTACLES = 64
const sides: GraphPortSide[] = ['right', 'bottom', 'left', 'top']

function box(node: RoutingNode, clearance = 0): RoutingObstacle {
    return {
        left: node.cx - node.width / 2 - clearance,
        right: node.cx + node.width / 2 + clearance,
        top: node.cy - node.height / 2 - clearance,
        bottom: node.cy + node.height / 2 + clearance,
    }
}

function inside(point: RoutingPoint, obstacle: RoutingObstacle): boolean {
    return point.x > obstacle.left + EPSILON && point.x < obstacle.right - EPSILON
        && point.y > obstacle.top + EPSILON && point.y < obstacle.bottom - EPSILON
}

export function routingSegmentBlocked(a: RoutingPoint, b: RoutingPoint, obstacle: RoutingObstacle): boolean {
    if (Math.abs(a.y - b.y) < EPSILON) {
        return a.y > obstacle.top + EPSILON && a.y < obstacle.bottom - EPSILON
            && Math.max(a.x, b.x) > obstacle.left + EPSILON && Math.min(a.x, b.x) < obstacle.right - EPSILON
    }
    if (Math.abs(a.x - b.x) < EPSILON) {
        return a.x > obstacle.left + EPSILON && a.x < obstacle.right - EPSILON
            && Math.max(a.y, b.y) > obstacle.top + EPSILON && Math.min(a.y, b.y) < obstacle.bottom - EPSILON
    }
    return true
}

function preferredSide(from: RoutingNode, to: RoutingNode): GraphPortSide {
    if (Math.abs(to.cx - from.cx) >= Math.abs(to.cy - from.cy)) return to.cx >= from.cx ? 'right' : 'left'
    return to.cy >= from.cy ? 'bottom' : 'top'
}

export function routingAnchor(node: RoutingNode, side: GraphPortSide, offset = 0.5): RoutingPoint {
    const bounds = box(node)
    if (side === 'left' || side === 'right') return { x: bounds[side], y: bounds.top + node.height * offset }
    return { x: bounds.left + node.width * offset, y: bounds[side] }
}

function outward(point: RoutingPoint, side: GraphPortSide, distance: number): RoutingPoint {
    return {
        x: point.x + (side === 'right' ? distance : side === 'left' ? -distance : 0),
        y: point.y + (side === 'bottom' ? distance : side === 'top' ? -distance : 0),
    }
}

function simplify(points: RoutingPoint[]): RoutingPoint[] {
    const result: RoutingPoint[] = []
    for (const point of points) {
        const last = result[result.length - 1]
        if (last && Math.abs(last.x - point.x) < EPSILON && Math.abs(last.y - point.y) < EPSILON) continue
        const previous = result[result.length - 2]
        if (previous && last && ((previous.x === last.x && last.x === point.x) || (previous.y === last.y && last.y === point.y))) {
            result[result.length - 1] = point
        } else result.push(point)
    }
    return result
}

function overlappingLength(a: RoutingPoint, b: RoutingPoint, c: RoutingPoint, d: RoutingPoint): number {
    if (a.y === b.y && c.y === d.y && Math.abs(a.y - c.y) < EPSILON) {
        return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)))
    }
    if (a.x === b.x && c.x === d.x && Math.abs(a.x - c.x) < EPSILON) {
        return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)))
    }
    return 0
}

interface QueueEntry { state: number; cost: number; priority: number }

class MinQueue {
    private items: QueueEntry[] = []
    get length(): number { return this.items.length }
    push(value: QueueEntry): void {
        const items = this.items
        items.push(value)
        let index = items.length - 1
        while (index > 0) {
            const parent = (index - 1) >> 1
            if (items[parent].priority <= value.priority) break
            items[index] = items[parent]
            index = parent
        }
        items[index] = value
    }
    pop(): QueueEntry {
        const items = this.items
        const first = items[0]
        const last = items.pop()!
        if (items.length === 0) return first
        let index = 0
        while (index * 2 + 1 < items.length) {
            const left = index * 2 + 1
            const right = left + 1
            const child = right < items.length && items[right].priority < items[left].priority ? right : left
            if (items[child].priority >= last.priority) break
            items[index] = items[child]
            index = child
        }
        items[index] = last
        return first
    }
}

function findPath(
    start: RoutingPoint,
    end: RoutingPoint,
    obstacles: RoutingObstacle[],
    width: number,
    height: number,
    previousRoutes: RoutingPoint[][],
    gap: number,
    budget: { remaining: number },
): { points?: RoutingPoint[]; reason?: string } {
    const within = (point: RoutingPoint) => point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
    if (!within(start) || !within(end) || obstacles.some((obstacle) => inside(start, obstacle) || inside(end, obstacle))) {
        return { reason: 'an endpoint has no clear exit inside the canvas' }
    }
    const xs = new Set([0, width, start.x, end.x])
    const ys = new Set([0, height, start.y, end.y])
    for (const obstacle of obstacles) {
        if (obstacle.left >= 0 && obstacle.left <= width) xs.add(obstacle.left)
        if (obstacle.right >= 0 && obstacle.right <= width) xs.add(obstacle.right)
        if (obstacle.top >= 0 && obstacle.top <= height) ys.add(obstacle.top)
        if (obstacle.bottom >= 0 && obstacle.bottom <= height) ys.add(obstacle.bottom)
    }
    // Nearby lanes let repeated relationships share a port without sharing the complete route.
    for (const route of previousRoutes.slice(-8)) for (const point of route) {
        for (const offset of [-gap, gap]) {
            if (point.x + offset >= 0 && point.x + offset <= width) xs.add(point.x + offset)
            if (point.y + offset >= 0 && point.y + offset <= height) ys.add(point.y + offset)
        }
    }
    const xValues = [...xs].sort((a, b) => a - b)
    const yValues = [...ys].sort((a, b) => a - b)
    const columns = xValues.length
    const gridSize = columns * yValues.length
    if (gridSize > MAX_GRID_POINTS) return { reason: `routing grid exceeds ${MAX_GRID_POINTS} points; simplify the graph` }
    const startIndex = yValues.indexOf(start.y) * columns + xValues.indexOf(start.x)
    const endIndex = yValues.indexOf(end.y) * columns + xValues.indexOf(end.x)
    const pointAt = (index: number): RoutingPoint => ({ x: xValues[index % columns], y: yValues[Math.floor(index / columns)] })
    const costs = new Float64Array(gridSize * 3).fill(Infinity)
    const parents = new Int32Array(gridSize * 3).fill(-1)
    const queue = new MinQueue()
    costs[startIndex * 3] = 0
    queue.push({ state: startIndex * 3, cost: 0, priority: 0 })
    let visits = 0
    while (queue.length > 0) {
        if (--budget.remaining < 0) return { reason: `diagram routing budget exceeds ${MAX_TOTAL_SEARCH_STATES} search states; simplify the graph` }
        if (++visits > MAX_SEARCH_STATES) return { reason: `routing search exceeds ${MAX_SEARCH_STATES} states; simplify the graph` }
        const current = queue.pop()
        if (current.cost !== costs[current.state]) continue
        const index = Math.floor(current.state / 3)
        const axis = current.state % 3
        if (index === endIndex) {
            const points: RoutingPoint[] = []
            for (let state = current.state; state >= 0; state = parents[state]) points.push(pointAt(Math.floor(state / 3)))
            return { points: simplify(points.reverse()) }
        }
        const a = pointAt(index)
        const column = index % columns
        const row = Math.floor(index / columns)
        const neighbors = [column > 0 ? index - 1 : -1, column < columns - 1 ? index + 1 : -1,
            row > 0 ? index - columns : -1, row < yValues.length - 1 ? index + columns : -1]
        for (const neighbor of neighbors) {
            if (neighbor < 0) continue
            const b = pointAt(neighbor)
            if (obstacles.some((obstacle) => routingSegmentBlocked(a, b, obstacle))) continue
            const nextAxis = a.y === b.y ? 1 : 2
            const state = neighbor * 3 + nextAxis
            let overlap = 0
            for (const route of previousRoutes) for (let i = 1; i < route.length; i++) overlap += overlappingLength(a, b, route[i - 1], route[i])
            const cost = current.cost + Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
                + (axis !== 0 && axis !== nextAxis ? 18 : 0) + overlap * 5
            if (cost >= costs[state]) continue
            costs[state] = cost
            parents[state] = current.state
            queue.push({ state, cost, priority: cost + Math.abs(end.x - b.x) + Math.abs(end.y - b.y) })
        }
    }
    return { reason: 'no obstacle-free route exists inside the canvas' }
}

function endpoint(
    node: RoutingNode,
    other: RoutingNode,
    portId: string | undefined,
    requestedSide: GraphPortSide | undefined,
    selfLoop: boolean,
    target: boolean,
    ordinal: number,
    count: number,
    gap: number,
): { side: GraphPortSide; anchor: RoutingPoint; explicit: boolean } {
    const port = node.ports?.find((candidate) => candidate.id === portId)
    const side = port?.side ?? requestedSide ?? (selfLoop ? target ? 'top' : 'right' : preferredSide(node, other))
    const length = side === 'left' || side === 'right' ? node.height : node.width
    const separation = count > 1 ? Math.min(gap, length * 0.7 / (count - 1)) : 0
    const offset = port ? port.offset ?? 0.5 : (0.5 + (ordinal - (count - 1) / 2) * separation / length)
    return { side, anchor: routingAnchor(node, side, offset), explicit: portId != null || requestedSide != null }
}

export function straightGraphRoute(from: RoutingNode, to: RoutingNode, edge: RoutingEdge): RoutingPoint[] {
    return [endpoint(from, to, edge.fromPort, edge.fromSide, false, false, 0, 1, 0).anchor,
        endpoint(to, from, edge.toPort, edge.toSide, false, true, 0, 1, 0).anchor]
}

/** Route within the canvas. Failed edges are reported rather than drawn through obstacles. */
export function routeOrthogonalGraph(
    nodes: RoutingNode[],
    edges: RoutingEdge[],
    width: number,
    height: number,
    clearance = 12,
    gap = 14,
    extraObstacles: RoutingObstacle[] = [],
): { routes: Map<number, RoutingPoint[]>; failures: RoutingFailure[] } {
    const routes = new Map<number, RoutingPoint[]>()
    const failures: RoutingFailure[] = []
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const obstacles = [...nodes.map((node) => box(node, clearance)), ...extraObstacles.map((obstacle) => ({
        left: obstacle.left - clearance, right: obstacle.right + clearance,
        top: obstacle.top - clearance, bottom: obstacle.bottom + clearance,
    }))]
    const routeKey = (edge: RoutingEdge) => [edge.from, edge.to].sort().join('\u0000')
    const counts = new Map<string, number>()
    for (const edge of edges) counts.set(routeKey(edge), (counts.get(routeKey(edge)) ?? 0) + 1)
    const occurrences = new Map<string, number>()
    const previous = new Map<string, RoutingPoint[][]>()
    const budget = { remaining: MAX_TOTAL_SEARCH_STATES }
    edges.forEach((edge, index) => {
        if (index >= MAX_ROUTED_EDGES) {
            failures.push({ index, reason: `orthogonal routing supports at most ${MAX_ROUTED_EDGES} edges per diagram` })
            return
        }
        if (obstacles.length > MAX_OBSTACLES) {
            failures.push({ index, reason: `orthogonal routing supports at most ${MAX_OBSTACLES} node and header obstacles per diagram` })
            return
        }
        if (budget.remaining < 0) {
            failures.push({ index, reason: `diagram routing budget exceeds ${MAX_TOTAL_SEARCH_STATES} search states; simplify the graph` })
            return
        }
        const from = byId.get(edge.from)!
        const to = byId.get(edge.to)!
        const key = routeKey(edge)
        const ordinal = occurrences.get(key) ?? 0
        occurrences.set(key, ordinal + 1)
        const count = counts.get(key) ?? 1
        const source = endpoint(from, to, edge.fromPort, edge.fromSide, from === to, false, ordinal, count, gap)
        const target = endpoint(to, from, edge.toPort, edge.toSide, from === to, true, ordinal, count, gap)
        const sourceSides = source.explicit ? [source.side] : [source.side, ...sides.filter((side) => side !== source.side)]
        const targetSides = target.explicit ? [target.side] : [target.side, ...sides.filter((side) => side !== target.side)]
        let failure = 'no obstacle-free route exists inside the canvas'
        for (const sourceSide of sourceSides) {
            for (const targetSide of targetSides) {
                const start = sourceSide === source.side ? source.anchor : routingAnchor(from, sourceSide)
                const end = targetSide === target.side ? target.anchor : routingAnchor(to, targetSide)
                if (from === to && start.x === end.x && start.y === end.y) {
                    failure = 'a self-loop requires distinct endpoint anchors'
                    continue
                }
                const leadStart = outward(start, sourceSide, clearance)
                const leadEnd = outward(end, targetSide, clearance)
                if (obstacles.some((obstacle, obstacleIndex) =>
                    (obstacleIndex !== nodes.indexOf(from) && routingSegmentBlocked(start, leadStart, obstacle))
                    || (obstacleIndex !== nodes.indexOf(to) && routingSegmentBlocked(leadEnd, end, obstacle)))) {
                    failure = 'another obstacle blocks an endpoint exit'
                    continue
                }
                const result = findPath(leadStart, leadEnd, obstacles, width, height, previous.get(key) ?? [], Math.max(1, gap), budget)
                if (!result.points) {
                    failure = result.reason!
                    if (/routing (grid|search|budget)/.test(failure)) {
                        failures.push({ index, reason: failure })
                        return
                    }
                    continue
                }
                const points = simplify([start, ...result.points, end])
                if (points.length < 2) continue
                const repeated = (previous.get(key) ?? []).some((route) => route.length === points.length && (
                    route.every((point, position) => point.x === points[position].x && point.y === points[position].y)
                    || route.every((point, position) => point.x === points[points.length - 1 - position].x && point.y === points[points.length - 1 - position].y)
                ))
                if (repeated) {
                    failure = 'parallel connectors have no separate lane at the requested clearance'
                    continue
                }
                routes.set(index, points)
                previous.set(key, [...(previous.get(key) ?? []), points])
                return
            }
        }
        failures.push({ index, reason: failure })
    })
    return { routes, failures }
}

export function routingLabelPosition(points: RoutingPoint[]): RoutingPoint {
    let longest = 0
    let position = points[0]
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
        if (length > longest) {
            longest = length
            position = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        }
    }
    return position
}
