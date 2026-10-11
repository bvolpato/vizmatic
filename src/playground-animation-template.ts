import type { PlaygroundTemplate } from './playground-templates'

export const playgroundAnimationTemplate: PlaygroundTemplate = {
    id: 'animation',
    label: 'Animation',
    source: `width = 960
height = 540
animationDuration = 3
animationFps = 10

// t is the current playback time in seconds.
const progress = (1 - Math.cos(t / 3 * Math.PI * 2)) / 2

<Scene title="Animate a release" subtitle="Play, pause, scrub the timeline, or export a GIF" background={c.bg} gap={24}>
  <Row gap={18} align="stretch">
    <MetricCard label="Checks completed" value={Math.round(progress * 100) + "%"} detail="Driven by the playback time" tone="green" width={380} minHeight={150} />
    <MetricCard label="Animation time" value={t.toFixed(1) + "s"} detail="A three-second loop" tone="blue" width={380} minHeight={150} />
  </Row>
  <Panel title="Delivery progress" tone="purple" width="100%">
    <ProgressList rows={[
      { label: "Build", value: progress, valueLabel: Math.round(progress * 100) + "%", tone: "green" },
      { label: "Review", value: 1 - progress, valueLabel: Math.round((1 - progress) * 100) + "%", tone: "blue" },
    ]} />
  </Panel>
</Scene>`,
}
