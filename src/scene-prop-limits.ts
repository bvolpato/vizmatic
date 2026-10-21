import type { SceneJson } from './scene-contract'

type Props = Record<string, SceneJson>

function integer(value: SceneJson | undefined, name: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(`Editable scene ${name} must be an integer from ${min} to ${max}.`)
    }
    return value
}

function finite(value: SceneJson | undefined, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 32_768) {
        throw new Error(`Editable scene ${name} must be finite and within 32768 canvas units.`)
    }
    return value
}

function entries(value: SceneJson | undefined, name: string, max: number): SceneJson[] {
    if (value === undefined) return []
    if (!Array.isArray(value) || value.length > max) throw new Error(`Editable scene ${name} supports at most ${max} entries.`)
    return value
}

function record(value: SceneJson, name: string): Props {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Editable scene ${name} must be an object.`)
    return value
}

/** Bound expansion before trusted components allocate elements or run layout loops. */
export function validateSceneComponentProps(name: string, props: Props): void {
    let values = 0
    const check = (value: SceneJson, key: string): void => {
        if (++values > 8_192) throw new Error(`Editable scene ${name} props exceed their value budget.`)
        if (typeof value === 'number') {
            if (/^(?:width|height|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|radius|length|padding|gap|nodeWidth|nodeHeight|cellSize|cellWidth|cellHeight|fontSize|nodeSize|tileWidth|minHeight)$/i.test(key)) finite(value, `${name}.${key}`)
            if (/^(?:rows|cols|columns|count|repeat|gridCount|tickCount)$/i.test(key)) integer(value, `${name}.${key}`, key === 'gridCount' ? 0 : 1, 2_000)
        }
        if (Array.isArray(value)) value.forEach((item) => check(item, ''))
        else if (value && typeof value === 'object') {
            // Nested JSX receives its own component guard. Count it here, but do
            // not reinterpret a child's unrelated properties as this component.
            if (value.kind !== 'vizmatic.element') Object.entries(value).forEach(([property, item]) => check(item, property))
        }
    }
    Object.entries(props).forEach(([key, value]) => check(value, key))

    if (name === 'DashedLine') {
        const x1 = finite(props.x1, 'DashedLine.x1'), y1 = finite(props.y1, 'DashedLine.y1')
        const x2 = finite(props.x2, 'DashedLine.x2'), y2 = finite(props.y2, 'DashedLine.y2')
        const spacing = props.dotSpacing ?? 8
        if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0
            || Math.hypot(x2 - x1, y2 - y1) / spacing > 2_000) {
            throw new Error('Editable scene DashedLine requires positive dotSpacing and at most 2000 dots.')
        }
    }
    if (name === 'TileGrid' && props.columns !== undefined) integer(props.columns, 'TileGrid.columns', 1, 2_000)
    if (name === 'TiledMatrix') {
        const rows = integer(props.rows, 'TiledMatrix.rows', 1, 2_000)
        const cols = integer(props.cols, 'TiledMatrix.cols', 1, 2_000)
        if (rows * cols > 2_000) throw new Error('Editable scene TiledMatrix supports at most 2000 cells.')
    }
    if (name === 'AxisPlot' && props.gridCount !== undefined) integer(props.gridCount, 'AxisPlot.gridCount', 0, 100)
    if (['GraphDiagram', 'DataflowDiagram', 'DeploymentDiagram', 'TransformerTopology'].includes(name)) {
        for (const key of ['nodes', 'groups', 'boundaries', 'blocks']) entries(props[key], `${name}.${key}`, 128)
        for (const key of ['edges', 'connections', 'routes']) entries(props[key], `${name}.${key}`, 256)
    }
    if (name === 'TransformerTopology' && props.expandRepeats) {
        const blocks = entries(props.blocks, 'TransformerTopology.blocks', 128)
        const total = blocks.reduce<number>((sum, block) => sum + integer(record(block, 'Transformer block').repeat ?? 1, 'Transformer block.repeat', 1, 128), 0)
        if (total > 128) throw new Error('Editable scene TransformerTopology expands to at most 128 nodes.')
    }
    if (name === 'LayeredNetwork') {
        const layers = entries(props.layers, 'LayeredNetwork.layers', 16)
        const counts = layers.map((layer) => entries(record(layer, 'Network layer').nodes, 'Network layer.nodes', 32).length)
        const edges = counts.reduce((sum, count, index) => sum + count * (counts[index - 1] ?? 0), 0)
        if (edges > 1_024) throw new Error('Editable scene LayeredNetwork supports at most 1024 connections.')
    }
    if (name === 'TreeDiagram' && props.root !== undefined) {
        let count = 0
        const tree = (node: SceneJson): void => {
            if (++count > 128) throw new Error('Editable scene TreeDiagram supports at most 128 nodes.')
            entries(record(node, 'Tree node').children, 'Tree node.children', 128).forEach(tree)
        }
        tree(props.root)
    }
    if (name === 'ParetoChart') entries(props.points, 'ParetoChart.points', 512)
}
