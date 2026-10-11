import type { PlaygroundTemplate } from './playground-templates'

export const playgroundBuilderTemplate: PlaygroundTemplate = {
    id: 'builder', label: 'Freeform canvas',
    source: `width = 1100
height = 700

<Board width={1100} height={700}>
  <CanvasItem x={40} y={32} width={1020} height={60}>
    <TitleBar title="Build your visual" subtitle="Move and resize items, edit their data, or add another component." />
  </CanvasItem>
  <CanvasItem x={40} y={140} width={280} height={152}>
    <MetricCard label="Requests" value="1,240" detail="Replace with your data" tone="green" />
  </CanvasItem>
  <CanvasItem x={360} y={140} width={650} height={400}>
    <BarChart title="Requests by outcome" format="integer" data={[
      { label: "Successful", value: 820, color: "positive" },
      { label: "Retried", value: 280, color: "warning" },
      { label: "Failed", value: 140, color: "critical" },
    ]} />
  </CanvasItem>
</Board>`,
}
