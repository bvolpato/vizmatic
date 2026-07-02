width = 760;
height = 420;

<Scene align="center" contentWidth={620}>
    <Row gap={16} width="100%" justify="center">
        <MetricCard label="Alpha" value="default" detail="no canvas fill" tone="cyan" width={210} />
        <StepCard title="Titleless" subtitle="visual-only scene" tone="green" width={210} />
    </Row>
    <CalloutCard
        title="No title bar required"
        detail="Omit Scene title/subtitle for badges, inline figures, or visuals that should stand on their own."
        tone="purple"
        width={560}
    />
</Scene>
