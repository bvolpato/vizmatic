export {
    defineIllustration,
    Canvas,
    TitleBar,
    Scene,
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
export type { IllustrationBuilder, ToneName, IconName, IconProps } from './primitives/layout'
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
export * from './primitives/content'
export * from './primitives/flows'
export * from './primitives/diagrams'
export * from './primitives/data'
export {
    createPlotArea,
    ChartFrame,
    DonutChart,
    StackedBar,
    BarChart,
    LineChart,
} from './primitives/charts'
export type {
    ChartValueFormat,
    ChartLegendItem,
    ChartMargins,
    PlotArea,
    DonutChartSegment,
    BarChartDatum,
    StackedBarSegment,
    LineChartSeries,
} from './primitives/charts'
export * from './primitives/plots'
