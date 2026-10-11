export interface NumberRange {
    min: number
    max: number
    step: number
}

export interface ComponentControlSpec {
    text?: readonly string[]
    tone?: boolean
    selects?: Readonly<Record<string, readonly string[]>>
    numbers?: readonly string[]
    booleans?: readonly string[]
}

export const tones = ['blue', 'purple', 'green', 'warm', 'cyan', 'pink', 'red', 'critical', 'neutral', 'sunset', 'ocean', 'dark'] as const
const directions = ['down', 'right', 'up', 'left'] as const
const textDirection = ['horizontal', 'vertical'] as const
const graphDirection = ['LR', 'RL', 'TB', 'BT'] as const

const layoutNumbers = ['width', 'height']
const chartNumbers = ['width', 'height']

export const componentControlSpecs: Record<string, ComponentControlSpec> = {
    Canvas: { numbers: ['padding'] },
    Board: { numbers: ['width', 'height'] },
    CanvasItem: { numbers: ['x', 'y', 'width', 'height'] },
    Scene: { text: ['title', 'subtitle'], numbers: ['padding', 'gap', 'contentWidth'] },
    TitleBar: { text: ['title', 'subtitle'] },
    Row: { numbers: ['gap', ...layoutNumbers], booleans: ['wrap'] },
    Column: { numbers: ['gap', ...layoutNumbers], booleans: ['wrap'] },
    Stack: { numbers: ['gap'], selects: { direction: textDirection }, booleans: ['wrap'] },
    Panel: { text: ['title', 'subtitle'], tone: true, numbers: ['width', 'height', 'minWidth', 'minHeight', 'padding', 'gap', 'radius', 'titleFontSize'], booleans: ['shadow'] },
    Card: { text: ['title', 'subtitle'], tone: true, numbers: ['width', 'height', 'minWidth', 'minHeight', 'padding', 'gap', 'radius'], booleans: ['shadow'] },
    WindowFrame: {
        text: ['title'], tone: true,
        selects: { variant: ['window', 'browser', 'terminal'] },
        numbers: ['width', 'height', 'minWidth', 'minHeight', 'padding', 'radius'], booleans: ['shadow', 'dots'],
    },
    ToneStrip: { tone: true, numbers: ['width', 'height'] },
    Icon: { tone: true, numbers: ['size', 'strokeWidth'] },
    TextLabel: { text: ['text'], numbers: ['fontSize', 'width'] },
    Badge: { text: ['label'] },
    BadgePill: { text: ['text'], tone: true, numbers: ['width', 'height', 'padding', 'radius', 'fontSize'], booleans: ['mono', 'filled'] },
    GradientChip: { text: ['title', 'subtitle'], tone: true, numbers: ['width', 'height', 'minHeight', 'padding', 'radius'], booleans: ['shadow'] },
    ValuePill: { text: ['label', 'value', 'detail'], tone: true, numbers: ['width'] },
    StepCard: { text: ['title', 'subtitle', 'eyebrow'], tone: true, numbers: ['width', 'minHeight', 'padding', 'radius'], booleans: ['shadow'] },
    MetricCard: { text: ['label', 'value', 'detail'], tone: true, numbers: ['width', 'minHeight', 'padding', 'radius', 'valueFontSize'], booleans: ['shadow'] },
    CalloutCard: { text: ['title', 'detail'], tone: true, numbers: ['width', 'minHeight', 'padding', 'titleFontSize', 'detailFontSize'], booleans: ['filled'] },
    CodeBlock: { text: ['title'], tone: true, numbers: ['width', 'fontSize', 'padding', 'radius'], booleans: ['showLineNumbers', 'shadow'] },
    StatusRow: { text: ['label', 'detail'], tone: true, numbers: ['fontSize', 'width'], selects: { status: ['check', 'cross', 'warn', 'info', 'pending', 'dot'] }, booleans: ['boxed'] },
    Timeline: { text: ['title', 'subtitle'], numbers: ['width', 'eventWidth', 'gap', 'markerSize'], selects: { direction: textDirection } },
    Flow: { numbers: ['gap', 'connectorLength'], selects: { direction: textDirection, connectorTone: tones } },
    ProgressRow: { text: ['label', 'valueLabel'], tone: true, numbers: ['value', 'labelWidth', 'valueWidth', 'barHeight', 'fontSize'] },
    LayeredNetwork: { text: ['formula', 'legend'], numbers: [...chartNumbers, 'nodeSize'], booleans: ['showFormula'] },
    GraphDiagram: {
        text: ['title', 'description'], numbers: ['width', 'height', 'nodeWidth', 'nodeHeight', 'labelFontSize', 'detailFontSize', 'arrowSize', 'padding', 'nodeGap', 'rankGap', 'edgeGap', 'iconSize'],
        selects: { direction: graphDirection, layout: ['auto', 'manual'], sizing: ['content', 'fixed'], routing: ['dagre', 'straight', 'orthogonal'] },
    },
    TreeDiagram: { text: ['title', 'subtitle'], numbers: ['width', 'height', 'nodeWidth', 'nodeHeight', 'levelGap', 'siblingGap', 'padding'] },
    SequenceDiagram: { text: ['title', 'subtitle'], numbers: ['width', 'height', 'padding', 'participantWidth', 'participantGap', 'rowHeight', 'fragmentIndent', 'noteWidth'] },
    DataflowDiagram: { text: ['title', 'description'], numbers: ['width', 'height', 'nodeWidth', 'nodeHeight', 'labelFontSize', 'detailFontSize', 'padding'], selects: { direction: graphDirection } },
    DeploymentDiagram: { text: ['title', 'description'], numbers: ['width', 'height', 'nodeWidth', 'nodeHeight', 'labelFontSize', 'detailFontSize', 'padding'], selects: { direction: graphDirection } },
    TransformerTopology: { text: ['title', 'description'], numbers: ['width', 'height', 'nodeWidth', 'nodeHeight', 'labelFontSize', 'detailFontSize', 'padding'], selects: { direction: graphDirection } },
    Matrix: { text: ['title'], numbers: ['cellWidth', 'cellHeight', 'rowLabelWidth'] },
    Heatmap: { text: ['title', 'subtitle'], numbers: ['cellWidth', 'cellHeight', 'rowLabelWidth'] },
    TiledMatrix: { text: ['title', 'subtitle'], tone: true, numbers: ['rows', 'cols', 'cellSize', 'gap'] },
    DataTable: { numbers: ['cellWidth', 'firstColWidth', 'cellHeight'] },
    Grid: { numbers: ['cellWidth', 'cellHeight', 'gap', 'radius', 'fontSize', 'headerRows', 'headerCols'] },
    MiniBarChart: { numbers: ['height', 'barWidth', 'gap', 'radius', 'fontSize'], booleans: ['showValues'] },
    ChartFrame: { text: ['title', 'subtitle'], numbers: ['width'] },
    DonutChart: { text: ['title', 'subtitle'], numbers: ['width', 'height', 'size', 'thickness'] },
    PieChart: { text: ['title', 'subtitle'], numbers: ['width', 'height', 'size'] },
    StackedBar: { text: ['title', 'subtitle'], numbers: [...chartNumbers] },
    BarChart: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showValues'] },
    ParetoBarChart: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showValues'] },
    LineChart: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showPoints'] },
    ScatterPlot: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid'] },
    ParetoChart: {
        text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showGoal'],
        selects: { xScale: ['linear', 'log'], xObjective: ['minimize', 'maximize'], yObjective: ['minimize', 'maximize'] },
    },
    QuadrantChart: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showTicks'] },
    IntervalPlot: { text: ['title', 'subtitle'], numbers: [...chartNumbers] },
    Box: { text: ['label', 'sublabel'], numbers: ['width', 'height', 'fontSize', 'radius'], booleans: ['gradient', 'outlined'] },
    Arrow: { text: ['label'], numbers: ['length'], selects: { direction: directions } },
    FlowArrow: { text: ['label'], tone: true, numbers: ['length'], selects: { direction: directions } },
    Connector: { text: ['label'], tone: true, numbers: ['length'], selects: { direction: directions } },
    VectorArrow: { numbers: ['strokeWidth'] },
    VectorSegment: { numbers: ['strokeWidth'], booleans: ['showStartDot', 'showEndDot'] },
    SvgFrame: { numbers: ['width', 'height', 'rx', 'strokeWidth'] },
    SvgPoint: { numbers: ['r', 'strokeWidth'] },
    AxisPlot: { text: ['xAxisLabel', 'yAxisLabel'], numbers: ['width', 'height', 'gridCount'], booleans: ['showGrid', 'showFrame', 'showAxes'] },
}

