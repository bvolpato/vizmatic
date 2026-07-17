export interface PlaygroundTemplate {
    id: string
    label: string
    source: string
}

export const playgroundTemplates: PlaygroundTemplate[] = [
    {
        id: 'architecture',
        label: 'Architecture',
        source: `width = 1200
height = 540

<Scene title="Agent runtime" subtitle="bounded tools, visible state, durable output" gap={22}>
  <Row gap={18} align="stretch">
    <Panel title="Plan" tone="purple" width={250} minHeight={236}>
      <StatusList rows={[
        { label: "Read context", detail: "ready" },
        { label: "Choose tools", detail: "3 calls", tone: "blue" },
        { label: "Verify output", detail: "required", tone: "green" },
      ]} />
    </Panel>
    <Column gap={12} align="center" justify="center">
      <Arrow direction="right" length={48} />
      <TextLabel variant="tiny" text="structured handoff" />
    </Column>
    <Panel title="Execute" tone="blue" width={300} minHeight={236}>
      <Pipeline stages={[
        { label: "Search", tone: "blue" },
        { label: "Build", tone: "purple" },
        { label: "Check", tone: "green" },
      ]} />
    </Panel>
    <Column gap={12} align="center" justify="center"><Arrow direction="right" length={48} /></Column>
    <MetricCard tone="green" label="Result" value="Shipped" detail="tested static artifact" width={210} minHeight={236} />
  </Row>
</Scene>`,
    },
    {
        id: 'metrics',
        label: 'Metrics',
        source: `width = 960
height = 540
preset = "engineering"

<Scene title="Release confidence" subtitle="build health across last 24 hours" background={c.bg} gap={20}>
  <Row gap={16} align="stretch">
    <MetricCard tone="green" label="Checks" value="98.7%" detail="passing" width={210} minHeight={132} />
    <MetricCard tone="blue" label="Deploy time" value="3m 42s" detail="p95" width={210} minHeight={132} />
    <MetricCard tone="purple" label="Coverage" value="84%" detail="critical paths" width={210} minHeight={132} />
    <MetricCard tone="warm" label="Open alerts" value="2" detail="needs review" width={210} minHeight={132} />
  </Row>
  <Panel title="Delivery gates" tone="green" width="100%">
    <ProgressList rows={[
      { label: "Build", value: 1, valueLabel: "100%", tone: "green" },
      { label: "Tests", value: 0.987, valueLabel: "98.7%", tone: "blue" },
      { label: "Review", value: 0.82, valueLabel: "82%", tone: "purple" },
    ]} />
  </Panel>
</Scene>`,
    },
    {
        id: 'flow',
        label: 'Flow',
        source: `width = 960
height = 540

<Scene title="Retrieval flow" subtitle="ground answers in fresh evidence" gap={26}>
  <Row gap={16} align="stretch">
    <StepCard step="01" title="Question" detail="intent + constraints" tone="blue" width={205} />
    <Arrow direction="right" length={52} />
    <StepCard step="02" title="Retrieve" detail="ranked source set" tone="purple" width={205} />
    <Arrow direction="right" length={52} />
    <StepCard step="03" title="Synthesize" detail="cited answer" tone="green" width={205} />
  </Row>
  <CalloutCard tone="cyan" title="Evaluation loop" detail="Measure answer quality, source coverage, and latency before shipping." width="100%" />
</Scene>`,
    },
]

export function findPlaygroundTemplate(id: string | undefined): PlaygroundTemplate | undefined {
    return playgroundTemplates.find((template) => template.id === id)
}
