width = 760;
height = 420;

<Scene background={c.bg} title="Opaque theme background" subtitle="use when the host page needs the full frame" align="center" contentWidth={620}>
    <Row gap={16} width="100%" justify="center">
        <MetricCard label="Canvas" value="theme" detail="uses c.bg" tone="purple" width={210} />
        <StepCard title="Stable" subtitle="same as older renders" tone="green" width={210} />
    </Row>
    <CalloutCard
        title="Explicit fill"
        detail="Use background={c.bg}, render background: 'theme', or CLI --background theme."
        tone="cyan"
        width={560}
    />
</Scene>
