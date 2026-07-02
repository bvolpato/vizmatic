width = 760;
height = 420;

<Scene title="Transparent PNG default" subtitle="drop onto any blog background" align="center" contentWidth={620}>
    <Row gap={16} width="100%" justify="center">
        <MetricCard label="Alpha" value="default" detail="no canvas fill" tone="cyan" width={210} />
        <StepCard title="Reusable" subtitle="blog, deck, docs" tone="green" width={210} />
    </Row>
    <CalloutCard
        title="No background flag needed"
        detail="Vizmatic leaves the root canvas transparent unless a frame or render option asks for a background."
        tone="purple"
        width={560}
    />
</Scene>
