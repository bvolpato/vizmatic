export interface ComponentCatalogItem {
    name: string
    description: string
}

export interface ComponentCatalogCategory {
    id: string
    label: string
    description: string
    source: string
    components: ComponentCatalogItem[]
}

export const componentCatalog: ComponentCatalogCategory[] = [
    {
        id: 'foundations',
        label: 'Foundations',
        description: 'Scene structure, responsive layout, and framed surfaces.',
        source: 'catalog-foundations',
        components: [
            { name: 'Canvas', description: 'Root canvas with theme background and padding.' },
            { name: 'Scene', description: 'Primary vertical scene layout with optional title and subtitle.' },
            { name: 'TitleBar', description: 'Standalone heading and supporting copy.' },
            { name: 'Row', description: 'Horizontal flex layout with stable gaps and alignment.' },
            { name: 'Column', description: 'Vertical flex layout for stacked composition.' },
            { name: 'Stack', description: 'Compact vertical grouping for related content.' },
            { name: 'Panel', description: 'Titled container for grouped visual content.' },
            { name: 'Card', description: 'General-purpose surface with tone, padding, and shadow.' },
            { name: 'WindowFrame', description: 'Application or terminal window framing.' },
        ],
    },
    {
        id: 'content',
        label: 'Content',
        description: 'Labels, cards, code, comparisons, and reusable information blocks.',
        source: 'catalog-content',
        components: [
            { name: 'ToneStrip', description: 'Short semantic color accent.' },
            { name: 'Icon', description: 'Theme-aware technical icon set.' },
            { name: 'TextLabel', description: 'Wrapping-safe SVG or flex label.' },
            { name: 'MathText', description: 'Math-aware text formatting for React content.' },
            { name: 'SvgMathText', description: 'Positioned math overlay aligned with custom SVG geometry.' },
            { name: 'Badge', description: 'Compact semantic SVG label.' },
            { name: 'BadgePill', description: 'Inline status, category, or metadata label.' },
            { name: 'GradientChip', description: 'Emphasized label with tone gradient.' },
            { name: 'ValuePill', description: 'Small label-value pair.' },
            { name: 'EquationCard', description: 'Formula, result, and supporting detail.' },
            { name: 'StepCard', description: 'Numbered or staged process card.' },
            { name: 'MetricCard', description: 'KPI value with label and context.' },
            { name: 'CalloutCard', description: 'Focused takeaway, warning, or recommendation.' },
            { name: 'DetailList', description: 'Compact list of supporting facts.' },
            { name: 'CodeBlock', description: 'Code or command excerpt with optional line numbers.' },
            { name: 'Comparison', description: 'Side-by-side alternatives or before/after states.' },
            { name: 'KeyValueList', description: 'Aligned technical metadata rows.' },
            { name: 'Tile', description: 'Single labeled unit for feature or system maps.' },
            { name: 'TileGrid', description: 'Dense grid of related labeled units.' },
            { name: 'Watermark', description: 'Frame metadata for text, image, or custom branding.' },
        ],
    },
    {
        id: 'flows',
        label: 'Flows',
        description: 'Processes, timelines, status, and progress.',
        source: 'catalog-flows',
        components: [
            { name: 'StatusRow', description: 'Single operational state with detail.' },
            { name: 'StatusList', description: 'Grouped checks, warnings, and pending work.' },
            { name: 'Timeline', description: 'Ordered events in horizontal or vertical form.' },
            { name: 'Flow', description: 'Connected horizontal or vertical stages.' },
            { name: 'Pipeline', description: 'Compact process pipeline with shared title.' },
            { name: 'ProgressRow', description: 'Labeled progress bar and value.' },
            { name: 'ProgressList', description: 'Comparable progress across several measures.' },
        ],
    },
    {
        id: 'diagrams',
        label: 'Diagrams',
        description: 'Networks, system architecture, directed graphs, and hierarchies.',
        source: 'catalog-diagrams',
        components: [
            { name: 'LayeredNetwork', description: 'Layered neural network or staged DAG.' },
            { name: 'GraphDiagram', description: 'Auto-laid architecture graph with nested groups, icons, and semantic edges.' },
            { name: 'TreeDiagram', description: 'Auto-laid hierarchy, taxonomy, or decision tree.' },
        ],
    },
    {
        id: 'data',
        label: 'Data',
        description: 'Tables, grids, matrices, and compact distributions.',
        source: 'catalog-data',
        components: [
            { name: 'Matrix', description: 'Numeric or symbolic matrix with headers.' },
            { name: 'Heatmap', description: 'Color-scaled matrix for intensity and correlation.' },
            { name: 'TiledMatrix', description: 'Matrix with named regions and boundaries.' },
            { name: 'DataTable', description: 'Structured rows and columns with headers.' },
            { name: 'Grid', description: 'General labeled cell grid.' },
            { name: 'MiniBarChart', description: 'Compact categorical bars for dense layouts.' },
        ],
    },
    {
        id: 'charts',
        label: 'Charts',
        description: 'Common comparisons, trends, distributions, and analytical plots.',
        source: 'catalog-charts',
        components: [
            { name: 'ChartFrame', description: 'Shared chart title, subtitle, legend, and footer.' },
            { name: 'DonutChart', description: 'Part-to-whole composition with center label.' },
            { name: 'StackedBar', description: 'Part-to-whole values along one dimension.' },
            { name: 'BarChart', description: 'Categorical comparison with labels and values.' },
            { name: 'LineChart', description: 'One or more trends across an ordered axis.' },
            { name: 'ScatterPlot', description: 'Point distribution across two numeric axes.' },
            { name: 'ParetoChart', description: 'Automatic non-dominated frontier across competing numeric objectives.' },
            { name: 'QuadrantChart', description: 'Numeric decision map split by configurable policy thresholds.' },
            { name: 'IntervalPlot', description: 'Low, midpoint, and high ranges by category.' },
            { name: 'Legend', description: 'Reusable color key for charts and diagrams.' },
        ],
    },
    {
        id: 'drawing',
        label: 'Drawing',
        description: 'Low-level SVG geometry for custom technical figures.',
        source: 'catalog-drawing',
        components: [
            { name: 'Box', description: 'Rounded SVG box with label and tone.' },
            { name: 'Arrow', description: 'Straight labeled SVG arrow.' },
            { name: 'ArrowMarkerDef', description: 'Reusable SVG arrowhead definition.' },
            { name: 'FlowArrow', description: 'Straight directional connector with label and tone.' },
            { name: 'Connector', description: 'Alias for flow connectors in diagram code.' },
            { name: 'VectorArrow', description: 'Vector with optional endpoints and arrowhead.' },
            { name: 'VectorSegment', description: 'Line segment for geometric constructions.' },
            { name: 'SvgFrame', description: 'SVG plotting frame with border and fill.' },
            { name: 'SvgPoint', description: 'Labeled point for SVG figures.' },
            { name: 'DotPoint', description: 'Point marker with optional text label.' },
            { name: 'DashedLine', description: 'Dotted or dashed SVG guide line.' },
            { name: 'AxisPlot', description: 'Coordinate plane for points, vectors, and paths.' },
        ],
    },
]

export const catalogUtilities = [
    'createPlotArea',
    'defineDiagramIcon',
    'defineIconRegistry',
    'defineIllustration',
    'formatMathText',
    'getToneColor',
    'getToneGradient',
] as const

export const catalogComponentCount = componentCatalog.reduce(
    (total, category) => total + category.components.length,
    0,
)
