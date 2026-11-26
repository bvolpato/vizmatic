export {
    defineIllustration,
    Canvas,
    TitleBar,
    Scene,
    scopeDensity,
    Row,
    Column,
    ToneStrip,
    Icon,
    Panel,
    getToneColor,
    getToneGradient,
    formatMathText,
    MathText,
    TextLabel,
    SvgMathText,
} from './primitives/layout'
export type { IllustrationBuilder, ToneName, IconName, IconProps, SurfaceVariant } from './primitives/layout'
export * from './primitives/svg'
export {
    Stack,
    Card,
    ValuePill,
    EquationCard,
    BadgePill,
    GradientChip,
    StepCard,
    MetricCard,
} from './primitives/surfaces'
export * from './primitives/dense'
export * from './primitives/content'
export * from './primitives/flows'
export * from './primitives/diagrams'
export * from './primitives/sequence'
export * from './primitives/dataflow'
export * from './primitives/deployment'
export * from './primitives/entity-relationship'
export * from './primitives/transformer'
export * from './primitives/data'
export {
    createPlotArea,
    ChartFrame,
    DonutChart,
    PieChart,
    StackedBar,
    BarChart,
    ParetoBarChart,
    LineChart,
} from './primitives/charts'
export type {
    ChartValueFormat,
    ChartLegendItem,
    ChartMargins,
    PlotArea,
    DonutChartSegment,
    PieChartProps,
    BarChartDatum,
    StackedBarSegment,
    ParetoBarChartProps,
    LineChartSeries,
    LineChartReferenceLine,
} from './primitives/charts'
export * from './primitives/plots'
export * from './primitives/board'
export * from './primitives/science-math-physics'
export * from './primitives/science-chemistry'
export * from './primitives/science-ai'
export * from './primitives/matrix-math'
export * from './primitives/image-tensor'
export * from './primitives/image-kernels'
export * from './primitives/raster-image'

import { VIZMATIC_PRIMITIVE_SYMBOL, VIZMATIC_SVG_CHILDREN_SYMBOL, VIZMATIC_SVG_SHAPE_SYMBOL } from './diagnostics'
import { Canvas, Scene, Row, Column, Panel } from './primitives/layout'
import { Stack, Card } from './primitives/surfaces'
import { WindowFrame, Tile } from './primitives/content'
import { CalloutCard } from './primitives/diagrams'
import { ChartFrame } from './primitives/charts'
import { Board, CanvasItem } from './primitives/board'
import { AxisPlot } from './primitives/data'
import { ArrowMarkerDef, SvgFrame, SvgPoint, VectorArrow, VectorSegment } from './primitives/svg'
import * as allLayout from './primitives/layout'
import * as allSvg from './primitives/svg'
import * as allSurfaces from './primitives/surfaces'
import * as allDense from './primitives/dense'
import * as allContent from './primitives/content'
import * as allFlows from './primitives/flows'
import * as allDiagrams from './primitives/diagrams'
import * as allSequence from './primitives/sequence'
import * as allDataflow from './primitives/dataflow'
import * as allDeployment from './primitives/deployment'
import * as allEntityRelationship from './primitives/entity-relationship'
import * as allTransformer from './primitives/transformer'
import * as allData from './primitives/data'
import * as allCharts from './primitives/charts'
import * as allPlots from './primitives/plots'
import * as allBoard from './primitives/board'
import * as allScienceMath from './primitives/science-math-physics'
import * as allScienceChem from './primitives/science-chemistry'
import * as allScienceAi from './primitives/science-ai'
import * as allMatrixMath from './primitives/matrix-math'
import * as allImageTensor from './primitives/image-tensor'
import * as allImageKernels from './primitives/image-kernels'
import * as allRasterImage from './primitives/raster-image'

// Tag built-in primitives with process-global symbols so identity checks work across ESM/CJS/CLI bundle boundaries.
for (const namespace of [
    allLayout, allSvg, allSurfaces, allDense, allContent, allFlows, allDiagrams, allSequence,
    allDataflow, allDeployment, allEntityRelationship, allTransformer, allData, allCharts,
    allPlots, allBoard, allScienceMath, allScienceChem, allScienceAi, allMatrixMath,
    allImageTensor, allImageKernels, allRasterImage,
]) {
    for (const value of Object.values(namespace)) {
        if (typeof value === 'function' && !Object.prototype.hasOwnProperty.call(value, VIZMATIC_PRIMITIVE_SYMBOL)) {
            Object.defineProperty(value, VIZMATIC_PRIMITIVE_SYMBOL, { value: true })
        }
    }
}
for (const [component, name] of [
    [SvgFrame, 'SvgFrame'], [SvgPoint, 'SvgPoint'], [VectorArrow, 'VectorArrow'],
    [VectorSegment, 'VectorSegment'], [ArrowMarkerDef, 'ArrowMarkerDef'],
] as const) {
    Object.defineProperty(component, VIZMATIC_SVG_SHAPE_SYMBOL, { value: name })
}
for (const component of [
    Board, CanvasItem, Canvas, Scene, Row, Column, Panel, Stack, Card, Tile, WindowFrame, CalloutCard, ChartFrame,
]) {
    Object.defineProperty(component, VIZMATIC_SVG_CHILDREN_SYMBOL, { value: 'html' })
}
Object.defineProperty(AxisPlot, VIZMATIC_SVG_CHILDREN_SYMBOL, { value: 'svg' })
