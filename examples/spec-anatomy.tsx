width = 1040;
height = 680;

<Scene title="Scene spec anatomy" subtitle="strong defaults with escape hatches" gap={18}>
    <Row gap={18} align="stretch">
        <Panel title="Spec fields" tone="purple" width={420} align="center">
            <DataTable
                firstColWidth={110}
                cellWidth={210}
                cellHeight={34}
                rows={[
                    ['field', 'meaning'],
                    ['canvas', 'width, height, theme'],
                    ['layout', 'row, column, flow, grid'],
                    ['content', 'labels, metrics, chart data'],
                    ['tone', 'semantic color token'],
                    ['verify', 'overflow and bounds'],
                ]}
            />
        </Panel>
        <Panel title="Render path" tone="cyan" width={520}>
            <Flow
                direction="vertical"
                stages={[
                    { title: 'Validate', subtitle: 'typed module or schema', tone: 'blue', width: 430 },
                    { title: 'Compose', subtitle: 'React primitive tree', tone: 'purple', width: 430 },
                    { title: 'Render', subtitle: 'Satori + resvg', tone: 'cyan', width: 430 },
                    { title: 'Verify', subtitle: 'crop, contrast, overflow', tone: 'green', width: 430 },
                ]}
            />
            <TextLabel text="Use raw SVG only where custom geometry is the point." align="center" width={440} />
        </Panel>
    </Row>
</Scene>
