import {
    Arrow,
    ArrowMarkerDef,
    AxisPlot,
    Box,
    Column,
    Connector,
    DashedLine,
    DotPoint,
    FlowArrow,
    getThemeColors,
    getToneColor,
    Panel,
    Row,
    Scene,
    SvgFrame,
    SvgPoint,
    TextLabel,
    type ThemeMode,
    VectorArrow,
    VectorSegment,
} from 'vizmatic'

export const width = 1120
export const height = 650

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    const blue = getToneColor('blue', c)
    const purple = getToneColor('purple', c)
    const green = getToneColor('green', c)
    const warm = getToneColor('warm', c)

    return (
        <Scene
            c={c}
            title="Drawing catalog"
            subtitle="layout connectors, SVG marks, overlays, and coordinate plots"
            background={c.bg}
            padding={28}
            gap={14}
        >
            <Panel c={c} title="Box · Arrow · Connector · FlowArrow" subtitle="HTML flow primitives for readable directional composition" tone="blue" width="100%" minHeight={174} align="center">
                <Row gap={8} align="center" justify="center">
                    <Box c={c} label="Box" sublabel="source" color="primary" gradient width={86} height={54} fontSize={13} />
                    <Arrow c={c} direction="right" label="Arrow" length={58} color={blue} />
                    <Box c={c} label="Connector" sublabel="alias" color="secondary" width={96} height={54} fontSize={13} />
                    <Connector c={c} direction="right" label="Connector" length={66} tone="purple" />
                    <Box c={c} label="FlowArrow" sublabel="semantic" color="info" width={98} height={54} fontSize={13} />
                    <FlowArrow c={c} direction="right" label="FlowArrow" length={66} tone="green" />
                    <Box c={c} label="Output" sublabel="frame" color="positive" width={86} height={54} fontSize={13} />
                </Row>
            </Panel>

            <Row width="100%" gap={14} align="stretch">
                <Panel c={c} title="SVG primitives" subtitle="SvgFrame · SvgPoint · VectorSegment · VectorArrow · ArrowMarkerDef" tone="purple" width={500} minHeight={306}>
                    <Column gap={8} align="stretch">
                        <svg width="468" height="184" viewBox="0 0 468 184">
                            <defs>
                                {ArrowMarkerDef({ id: 'catalog-drawing-arrow', color: purple, size: 6 })}
                            </defs>
                            {SvgFrame({ c, x: 8, y: 8, width: 452, height: 168, rx: 12, fill: c.bgSubtle, stroke: c.borderLight })}
                            <path d="M 58 126 C 130 38, 264 38, 398 98" fill="none" stroke={purple} strokeWidth="3" markerEnd="url(#catalog-drawing-arrow)" />
                            {VectorSegment({ x1: 70, y1: 144, x2: 250, y2: 144, color: blue, strokeWidth: 4, showStartDot: true, showEndDot: true })}
                            {VectorArrow({ x1: 250, y1: 144, x2: 372, y2: 70, color: green, strokeWidth: 4 })}
                            {SvgPoint({ cx: 70, cy: 144, r: 7, fill: blue, stroke: c.bg, strokeWidth: 2 })}
                            {SvgPoint({ cx: 372, cy: 70, r: 7, fill: green, stroke: c.bg, strokeWidth: 2 })}
                        </svg>
                        <TextLabel c={c} text="SvgFrame · SvgPoint · VectorSegment · VectorArrow · ArrowMarkerDef" fontSize={11} mono color={c.textPrimary} />
                    </Column>
                </Panel>

                <Panel c={c} title="DotPoint + DashedLine" subtitle="absolute-position overlays" tone="warm" width={248} minHeight={306}>
                    <div style={{ position: 'relative', display: 'flex', width: 214, height: 184, borderRadius: 10, backgroundColor: c.bgSubtle, border: `1px solid ${c.borderSubtle}` }}>
                        {DashedLine({ x1: 38, y1: 142, x2: 172, y2: 58, color: warm, dotSpacing: 9, dotSize: 3 })}
                        {DotPoint({ x: 38, y: 142, label: 'A', color: warm, c, size: 13, labelOffset: { x: 0, y: 12 } })}
                        {DotPoint({ x: 172, y: 58, label: 'B', color: blue, c, size: 13, labelOffset: { x: 0, y: 12 } })}
                        <div style={{ position: 'absolute', left: 16, top: 12, fontSize: 11, fontFamily: c.fontMono, fontWeight: 800, color: c.textMuted }}>DashedLine</div>
                    </div>
                    <TextLabel c={c} text="DotPoint carries label and color." fontSize={11} mono />
                </Panel>

                <Panel c={c} title="AxisPlot" subtitle="points, paths, and vectors on axes" tone="cyan" width={282} minHeight={306} align="center">
                    <AxisPlot
                        c={c}
                        width={254}
                        height={196}
                        xMin={-3}
                        xMax={3}
                        yMin={-2}
                        yMax={3}
                        showGrid
                        gridCount={4}
                        xAxisLabel="x axis"
                        yAxisLabel="y axis"
                        paths={[{ points: [{ x: -2.4, y: -1.1 }, { x: -0.6, y: 0.2 }, { x: 0.7, y: 1.8 }, { x: 2.3, y: 2.4 }], tone: 'cyan', strokeWidth: 3 }]}
                        vectors={[{ x1: 0, y1: 0, x2: 1.8, y2: 2.1, tone: 'green', arrow: true, strokeWidth: 3 }]}
                        points={[{ x: -2.4, y: -1.1, tone: 'warm', r: 5 }, { x: 2.3, y: 2.4, tone: 'cyan', r: 5 }]}
                    />
                </Panel>
            </Row>
        </Scene>
    )
}

export default create('dark')
