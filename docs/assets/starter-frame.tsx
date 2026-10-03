width = 1200;
height = 675;

<Scene title="Project status example" subtitle="replace labels and values with project data" gap={24}>
  <Row width="100%" gap={16} align="stretch">
    <MetricCard label="Coverage" value="TBD" tone="green" detail="replace with project data" width={260} />
    <MetricCard label="Latency" value="TBD" tone="cyan" detail="replace with project data" width={260} />
    <MetricCard label="Risk" value="TBD" tone="purple" detail="replace with project data" width={260} />
    <MetricCard label="Open" value="TBD" tone="warm" detail="replace with project data" width={260} />
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
    <CalloutCard title="Compose from primitives" detail="Use Flow, cards, charts, and layout components before custom SVG." tone="purple" width={548} />
    <CalloutCard title="Render both themes" detail="Dark and light files come from the same scene source." tone="green" width={548} />
  </Row>
</Scene>