for (const name of ['GraphDiagram', 'DataflowDiagram', 'DeploymentDiagram', 'TransformerTopology']) {
    const spec = componentControlSpecs[name]
    spec.numbers = [...(spec.numbers ?? []), 'routingClearance']
    spec.selects = { ...spec.selects, routing: ['dagre', 'straight', 'orthogonal'] }
}

export function numberRange(prop: string, componentName: string): NumberRange {
    if (prop === 'x' || prop === 'y') return { min: 0, max: 8192, step: 1 }
    if (prop === 'routingClearance') return { min: 1, max: 64, step: 1 }
    if (prop === 'threshold') return { min: 0, max: 1, step: 0.01 }
    if (prop === 'padding' || prop === 'gap') return { min: 0, max: 80, step: 1 }
    if (prop === 'nodeGap' || prop === 'rankGap') return { min: 8, max: 320, step: 1 }
    if (prop === 'edgeGap' || prop === 'siblingGap') return { min: 0, max: 200, step: 1 }
    if (prop === 'levelGap') return { min: 16, max: 240, step: 1 }
    if (prop === 'radius' || prop === 'rx') return { min: 0, max: 32, step: 1 }
    if (prop === 'r') return { min: 2, max: 48, step: 1 }
    if (prop === 'fontSize') return { min: 8, max: 36, step: 1 }
    if (prop === 'valueFontSize' || prop === 'titleFontSize') return { min: 8, max: 48, step: 1 }
    if (prop === 'labelFontSize') return { min: 8, max: 32, step: 1 }
    if (prop === 'detailFontSize') return { min: 7, max: 24, step: 1 }
    if (prop === 'strokeWidth') return { min: 0.5, max: 12, step: 0.1 }
    if (prop === 'nodeWidth') return { min: 24, max: 300, step: 1 }
    if (prop === 'nodeHeight') return { min: 20, max: 180, step: 1 }
    if (prop === 'nodeSize') return { min: 8, max: 160, step: 1 }
    if (prop === 'size') return ['DonutChart', 'PieChart'].includes(componentName)
        ? { min: 32, max: 360, step: 1 }
        : { min: 8, max: 64, step: 1 }
    if (prop === 'barWidth') return { min: 8, max: 120, step: 1 }
    if (prop === 'barHeight' || prop === 'thickness') return { min: 2, max: 64, step: 1 }
    if (prop === 'value') return { min: 0, max: 1, step: 0.01 }
    if (prop === 'rows' || prop === 'cols') return { min: 1, max: 32, step: 1 }
    if (prop === 'gridCount') return { min: 2, max: 16, step: 1 }
    if (prop === 'headerRows' || prop === 'headerCols') return { min: 0, max: 4, step: 1 }
    if (prop === 'cellWidth') return { min: 16, max: 300, step: 1 }
    if (prop === 'cellHeight') return { min: 16, max: 200, step: 1 }
    if (prop === 'cellSize') return { min: 4, max: 96, step: 1 }
    if (prop === 'firstColWidth' || prop === 'rowLabelWidth') return { min: 32, max: 300, step: 1 }
    if (prop === 'labelWidth' || prop === 'valueWidth') return { min: 24, max: 240, step: 1 }
    if (prop === 'eventWidth') return { min: 80, max: 400, step: 1 }
    if (prop === 'length') return { min: 8, max: 400, step: 1 }
    if (prop === 'connectorLength') return { min: 4, max: 160, step: 1 }
    if (prop === 'iconSize' || prop === 'arrowSize') return { min: 4, max: 64, step: 1 }
    if (prop === 'markerSize') return { min: 4, max: 48, step: 1 }
    if (prop === 'participantWidth' || prop === 'noteWidth') return { min: 40, max: 400, step: 1 }
    if (prop === 'participantGap') return { min: 24, max: 320, step: 1 }
    if (prop === 'rowHeight') return { min: 24, max: 160, step: 1 }
    if (prop === 'fragmentIndent') return { min: 8, max: 120, step: 1 }
    if (prop === 'contentWidth') return { min: 100, max: 1400, step: 1 }
    if (prop === 'minWidth') return { min: 80, max: 800, step: 1 }
    if (prop === 'minHeight') return { min: 40, max: 600, step: 1 }
    if (prop === 'width') {
        if (componentName === 'Box') return { min: 24, max: 600, step: 1 }
        if (componentName === 'ToneStrip') return { min: 16, max: 256, step: 1 }
        if (componentName === 'BadgePill') return { min: 20, max: 400, step: 1 }
        if (componentName === 'TextLabel') return { min: 100, max: 1400, step: 1 }
        return { min: 100, max: 1400, step: 1 }
    }
    if (prop === 'height') {
        if (componentName === 'ToneStrip') return { min: 2, max: 64, step: 1 }
        if (componentName === 'BadgePill') return { min: 8, max: 96, step: 1 }
        if (componentName === 'Box') return { min: 20, max: 500, step: 1 }
        return { min: 80, max: 900, step: 1 }
    }
    return { min: 0, max: 0, step: 1 }
}

export function controlLabel(prop: string): string {
    return prop
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (character) => character.toUpperCase())
}
