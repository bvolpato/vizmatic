import {
  Box,
  assertEqual,
  barChart,
  boundary,
  column,
  connector,
  countUp,
  counter,
  crossThrough,
  delay,
  dot,
  draw,
  fadeIn,
  fadeOut,
  film,
  fitted,
  infoBox,
  lagged,
  lanes,
  morphMatching,
  par,
  pictogram,
  place,
  ringBuffer,
  row,
  sceneKit,
  spotlight,
  surroundingBox,
  text,
} from 'vizmatic/stage'

// Ring ownership and acquire/release ordering: https://man7.org/linux/man-pages/man7/io_uring.7.html
// SQPOLL may sleep and require a wakeup syscall: IORING_SETUP_SQPOLL in
// https://man7.org/linux/man-pages/man2/io_uring_setup.2.html
// Timelines are illustrative. Final counts exclude setup, waits, and wakeups.
export default film(
  {
    title: 'io_uring: shared rings, fewer syscalls',
    description:
      'Blocking reads enter and leave the kernel individually. io_uring shares submission and completion rings with the kernel: batch requests into one enter call, or submit without one while an SQPOLL thread stays awake.',
    look: 'midnight',
    font: 'text-serif',
    fps: 60,
    poster: 22.8,
  },
  (s) => {
    const kit = sceneKit({ size: 38 })
    const title = kit.heading('io_uring: shared rings, fewer syscalls')
    s.add(title)

    // Leave comfortable bottom clearance for captions across all 4 chapters.
    const stageArea = new Box(
      kit.area.left + 8,
      kit.area.top + 2,
      kit.area.right - 8,
      kit.area.bottom - 26,
    )
    const [tagRowBox, stageBox] = stageArea.rows([0.07, 0.93], 12)

    const ch1Tag = text('Chapter 1: Every read crosses the wall', {
      size: 28,
      weight: 600,
      color: 'orange',
    })
    const ch2Tag = text('Chapter 2: Two rings in shared memory', {
      size: 28,
      weight: 600,
      color: 'blue',
    })
    const ch3Tag = text('Chapter 3: Submit in batches, reap without trapping', {
      size: 28,
      weight: 600,
      color: 'teal',
    })
    const ch4Tag = text('Chapter 4: Fewer submission syscalls', {
      size: 28,
      weight: 600,
      color: 'green',
    })

    for (const tag of [ch1Tag, ch2Tag, ch3Tag, ch4Tag]) {
      place(tag, tagRowBox, 'left')
    }
    s.add(ch1Tag.hide())

    // =========================================================================
    // Chapter 1: Every read crosses the wall
    // =========================================================================
    const [ch1LeftPane, ch1RightPane] = stageBox.columns([1.04, 1], 40)
    const [ch1TopBox, ch1LanesBox] = ch1RightPane.rows([0.24, 0.76], 16)

    const switchCounter = counter(0, {
      suffix: ' mode switches',
      size: 34,
      weight: 700,
      color: 'orange',
    })
    const readNote = text('8 blocking pread calls (2 mode switches each)', {
      size: 27,
      color: 'dim',
    })
    place(
      column([switchCounter, readNote], { gap: 10, align: 'left' }),
      ch1TopBox,
      'left',
    )

    const wallWidth = Math.round(ch1LeftPane.width - 16)
    const syscallWall = boundary({
      width: wallWidth,
      label: 'privilege wall (ring 3 <-> ring 0)',
      above: 'user space',
      below: 'kernel VFS',
      color: 'orange',
      weight: 4.5,
      tally: 'syscalls',
      size: 27,
    }).at(ch1LeftPane.cx, ch1LeftPane.top + ch1LeftPane.height * 0.34)

    const driverWall = boundary({
      width: wallWidth,
      label: 'block queue <-> NVMe IRQ',
      below: 'NVMe SSD',
      color: 'blue',
      weight: 3,
      dash: true,
      tally: 'IRQs',
      size: 27,
    }).at(ch1LeftPane.cx, ch1LeftPane.top + ch1LeftPane.height * 0.74)

    const blockingEvents = Array.from({ length: 8 }, (_, i) => {
      const base = i * 12
      return [
        { lane: 'App thread', start: base, end: base + 2.2, color: 'blue' as const },
        {
          lane: 'App thread',
          start: base + 2.2,
          end: base + 11.4,
          color: 'red' as const,
          label: i === 0 ? 'stall' : undefined,
        },
        { lane: 'Kernel VFS', start: base + 2.2, end: base + 5.0, color: 'orange' as const },
        { lane: 'NVMe SSD', start: base + 5.0, end: base + 9.6, color: 'teal' as const },
        { lane: 'Kernel VFS', start: base + 9.6, end: base + 11.4, color: 'orange' as const },
      ]
    }).flat()

    const ch1Lanes = fitted(ch1LanesBox, (width) =>
      lanes(['App thread', 'Kernel VFS', 'NVMe SSD'], blockingEvents, {
        width,
        barHeight: 42,
        size: 27,
        domain: [0, 96],
        axisLabel: 'Illustrative blocking schedule; not measured time',
      }),
    )
    place(ch1Lanes, ch1LanesBox, 'center')

    s.add(
      readNote.hide(),
      switchCounter.hide(),
      syscallWall.hide(),
      driverWall.hide(),
      ch1Lanes.hide(),
    )

    s.chapter('Every read crosses the wall')
    s.caption(
      'Each blocking read enters the kernel and returns to user space: 8 calls make 16 privilege transitions.',
      10.4,
    )

    s.play(
      par(
        fadeIn(ch1Tag, { duration: 0.7 }),
        fadeIn(readNote, { duration: 0.75 }),
        fadeIn(switchCounter, { duration: 0.75 }),
      ),
    )
    s.play(
      par(
        syscallWall.enter({ duration: 0.95 }),
        driverWall.enter({ duration: 0.95 }),
        ch1Lanes.enter({ duration: 0.95 }),
      ),
    )

    const crossings = Array.from({ length: 8 }, (_, i) => {
      const xPos = syscallWall.x((i + 0.5) / 8)
      return crossThrough([syscallWall, driverWall], xPos, {
        direction: 'round',
        reach: 44,
        color: 'orange',
        duration: 0.95,
      })
    })
    const sweepDuration = 5.4
    s.play(
      par(
        lagged(crossings, { lag: 0.55, duration: sweepDuration }),
        countUp(switchCounter, 16, { duration: sweepDuration }),
        ch1Lanes.showAll({ duration: sweepDuration }),
      ),
    )
    assertEqual(syscallWall.count, 8, 'blocking syscalls counted')
    assertEqual(driverWall.count, 8, 'driver IRQ trips counted')
    s.wait(3.2)

    s.play(
      fadeOut([readNote, switchCounter, syscallWall, driverWall, ch1Lanes], {
        duration: 0.65,
      }),
    )

    // =========================================================================
    // Chapter 2: Two rings in shared memory
    // =========================================================================
    const [appColBox, ringsCenterBox, kernelColBox] = stageBox.columns(
      [0.175, 0.65, 0.175],
      20,
    )
    const [sharedTitleBox, wheelsBox, ringStatusBox] = ringsCenterBox.rows(
      [0.11, 0.77, 0.12],
      10,
    )

    const sharedHeader = text('mmap() shared memory (visible to user + kernel)', {
      size: 28,
      weight: 600,
      color: 'blue',
    })
    place(sharedHeader, sharedTitleBox, 'center')

    const sq = ringBuffer(8, {
      radius: 142,
      thickness: 58,
      color: 'blue',
      label: 'Submission Queue',
      size: 27,
      labelSize: 27,
      headColor: 'purple',
      tailColor: 'blue',
      tailFollows: 'publish',
      counts: true,
    })

    const cq = ringBuffer(8, {
      radius: 142,
      thickness: 58,
      color: 'teal',
      label: 'Completion Queue',
      size: 27,
      labelSize: 27,
      headColor: 'teal',
      tailColor: 'green',
      tailFollows: 'publish',
      counts: true,
    })

    const wheelsRow = row([sq, cq], { gap: 28, align: 'center' })
    place(wheelsRow, wheelsBox, 'center')

    const sharedFrame = surroundingBox([sq, cq], {
      pad: 14,
      radius: 14,
      color: 'blue',
      width: 2,
      fill: 'blue',
      fillOpacity: 0.05,
    })

    const ringInvariantNote = text(
      'Producer release-stores tail; consumer acquire-loads tail',
      { size: 27, color: 'dim' },
    )
    place(ringInvariantNote, ringStatusBox, 'center')

    const appIcon = pictogram('process', { size: 60, color: 'blue', accent: 'teal' })
    const appCard = infoBox({
      title: 'User App',
      rows: [
        { label: 'SQ', value: 'push', tone: 'blue' },
        { label: 'CQ', value: 'reap', tone: 'teal' },
      ],
      accent: 'blue',
      size: 27,
    })
    place(column([appIcon, appCard], { gap: 14, align: 'center' }), appColBox, 'center')

    const kernelIcon = pictogram('process', { size: 64, color: 'teal', accent: 'yellow' })
    const kernelCard = infoBox({
      title: 'Kernel',
      rows: [
        { label: 'SQ', value: 'poll', tone: 'purple' },
        { label: 'CQ', value: 'post', tone: 'green' },
      ],
      accent: 'teal',
      size: 27,
    })
    place(column([kernelIcon, kernelCard], { gap: 14, align: 'center' }), kernelColBox, 'center')

    const appToSq = connector(appCard, sharedFrame, {
      from: 'right',
      to: 'left',
      fromOffset: -0.28,
      toOffset: -0.22,
      color: 'blue',
      width: 2.5,
      curvature: 0.25,
    })
    const cqToApp = connector(sharedFrame, appCard, {
      from: 'left',
      to: 'right',
      fromOffset: 0.22,
      toOffset: 0.28,
      color: 'teal',
      width: 2.5,
      curvature: 0.25,
    })
    const sqToKernel = connector(sharedFrame, kernelCard, {
      from: 'right',
      to: 'left',
      fromOffset: -0.22,
      toOffset: -0.28,
      color: 'purple',
      width: 2.5,
      dash: [7, 6],
      flow: 46,
      curvature: 0.25,
    })
    const kernelToCq = connector(kernelCard, sharedFrame, {
      from: 'left',
      to: 'right',
      fromOffset: 0.28,
      toOffset: 0.22,
      color: 'green',
      width: 2.5,
      dash: [7, 6],
      flow: 46,
      curvature: 0.25,
    })

    const sqDots = Array.from({ length: 4 }, () => dot(9, 'yellow').hide())
    const cqDots = Array.from({ length: 4 }, () => dot(9, 'green').hide())

    s.add(
      sharedFrame.hide(),
      sharedHeader.hide(),
      sq.hide(),
      cq.hide(),
      ringInvariantNote.hide(),
      appIcon.hide(),
      appCard.hide(),
      kernelIcon.hide(),
      kernelCard.hide(),
      appToSq.hide(),
      sqToKernel.hide(),
      kernelToCq.hide(),
      cqToApp.hide(),
      ...sqDots,
      ...cqDots,
    )

    s.chapter('Two rings in shared memory')
    s.caption(
      'io_uring shares submission and completion rings between user space and the kernel. Here, an awake SQPOLL thread consumes submissions.',
      9.4,
    )

    s.play(
      par(
        morphMatching(ch1Tag, ch2Tag, { duration: 0.7 }),
        fadeIn(sharedFrame, { duration: 0.85 }),
        fadeIn(sharedHeader, { duration: 0.85 }),
        sq.enter({ duration: 1.15 }),
        cq.enter({ duration: 1.15 }),
      ),
    )
    s.play(
      par(
        fadeIn([appIcon, appCard, kernelIcon, kernelCard], { duration: 0.85 }),
        fadeIn(ringInvariantNote, { duration: 0.85 }),
        draw(appToSq, { duration: 0.9 }),
        draw(sqToKernel, { duration: 0.9 }),
        draw(kernelToCq, { duration: 0.9 }),
        draw(cqToApp, { duration: 0.9 }),
      ),
    )
    s.wait(4.8)

    // =========================================================================
    // Chapter 3: Submit in batches, reap without trapping
    // =========================================================================
    const trapFreeNote = text(
      'Awake SQPOLL: publish tail; kernel consumes SQ and posts CQ',
      { size: 27, weight: 600, color: 'teal' },
    )
    place(trapFreeNote, ringStatusBox, 'center')
    s.add(trapFreeNote.hide())

    s.chapter('Submit in batches, reap without trapping')
    s.caption(
      'Publish four SQEs with a release-store. The kernel acquire-loads tail, advances head, runs the I/O, and posts completions. User space drains CQ.',
      12.8,
    )

    s.play(
      par(
        morphMatching(ch2Tag, ch3Tag, { duration: 0.7 }),
        fadeOut(ringInvariantNote, { duration: 0.4 }),
        delay(fadeIn(trapFreeNote, { duration: 0.55 }), 0.48),
      ),
    )

    s.play(
      par(
        lagged(
          [
            sq.push({ label: 'R0', color: 'blue', pending: true }, { duration: 0.58 }),
            sq.push({ label: 'R1', color: 'blue', pending: true }, { duration: 0.58 }),
            sq.push({ label: 'R2', color: 'blue', pending: true }, { duration: 0.58 }),
            sq.push({ label: 'R3', color: 'blue', pending: true }, { duration: 0.58 }),
          ],
          { lag: 0.42 },
        ),
        appToSq.pulse({ color: 'blue', duration: 1.3 }),
      ),
    )
    assertEqual(sq.pending, 4, '4 SQEs staged before publish')
    assertEqual(sq.tail, 4, 'writer index advanced across 4 SQEs')

    s.play(sq.publish({ duration: 0.95 }))
    assertEqual(sq.pending, 0, '0 pending SQEs after atomic publish')
    assertEqual(sq.length, 4, 'all 4 SQEs visible to kernel poller')
    s.wait(1.4)

    s.play(
      par(
        lagged(
          [
            sq.pop({ duration: 0.58 }),
            sq.pop({ duration: 0.58 }),
            sq.pop({ duration: 0.58 }),
            sq.pop({ duration: 0.58 }),
          ],
          { lag: 0.42 },
        ),
        lagged(
          [
            sqToKernel.send(sqDots[0]!, { duration: 0.68 }),
            sqToKernel.send(sqDots[1]!, { duration: 0.68 }),
            sqToKernel.send(sqDots[2]!, { duration: 0.68 }),
            sqToKernel.send(sqDots[3]!, { duration: 0.68 }),
          ],
          { lag: 0.42 },
        ),
      ),
    )
    assertEqual(sq.head, 4, 'SQ head matches tail after kernel fetch')
    assertEqual(sq.length, 0, 'SQ empty after kernel consumes submissions')

    s.play(
      par(
        lagged(
          [
            kernelToCq.send(cqDots[0]!, { duration: 0.65 }),
            kernelToCq.send(cqDots[1]!, { duration: 0.65 }),
            kernelToCq.send(cqDots[2]!, { duration: 0.65 }),
            kernelToCq.send(cqDots[3]!, { duration: 0.65 }),
          ],
          { lag: 0.4 },
        ),
        lagged(
          [
            cq.push({ label: 'C0', color: 'teal', pending: true }, { duration: 0.55 }),
            cq.push({ label: 'C1', color: 'teal', pending: true }, { duration: 0.55 }),
            cq.push({ label: 'C2', color: 'teal', pending: true }, { duration: 0.55 }),
            cq.push({ label: 'C3', color: 'teal', pending: true }, { duration: 0.55 }),
          ],
          { lag: 0.4 },
        ),
      ),
    )
    s.play(cq.publish({ duration: 0.85 }))
    assertEqual(cq.tail, 4, 'CQ tail published to 4')
    assertEqual(cq.length, 4, '4 CQEs ready for user space')
    s.wait(1.3)

    s.play(
      par(
        lagged(
          [
            cq.pop({ duration: 0.55 }),
            cq.pop({ duration: 0.55 }),
            cq.pop({ duration: 0.55 }),
            cq.pop({ duration: 0.55 }),
          ],
          { lag: 0.4 },
        ),
        cqToApp.pulse({ color: 'teal', duration: 1.15 }),
      ),
    )
    assertEqual(cq.head, 4, 'CQ head advances to 4 after user reap')
    assertEqual(cq.length, 0, 'CQ cleanly drained')
    s.wait(3.4)

    s.play(
      fadeOut(
        [
          sharedFrame,
          sharedHeader,
          sq,
          cq,
          trapFreeNote,
          appIcon,
          appCard,
          kernelIcon,
          kernelCard,
          appToSq,
          sqToKernel,
          kernelToCq,
          cqToApp,
        ],
        { duration: 0.65 },
      ),
    )

    // =========================================================================
    // Chapter 4: Fewer submission syscalls
    // =========================================================================
    const [chartColBox, pipelineColBox] = stageBox.columns([0.48, 0.52], 32)
    const [chartHeaderBox, chartBodyBox] = chartColBox.rows([0.13, 0.87], 12)
    const [pipeLanesBox, payoffBox] = pipelineColBox.rows([0.64, 0.36], 18)

    const chartHeading = text('Submission syscalls for 32 reads', {
      size: 30,
      weight: 600,
      color: 'ink',
    })
    place(chartHeading, chartHeaderBox, 'center')

    const submitChart = barChart(
      [
        { label: 'Blocking', value: 32, color: 'orange' },
        { label: 'Batched', value: 1, color: 'blue' },
        { label: 'SQPOLL', value: 0, color: 'teal' },
      ],
      {
        width: Math.min(600, Math.round(chartBodyBox.width - 100)),
        height: Math.min(370, Math.round(chartBodyBox.height - 90)),
        labelSize: 28,
        max: 32,
        ticks: [0, 8, 16, 24, 32],
        showValues: true,
        states: true,
        format: (v) => `${Math.round(v)}`,
      },
    )
    place(submitChart, chartBodyBox, 'center')

    const asyncEvents = [
      { lane: 'App thread', start: 0, end: 18, color: 'blue' as const, label: 'SQE x32' },
      { lane: 'App thread', start: 19, end: 46, color: 'teal' as const, label: 'compute' },
      { lane: 'App thread', start: 47, end: 64, color: 'blue' as const, label: 'SQE x32' },
      { lane: 'App thread', start: 65, end: 96, color: 'teal' as const, label: 'compute' },
      { lane: 'Kernel work', start: 4, end: 48, color: 'purple' as const },
      { lane: 'Kernel work', start: 50, end: 94, color: 'purple' as const },
      { lane: 'NVMe SSD', start: 6, end: 52, color: 'green' as const, label: 'depth 32' },
      { lane: 'NVMe SSD', start: 52, end: 96, color: 'green' as const, label: 'depth 32' },
    ]
    const ch4Lanes = fitted(pipeLanesBox, (width) =>
      lanes(['App thread', 'Kernel work', 'NVMe SSD'], asyncEvents, {
        width,
        barHeight: 44,
        size: 27,
        domain: [0, 96],
        axisLabel: 'Illustrative overlap; SQPOLL thread stays awake',
      }),
    )
    place(ch4Lanes, pipeLanesBox, 'center')

    const payoffCard = infoBox({
      title: 'Submission counts, not a speed benchmark',
      rows: [
        { label: 'batch', value: '32 SQEs, 1 enter call', tone: 'blue' },
        { label: 'SQPOLL', value: '0 while poller is awake', tone: 'teal' },
        { label: 'excluded', value: 'setup, waits, wakeups', tone: 'dim' },
      ],
      accent: 'green',
      size: 27,
      width: Math.min(760, Math.round(payoffBox.width - 16)),
    })
    place(payoffCard, payoffBox, 'center')

    s.add(
      chartHeading.hide(),
      submitChart.hide(),
      ch4Lanes.hide(),
      payoffCard.hide(),
    )

    s.chapter('Fewer submission syscalls')
    s.caption(
      'A batch submits 32 reads with one enter call. Awake SQPOLL needs none; setup, blocking waits, and waking a sleeping poller still need syscalls.',
      9.4,
    )

    s.play(
      par(
        morphMatching(ch3Tag, ch4Tag, { duration: 0.7 }),
        fadeIn(chartHeading, { duration: 0.75 }),
        submitChart.enter({ duration: 1.1 }),
        ch4Lanes.enter({ duration: 0.95 }),
        fadeIn(payoffCard, { duration: 0.95 }),
      ),
    )
    s.play(
      par(
        ch4Lanes.showAll({ duration: 2.6 }),
        submitChart.mark('SQPOLL', 'chosen', { duration: 0.75 }),
      ),
    )
    s.play(
      spotlight([submitChart, payoffCard], {
        keep: [title, ch4Tag, chartHeading, ch4Lanes],
        dim: 0.25,
        duration: 0.9,
      }),
    )
    s.wait(3.4)
    s.play(spotlight(null, { duration: 0.75 }))
    s.wait(2.8)
  },
)
