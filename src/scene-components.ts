/** Explicit names keep the editable scene language separate from the Node API. */
export const SCENE_COMPONENT_NAMES = Object.freeze([
    'Arrow', 'ArrowMarkerDef', 'AxisPlot', 'Badge', 'BadgePill', 'BarChart', 'Board', 'Box',
    'CalloutCard', 'Canvas', 'CanvasItem', 'Card', 'ChartFrame', 'CodeBlock', 'Column',
    'Comparison', 'Connector', 'DashedLine', 'DataTable', 'DataflowDiagram', 'DeploymentDiagram',
    'DetailList', 'DonutChart', 'DotPoint', 'EquationCard', 'Flow', 'FlowArrow', 'GradientChip',
    'GraphDiagram', 'Grid', 'Heatmap', 'Icon', 'IntervalPlot', 'KeyValueList', 'LayeredNetwork',
    'Legend', 'LineChart', 'MathText', 'Matrix', 'MetricCard', 'MiniBarChart', 'Panel',
    'ParetoBarChart', 'ParetoChart', 'PieChart', 'Pipeline', 'ProgressList', 'ProgressRow',
    'QuadrantChart', 'Row', 'ScatterPlot', 'Scene', 'SequenceDiagram', 'Stack', 'StackedBar',
    'StatusList', 'StatusRow', 'StepCard', 'SvgFrame', 'SvgMathText', 'SvgPoint', 'TextLabel',
    'Tile', 'TileGrid', 'TiledMatrix', 'Timeline', 'TitleBar', 'ToneStrip', 'TransformerTopology',
    'TreeDiagram', 'ValuePill', 'VectorArrow', 'VectorSegment', 'WindowFrame',
] as const)

export const SCENE_DOM_TAGS = Object.freeze([
    'div', 'span', 'p', 'strong', 'em', 'b', 'i', 'br',
    'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'defs', 'clipPath', 'linearGradient', 'radialGradient', 'stop',
    'pattern', 'marker', 'mask', 'title', 'desc', 'use',
] as const)
