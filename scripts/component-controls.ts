import ts from 'typescript'
import type { ComponentControl, ComponentControlType } from '../src/component-controls'

interface NumberRange {
    min: number
    max: number
    step: number
}

interface ComponentControlSpec {
    text?: readonly string[]
    tone?: boolean
    selects?: Readonly<Record<string, readonly string[]>>
    numbers?: readonly string[]
    booleans?: readonly string[]
}

const tones = ['blue', 'purple', 'green', 'warm', 'cyan', 'pink', 'red', 'critical', 'neutral', 'sunset', 'ocean', 'dark'] as const
const directions = ['down', 'right', 'up', 'left'] as const
const textDirection = ['horizontal', 'vertical'] as const
const graphDirection = ['LR', 'RL', 'TB', 'BT'] as const

const layoutNumbers = ['width', 'height']
const chartNumbers = ['width', 'height']

const componentControlSpecs: Record<string, ComponentControlSpec> = {
    Canvas: { numbers: ['padding'] },
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
        selects: { direction: graphDirection, layout: ['auto', 'manual'], sizing: ['content', 'fixed'] },
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
    StackedBar: { text: ['title', 'subtitle'], numbers: [...chartNumbers] },
    BarChart: { text: ['title', 'subtitle'], numbers: [...chartNumbers], booleans: ['showGrid', 'showValues'] },
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

function numberRange(prop: string, componentName: string): NumberRange {
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
    if (prop === 'size') return componentName === 'DonutChart'
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

function controlLabel(prop: string): string {
    return prop
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (character) => character.toUpperCase())
}

function jsxTagNameMatches(tagName: ts.JsxTagNameExpression, componentName: string): boolean {
    return ts.isIdentifier(tagName) && tagName.text === componentName
}

function firstComponentElement(sourceFile: ts.SourceFile, componentName: string): ts.JsxOpeningLikeElement | undefined {
    let match: ts.JsxOpeningLikeElement | undefined
    const visit = (node: ts.Node): void => {
        if (match) return
        if (ts.isJsxElement(node) && jsxTagNameMatches(node.openingElement.tagName, componentName)) {
            match = node.openingElement
            return
        }
        if (ts.isJsxSelfClosingElement(node) && jsxTagNameMatches(node.tagName, componentName)) {
            match = node
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return match
}

function stringValue(attribute: ts.JsxAttribute): string | undefined {
    const initializer = attribute.initializer
    if (initializer && ts.isStringLiteral(initializer)) return initializer.text
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    return ts.isStringLiteral(initializer.expression) ? initializer.expression.text : undefined
}

function numberValue(attribute: ts.JsxAttribute): number | undefined {
    const initializer = attribute.initializer
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    const expression = initializer.expression
    if (ts.isNumericLiteral(expression)) return Number(expression.text.replaceAll('_', ''))
    if (ts.isPrefixUnaryExpression(expression)
        && (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken)
        && ts.isNumericLiteral(expression.operand)) {
        const value = Number(expression.operand.text.replaceAll('_', ''))
        return expression.operator === ts.SyntaxKind.MinusToken ? -value : value
    }
    return undefined
}

function booleanValue(attribute: ts.JsxAttribute): boolean | undefined {
    const initializer = attribute.initializer
    if (!initializer) return true
    if (!ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    if (initializer.expression.kind === ts.SyntaxKind.TrueKeyword) return true
    if (initializer.expression.kind === ts.SyntaxKind.FalseKeyword) return false
    return undefined
}

function addControl(
    controls: ComponentControl[],
    sourceFile: ts.SourceFile,
    attribute: ts.JsxAttribute,
    componentName: string,
    prop: string,
    type: ComponentControlType,
    value: string | number | boolean,
    options?: readonly string[],
): void {
    const control: ComponentControl = {
        prop,
        label: controlLabel(prop),
        type,
        value,
        start: attribute.getStart(sourceFile),
        end: attribute.getEnd(),
    }
    if (options) control.options = [...options]
    if (type === 'number') Object.assign(control, numberRange(prop, componentName))
    controls.push(control)
}

/** Finds editable literal attributes on the first JSX element with this exact component name. */
export function getComponentControls(source: string, componentName: string): ComponentControl[] {
    const spec = componentControlSpecs[componentName]
    if (!spec || !componentName) return []
    const sourceFile = ts.createSourceFile('component-example.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const element = firstComponentElement(sourceFile, componentName)
    if (!element) return []

    const controls: ComponentControl[] = []
    const seen = new Set<string>()
    for (const item of element.attributes.properties) {
        if (!ts.isJsxAttribute(item) || !ts.isIdentifier(item.name)) continue
        const prop = item.name.text
        if (seen.has(prop)) continue

        if (spec.text?.includes(prop)) {
            const value = stringValue(item)
            if (value !== undefined) addControl(controls, sourceFile, item, componentName, prop, 'text', value)
        } else if (prop === 'tone' && spec.tone) {
            const value = stringValue(item)
            if (value !== undefined && (tones as readonly string[]).includes(value)) {
                addControl(controls, sourceFile, item, componentName, prop, 'select', value, tones)
            }
        } else if (spec.selects?.[prop]) {
            const options = spec.selects[prop]!
            const value = stringValue(item)
            if (value !== undefined && options.includes(value)) addControl(controls, sourceFile, item, componentName, prop, 'select', value, options)
        } else if (spec.numbers?.includes(prop)) {
            const value = numberValue(item)
            const range = numberRange(prop, componentName)
            if (value !== undefined && Number.isFinite(value) && value >= range.min && value <= range.max) {
                addControl(controls, sourceFile, item, componentName, prop, 'number', value)
            }
        } else if (spec.booleans?.includes(prop)) {
            const value = booleanValue(item)
            if (value !== undefined) addControl(controls, sourceFile, item, componentName, prop, 'boolean', value)
        }

        if (controls.length >= 8) break
        if (controls.some((control) => control.prop === prop)) seen.add(prop)
    }
    return controls
}
