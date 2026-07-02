width = 1200;
height = 675;

<Scene title="Launch readiness" subtitle="from plan to verified release" gap={24}>
  <Row width="100%" gap={16} align="stretch">
    <MetricCard label="Coverage" value="92%" tone="green" detail="core paths verified" width={260} />
    <MetricCard label="Latency" value="184ms" tone="cyan" detail="p95 API response" width={260} />
    <MetricCard label="Risk" value="Low" tone="purple" detail="rollback path ready" width={260} />
    <MetricCard label="Open" value="3" tone="warm" detail="known follow-ups" width={260} />
  </Row>

  <Flow
    connectorTone="purple"
    stages={[
      { eyebrow: "input", title: "Plan", subtitle: "scope", tone: "blue", lines: ["goals", "owners"], width: 210 },
      { eyebrow: "build", title: "Change", subtitle: "implementation", tone: "purple", lines: ["code", "docs"], width: 210 },
      { eyebrow: "verify", title: "Check", subtitle: "automation", tone: "cyan", lines: ["tests", "render"], width: 210 },
      { eyebrow: "ship", title: "Release", subtitle: "published", tone: "green", lines: ["tag", "deploy"], width: 210 },
    ]}
  />

  <Row width="100%" gap={16} align="stretch">
    <CalloutCard title="Use structure, not drawing code" detail="Vizmatic primitives keep diagrams theme-aware and easier for agents to revise." tone="purple" width={548} />
    <CalloutCard title="Render both themes" detail="Dark and light assets come from the same scene contract." tone="green" width={548} />
  </Row>
</Scene>
