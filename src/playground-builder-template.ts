import type { PlaygroundTemplate } from './playground-templates'

export const playgroundBuilderTemplate: PlaygroundTemplate = {
    id: 'builder', label: 'Orbit weekly brief',
    source: `width = 1100
height = 700
preset = "default"
background = "theme"

<Board width={1100} height={700}>
  <CanvasItem x={44} y={30} width={1012} height={82}>
    <Column gap={7} align="stretch" justify="center">
      <Row gap={9} align="center" justify="start">
        <ToneStrip tone="purple" width={24} height={4} />
        <TextLabel variant="tiny" text="ORBIT  /  PRODUCT PULSE" color={c.primaryLight} fontWeight={800} />
        <TextLabel variant="tiny" text="WEEK 41" color={c.textMuted} mono />
      </Row>
      <Row gap={16} align="end" justify="space-between">
        <TextLabel variant="title" text="The week in motion" color={c.textPrimary} fontSize={36} fontWeight={800} />
        <TextLabel variant="tiny" text="OCT 05–11, 2026  ·  FICTIONAL DEMO DATA" color={c.textSecondary} mono />
      </Row>
    </Column>
  </CanvasItem>
  <CanvasItem x={44} y={132} width={326} height={108}>
    <MetricCard label="Weekly active members" value="18,420" detail="+12.8% vs previous week" tone="blue" align="left" padding="15px 18px" radius={12} valueFontSize={30} />
  </CanvasItem>
  <CanvasItem x={386} y={132} width={326} height={108}>
    <MetricCard label="Completed exports" value="10,304" detail="+18.2% week over week" tone="green" align="left" padding="15px 18px" radius={12} valueFontSize={30} />
  </CanvasItem>
  <CanvasItem x={728} y={132} width={328} height={108}>
    <MetricCard label="Sunday activation" value="52.4%" detail="+6.2 pts since Monday" tone="purple" align="left" padding="15px 18px" radius={12} valueFontSize={30} />
  </CanvasItem>
  <CanvasItem x={44} y={250} width={496} height={365}>
    <BarChart width={448} height={260} title="Exports by day" format="integer" footer="10,304 total · +18.2% week over week" data={[
      { label: "Mon", value: 1182, color: "secondary" },
      { label: "Tue", value: 1316, color: "secondary" },
      { label: "Wed", value: 1294, color: "secondary" },
      { label: "Thu", value: 1502, color: "secondary" },
      { label: "Fri", value: 1678, color: "secondary" },
      { label: "Sat", value: 1549, color: "secondary" },
      { label: "Sun", value: 1783, color: "positive" },
    ]} />
  </CanvasItem>
  <CanvasItem x={560} y={250} width={496} height={365}>
    <LineChart width={448} height={260} title="Daily activation" format="percent" min={0.4} max={0.56} labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} series={[
      { name: "Activation rate", points: [0.462, 0.471, 0.468, 0.486, 0.492, 0.510, 0.524], color: "info", area: true },
    ]} />
  </CanvasItem>
  <CanvasItem x={44} y={625} width={1012} height={44}>
    <Panel title="Weekly readout" subtitle="Exports peaked Sunday at 1,783, while activation climbed from 46.2% Monday to 52.4% Sunday." tone="green" padding="8px 16px" gap={4} radius={12} shadow />
  </CanvasItem>
  <CanvasItem x={44} y={672} width={1012} height={18}>
    <TextLabel variant="tiny" text="ORBIT PRODUCT ANALYTICS  ·  All values are illustrative  ·  Built for editing" color={c.textMuted} mono />
  </CanvasItem>
</Board>`,
}
