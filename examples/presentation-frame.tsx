width = 1280;
height = 720;

<Scene title="TSX scene at slide size" subtitle="1280x720 output with the same primitives" gap={22}>
    <Row gap={20} align="stretch">
        <Panel title="Slide frame" tone="purple" width={430} minHeight={330}>
            <Column gap={13} align="stretch">
                <TextLabel variant="label" text="Use a larger canvas." />
                <TextLabel text="The same layout components work for article figures and slide-size assets." />
                <CalloutCard tone="purple" title="Source remains TSX" detail="Edit content and layout in the frame file." align="left" />
            </Column>
        </Panel>
        <Panel title="Renderer options" tone="green" width={610} minHeight={330}>
            <Row gap={14} wrap align="stretch">
                <MetricCard tone="green" label="Output" value="PNG/SVG" detail="2x by default" width={180} minHeight={106} />
                <MetricCard tone="cyan" label="Layout" value="flex" detail="rows and columns" width={180} minHeight={106} />
                <MetricCard tone="warm" label="Checks" value="overflow" detail="before export" width={180} minHeight={106} />
                <MetricCard tone="purple" label="Theme" value="tokens" detail="dark and light" width={180} minHeight={106} />
                <MetricCard tone="blue" label="Runtime" value="Node" detail="no browser required" width={180} minHeight={106} />
                <MetricCard tone="pink" label="Authoring" value="TSX" detail="editable source" width={180} minHeight={106} />
            </Row>
        </Panel>
    </Row>
</Scene>
