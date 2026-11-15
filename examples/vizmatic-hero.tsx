width = 1120;
height = 660;

<Scene
    title="Code to live films and publication figures"
    subtitle="Author TypeScript scenes once, check layout and contrast, and ship interactive or static assets."
    background={c.bg}
    padding={28}
    gap={16}
>
    <Panel
        title="Unified authoring and delivery pipeline"
        subtitle="Stage films, dense TSX figures, and shared looks compile through deterministic layout and contrast checks"
        tone="blue"
        width="100%"
        padding={16}
        bodyStyle={{ alignItems: 'center' }}
    >
        <GraphDiagram
            ariaLabel="Vizmatic pipeline from Stage films and 3D, Dense TSX figures, and Looks and themes through Check and compiler to Live vz-film and Studio and MP4, PNG, SVG, and GIF"
            rankGap={92}
            nodeGap={16}
            nodes={[
                {
                    id: 'stage',
                    label: 'Stage films & 3D',
                    detail: 'timelines · camera · narration',
                    icon: 'play',
                    tone: 'purple',
                    tags: ['film()', 'scene3d'],
                },
                {
                    id: 'figures',
                    label: 'Dense TSX figures',
                    detail: 'charts · systems · science',
                    icon: 'chart',
                    tone: 'blue',
                    tags: ['70+ primitives'],
                },
                {
                    id: 'looks',
                    label: 'Looks & themes',
                    detail: 'midnight · paper · engineering',
                    icon: 'layers',
                    tone: 'cyan',
                    tags: ['dark & light', 'density'],
                },
                {
                    id: 'compiler',
                    label: 'Check & compiler',
                    detail: 'routing · contrast · bundled fonts',
                    icon: 'check',
                    tone: 'warm',
                    status: 'ok',
                    rows: [
                        { key: 'network', value: 'offline' },
                        { key: 'checks', value: 'WCAG + fit' },
                    ],
                },
                {
                    id: 'live',
                    label: 'Live <vz-film> & Studio',
                    detail: '60 fps player · scrub · captions',
                    icon: 'browser',
                    tone: 'green',
                    tags: ['Web', 'HTML'],
                },
                {
                    id: 'assets',
                    label: 'MP4 / PNG / SVG',
                    detail: 'publication vector & HD video',
                    icon: 'image',
                    tone: 'green',
                    tags: ['CLI', 'Node SDK'],
                },
            ]}
            edges={[
                { from: 'stage', to: 'compiler' },
                { from: 'figures', to: 'compiler' },
                { from: 'looks', to: 'compiler' },
                { from: 'compiler', to: 'live', label: 'interactive', tone: 'green' },
                { from: 'compiler', to: 'assets', label: 'deterministic', tone: 'green' },
            ]}
        />
    </Panel>

    <Row width="100%" gap={16} align="stretch">
        <Panel
            title="Stage films & Studio"
            subtitle="Compose animated scenes, math morphs, 3D projections, and voice cues that play live in <vz-film> or export to MP4."
            tone="purple"
            width={344}
            padding={14}
        />
        <Panel
            title="Dense TSX figures"
            subtitle="Build architecture maps, calibrated charts, and scientific diagrams from typed primitives that stay diffable in Git."
            tone="blue"
            width={344}
            padding={14}
        />
        <Panel
            title="Verified offline output"
            subtitle="Bundled fonts and automated layout and contrast checks keep dark, light, and engineering renders crisp anywhere."
            tone="green"
            width={344}
            padding={14}
        />
    </Row>
</Scene>
