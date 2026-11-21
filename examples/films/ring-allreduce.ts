import {
  Box,
  assertEqual,
  barChart,
  column,
  countUp,
  counter,
  delay,
  dotChart,
  fadeIn,
  fadeOut,
  film,
  graph,
  infoBox,
  morphMatching,
  par,
  place,
  sceneKit,
  segmentedBar,
  spotlight,
  tex,
  text,
  write,
} from 'vizmatic/stage'

// ReduceScatter + AllGather semantics:
// https://docs.nvidia.com/deeplearning/nccl/user-guide/docs/usage/collectives.html
// Ideal ring volume: each GPU sends (N-1) shards of size Phi/N in each phase.
// The 2(N-1)/N factor and latency/bandwidth distinction are also documented at:
// https://github.com/NVIDIA/nccl-tests/blob/master/doc/PERFORMANCE.md
const NUM_GPUS = 8

// Deterministic local gradient shards G[gpu][shard] across 8 GPUs and 8 shards.
const LOCAL_SHARDS: readonly (readonly number[])[] = Array.from(
  { length: NUM_GPUS },
  (_, g) =>
    Array.from(
      { length: NUM_GPUS },
      (__, s) => Number(((g + 1) * 0.25 + (s + 1) * 0.1).toFixed(4)),
    ),
)

const EXPECTED_GLOBAL_SUM: readonly number[] = Array.from(
  { length: NUM_GPUS },
  (_, s) =>
    LOCAL_SHARDS.reduce((acc, gpuRow) => acc + gpuRow[s]!, 0),
)

// Simulate 7 Reduce-Scatter hops + 7 All-Gather hops on the 8-GPU ring.
function simulateRingAllReduce(): {
  afterScatterOwnerShard: readonly number[]
  finalBuffers: readonly (readonly number[])[]
} {
  const buf = LOCAL_SHARDS.map((row) => [...row])

  // Reduce-Scatter: on hop h (0..6), GPU g sends shard (g - h + 8) % 8 to (g + 1) % 8.
  for (let h = 0; h < NUM_GPUS - 1; h++) {
    const incoming: { to: number; shard: number; val: number }[] = []
    for (let g = 0; g < NUM_GPUS; g++) {
      const shard = (g - h + NUM_GPUS) % NUM_GPUS
      incoming.push({ to: (g + 1) % NUM_GPUS, shard, val: buf[g]![shard]! })
    }
    for (const pkt of incoming) {
      buf[pkt.to]![pkt.shard] = buf[pkt.to]![pkt.shard]! + pkt.val
    }
  }

  // After 7 hops, GPU g owns the completed global sum of shard (g + 1) % 8.
  const ownerShards = Array.from(
    { length: NUM_GPUS },
    (_, g) => (g + 1) % NUM_GPUS,
  )

  // All-Gather: on hop h (0..6), GPU g forwards completed shard (g + 1 - h + 8) % 8 to (g + 1) % 8.
  for (let h = 0; h < NUM_GPUS - 1; h++) {
    const copies: { to: number; shard: number; val: number }[] = []
    for (let g = 0; g < NUM_GPUS; g++) {
      const shard = (g + 1 - h + NUM_GPUS) % NUM_GPUS
      copies.push({ to: (g + 1) % NUM_GPUS, shard, val: buf[g]![shard]! })
    }
    for (const pkt of copies) {
      buf[pkt.to]![pkt.shard] = pkt.val
    }
  }

  return { afterScatterOwnerShard: ownerShards, finalBuffers: buf }
}

const SIM = simulateRingAllReduce()
let maxRingErr = 0
for (let g = 0; g < NUM_GPUS; g++) {
  for (let sIdx = 0; sIdx < NUM_GPUS; sIdx++) {
    maxRingErr = Math.max(
      maxRingErr,
      Math.abs(SIM.finalBuffers[g]![sIdx]! - EXPECTED_GLOBAL_SUM[sIdx]!),
    )
  }
}
assertEqual(
  maxRingErr < 1e-9,
  true,
  '8-GPU ring reduce-scatter + all-gather matches exact elementwise sum',
)

export default film(
  {
    title: 'Eight GPUs, one ring, bounded transfer',
    description:
      'An ideal 8-GPU ring performs 7 reduce-scatter and 7 all-gather hops. Each GPU sends and receives 1.75 tensor volumes; bounded volume does not guarantee constant latency or link utilization.',
    look: 'neon',
    font: 'text-serif',
    fps: 60,
    poster: 26.5,
  },
  (s) => {
    const kit = sceneKit({ size: 38, source: { y: -420 } })
    const title = kit.heading('Eight GPUs, one ring, bounded transfer')
    const modelNote = kit.source('Ideal ring, equal shards. Φ = tensor size. Latency and topology still matter.')
    s.add(title, modelNote)

    const stageArea = new Box(
      kit.area.left + 8,
      kit.area.top + 2,
      kit.area.right - 8,
      kit.area.bottom - 26,
    )
    const [tagRowBox, mainBox] = stageArea.rows([0.07, 0.93], 12)
    const [leftTopoPane, rightMetricsPane] = mainBox.columns([1.04, 0.96], 36)

    const ch1Tag = text('Chapter 1: The parameter-server bottleneck', {
      size: 28,
      weight: 600,
      color: 'red',
    })
    const ch2Tag = text('Chapter 2: Form the NVLink ring', {
      size: 28,
      weight: 600,
      color: 'blue',
    })
    const ch3Tag = text('Chapter 3: Reduce-Scatter in 7 lockstep hops', {
      size: 28,
      weight: 600,
      color: 'teal',
    })
    const ch4Tag = text('Chapter 4: All-Gather and bounded volume', {
      size: 28,
      weight: 600,
      color: 'green',
    })
    for (const tag of [ch1Tag, ch2Tag, ch3Tag, ch4Tag]) {
      place(tag, tagRowBox, 'left')
    }
    s.add(ch1Tag.hide())

    // =========================================================================
    // Chapter 1: Parameter-server star topology vs 8x hub congestion
    // =========================================================================
    const starRadius = 225
    const starNodes = [
      {
        id: 'PS',
        label: 'Param Hub',
        value: 'idle',
        width: 168,
        color: 'orange' as const,
        at: [0, 0] as const,
      },
      ...Array.from({ length: NUM_GPUS }, (_, i) => {
        const angle = -Math.PI / 2 + (i / NUM_GPUS) * Math.PI * 2
        return {
          id: `P${i}`,
          label: `GPU ${i}`,
          radius: 42,
          color: 'blue' as const,
          at: [
            Math.round(Math.cos(angle) * starRadius),
            Math.round(Math.sin(angle) * starRadius),
          ] as const,
        }
      }),
    ]
    const starEdges = Array.from({ length: NUM_GPUS }, (_, i) => ({
      from: `P${i}`,
      to: 'PS',
      color: 'orange' as const,
      width: 2.4,
    }))

    const starGraph = graph(starNodes, starEdges, {
      layout: 'manual',
      labelSize: 26,
      valueSize: 26,
      directed: true,
    })
    place(starGraph, leftTopoPane, 'center')

    const [ch1ChartBox, ch1CardBox] = rightMetricsPane.rows([0.62, 0.38], 18)
    const hubLoadChart = barChart(
      [
        { label: 'Star GPU sent', value: 1, color: 'blue' },
        { label: 'Ring GPU sent', value: 1.75, color: 'teal' },
        { label: 'Hub received', value: 8, color: 'red' },
      ],
      {
        width: Math.min(620, Math.round(ch1ChartBox.width - 100)),
        height: Math.min(340, Math.round(ch1ChartBox.height - 80)),
        labelSize: 27,
        max: 9,
        ticks: [0, 3, 6, 9],
        showValues: true,
        format: (v) => `${v.toFixed(v % 1 === 0 ? 0 : 2)}× Φ`,
      },
    )
    place(hubLoadChart, ch1ChartBox, 'center')

    const bottleneckCard = infoBox({
      title: 'One hub receives N tensor volumes',
      rows: [
        { label: 'inbound at hub', value: '8 × Φ gradients', tone: 'red', meter: 0.96 },
        { label: 'assumption', value: 'one shared hub NIC', tone: 'orange' },
      ],
      accent: 'red',
      size: 27,
    })
    place(bottleneckCard, ch1CardBox, 'center')

    s.add(starGraph.hide(), hubLoadChart.hide(), bottleneckCard.hide())

    s.chapter('The parameter-server bottleneck')
    s.caption(
      'In this star model, eight GPUs send one tensor each. The shared hub receives eight tensor volumes before distributing the result.',
      9.4,
    )

    s.play(
      par(
        fadeIn(ch1Tag, { duration: 0.65 }),
        starGraph.enter({ duration: 1.15 }),
        hubLoadChart.enter({ duration: 1.05 }),
        fadeIn(bottleneckCard, { duration: 0.85 }),
      ),
    )

    // Eight incoming tensor volumes share the modeled hub NIC.
    s.play(
      par(
        ...Array.from({ length: NUM_GPUS }, (_, i) =>
          starGraph.send(`P${i}`, 'PS', {
            color: 'red',
            duration: 0.95,
            ...(i === 0 ? { value: '8 Φ in' } : {}),
          }),
        ),
      ),
    )
    s.play(starGraph.setState('PS', 'active', { duration: 0.6 }))
    assertEqual(starGraph.stateOf('PS'), 'active', 'hub receives gradients')
    s.wait(4.2)

    s.play(
      fadeOut([starGraph, hubLoadChart, bottleneckCard], { duration: 0.6 }),
    )

    // =========================================================================
    // Chapters 2, 3, 4: 8-GPU NVLink Ring Graph
    // =========================================================================
    const ringRadius = 258
    const ringNodes = Array.from({ length: NUM_GPUS }, (_, i) => {
      const angle = -Math.PI / 2 + (i / NUM_GPUS) * Math.PI * 2
      return {
        id: `G${i}`,
        label: `GPU ${i}`,
        value: '8 local',
        width: 132,
        color: 'blue' as const,
        at: [
          Math.round(Math.cos(angle) * ringRadius),
          Math.round(Math.sin(angle) * ringRadius),
        ] as const,
      }
    })
    const ringEdges = Array.from({ length: NUM_GPUS }, (_, i) => ({
      from: `G${i}`,
      to: `G${(i + 1) % NUM_GPUS}`,
      color: 'teal' as const,
      width: 3,
    }))

    const ringGraph = graph(ringNodes, ringEdges, {
      layout: 'manual',
      labelSize: 26,
      valueSize: 26,
      directed: true,
    })
    place(ringGraph, leftTopoPane, 'center')

    const [rightTopSlot, rightMidSlot, rightBotSlot] = rightMetricsPane.rows(
      [0.32, 0.18, 0.5],
      16,
    )

    const linkBarTitle = text('8 ring links: concurrent shard transfers', {
      size: 27,
      weight: 600,
      color: 'teal',
    })
    const nvlinkBar = segmentedBar(
      Array.from({ length: NUM_GPUS }, (_, i) => ({
        name: `L${i}`,
        value: 1,
        color: i % 2 === 0 ? ('blue' as const) : ('teal' as const),
      })),
      {
        width: Math.min(720, Math.round(rightTopSlot.width - 24)),
        height: 48,
        size: 27,
      },
    )
    place(
      column([linkBarTitle, nvlinkBar], { gap: 12, align: 'center' }),
      rightTopSlot,
      'center',
    )

    const scatterHopCounter = counter(0, {
      prefix: 'Reduce-Scatter hop ',
      suffix: ' / 7',
      size: 32,
      weight: 700,
      color: 'teal',
    })
    place(scatterHopCounter, rightMidSlot, 'center')

    const gatherHopCounter = counter(0, {
      prefix: 'All-Gather hop ',
      suffix: ' / 7',
      size: 32,
      weight: 700,
      color: 'green',
    })
    place(gatherHopCounter, rightMidSlot, 'center')

    const shardCard = infoBox({
      title: 'Tensor sliced into 8 equal shards (Φ / 8)',
      rows: [
        { label: 'each hop', value: '1 shard sent + 1 received', tone: 'blue' },
        { label: 'ideal ring', value: '8 concurrent sends', tone: 'teal' },
        { label: 'hub server', value: 'none (peer-to-peer)', tone: 'green' },
      ],
      accent: 'blue',
      size: 27,
    })
    place(shardCard, rightBotSlot, 'center')

    const scatterDoneCard = infoBox({
      title: 'After 7 hops: each GPU holds 1 global sum',
      rows: [
        { label: 'GPU i owns', value: 'sum of shard (i+1) mod 8', tone: 'teal' },
        { label: 'sent per GPU', value: '7/8 Φ', tone: 'blue', meter: 0.875 },
      ],
      accent: 'teal',
      size: 27,
    })
    place(scatterDoneCard, rightBotSlot, 'center')

    s.add(
      ringGraph.hide(),
      linkBarTitle.hide(),
      nvlinkBar.hide(),
      scatterHopCounter.hide(),
      gatherHopCounter.hide(),
      shardCard.hide(),
      scatterDoneCard.hide(),
    )

    // =========================================================================
    // Chapter 2: Form the NVLink ring
    // =========================================================================
    s.chapter('Form the NVLink ring')
    s.caption(
      'Arrange the eight GPUs into a directed NVLink ring and slice gradients into eight shards.',
      7.4,
    )

    s.play(
      par(
        morphMatching(ch1Tag, ch2Tag, { duration: 0.65 }),
        ringGraph.enter({ duration: 1.25 }),
        fadeIn(linkBarTitle, { duration: 0.75 }),
        nvlinkBar.enter({ duration: 0.95 }),
        fadeIn(shardCard, { duration: 0.85 }),
      ),
    )
    s.wait(4.2)

    // =========================================================================
    // Chapter 3: Reduce-Scatter (7 lockstep hops)
    // =========================================================================
    s.chapter('Reduce-Scatter: 7 lockstep hops')
    s.caption(
      'Across seven lockstep hops, every GPU sends one shard clockwise and accumulates partial sums.',
      10.8,
    )

    s.play(
      par(
        morphMatching(ch2Tag, ch3Tag, { duration: 0.65 }),
        fadeIn(scatterHopCounter, { duration: 0.55 }),
      ),
    )

    // Run 7 lockstep clockwise hops across all 8 NVLink edges simultaneously.
    for (let hop = 1; hop <= NUM_GPUS - 1; hop++) {
      const isLast = hop === NUM_GPUS - 1
      s.play(
        par(
          countUp(scatterHopCounter, hop, { duration: 0.72 }),
          ...Array.from({ length: NUM_GPUS }, (_, g) => {
            const nextG = (g + 1) % NUM_GPUS
            const ownedShard = SIM.afterScatterOwnerShard[nextG]!
            return ringGraph.send(`G${g}`, `G${nextG}`, {
              color: 'teal',
              duration: 0.72,
              ...(isLast ? { value: `sum S${ownedShard}` } : {}),
            })
          }),
        ),
      )
    }

    s.play(
      par(
        ...Array.from({ length: NUM_GPUS }, (_, g) =>
          ringGraph.setState(`G${g}`, 'active', { color: 'teal', duration: 0.5 }),
        ),
        fadeOut(shardCard, { duration: 0.35 }),
        delay(fadeIn(scatterDoneCard, { duration: 0.5 }), 0.42),
      ),
    )
    assertEqual(ringGraph.valueOf('G0'), 'sum S1', 'GPU 0 holds exact sum S1')
    s.wait(3.2)

    // =========================================================================
    // Chapter 4: All-Gather & bounded volume
    // =========================================================================
    const [ch4EqSlot, ch4ChartSlot] = rightMetricsPane.rows([0.28, 0.72], 14)

    const scalingEq = tex(
      'V_{\\text{sent}} = 2\\,\\frac{N - 1}{N}\\,\\Phi \\;<\\; 2\\Phi',
      { size: 38, color: 'green' },
    )
    place(scalingEq, ch4EqSlot, 'center')

    const scalingChart = dotChart(
      [
        { label: 'Ring  (4 GPUs)', value: 1.5, color: 'teal' },
        { label: 'Ring  (8 GPUs)', value: 1.75, color: 'green' },
        { label: 'Ring  (16 GPUs)', value: 1.875, color: 'green' },
        { label: 'Ring  (64 GPUs)', value: 1.969, color: 'green' },
        { label: 'Star  (8 GPUs)', value: 8.0, color: 'red', hollow: true },
      ],
      {
        width: Math.min(480, Math.round(ch4ChartSlot.width - 240)),
        labelSize: 27,
        domain: [0, 9],
        ticks: [0, 2, 4, 6, 8],
        xLabel: 'Ring sent / hub received (Φ)',
      },
    )
    place(scalingChart, ch4ChartSlot, 'center')

    s.add(scalingEq.hide(), scalingChart.hide())

    s.chapter('All-Gather and bounded volume')
    s.caption(
      'Seven all-gather hops distribute every completed shard. Each GPU sends less than two tensor volumes and receives the same amount; the number of hops still grows with N.',
      12.4,
    )

    s.play(
      par(
        morphMatching(ch3Tag, ch4Tag, { duration: 0.65 }),
        fadeOut(scatterHopCounter, { duration: 0.35 }),
        delay(fadeIn(gatherHopCounter, { duration: 0.45 }), 0.4),
      ),
    )

    // 7 All-Gather lockstep clockwise hops distribute completed shards to every GPU.
    for (let hop = 1; hop <= NUM_GPUS - 1; hop++) {
      const isLast = hop === NUM_GPUS - 1
      s.play(
        par(
          countUp(gatherHopCounter, hop, { duration: 0.66 }),
          ...Array.from({ length: NUM_GPUS }, (_, g) => {
            const nextG = (g + 1) % NUM_GPUS
            return ringGraph.send(`G${g}`, `G${nextG}`, {
              color: 'green',
              duration: 0.66,
              ...(isLast ? { value: 'all 8 ok' } : {}),
            })
          }),
        ),
      )
    }

    s.play(
      par(
        ...Array.from({ length: NUM_GPUS }, (_, g) =>
          ringGraph.setState(`G${g}`, 'done', { duration: 0.55 }),
        ),
        fadeOut([linkBarTitle, nvlinkBar, gatherHopCounter, scatterDoneCard], {
          duration: 0.45,
        }),
        delay(write(scalingEq, { duration: 0.85 }), 0.5),
        delay(scalingChart.enter({ duration: 1.05 }), 0.55),
      ),
    )
    assertEqual(ringGraph.stateOf('G7'), 'done', 'all 8 GPUs synced in done state')

    s.play(
      spotlight([ringGraph, scalingEq, scalingChart], {
        keep: [title, modelNote, ch4Tag],
        dim: 0.25,
        duration: 0.85,
      }),
    )
    s.wait(3.8)
    s.play(spotlight(null, { duration: 0.65 }))
    s.wait(2.8)
  },
)
