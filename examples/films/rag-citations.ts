import {
  Box,
  assertEqual,
  countUp,
  counter,
  delay,
  fadeIn,
  fadeOut,
  film,
  fitted,
  infoBox,
  morphMatching,
  par,
  passage,
  place,
  sceneKit,
  spotlight,
  table,
  text,
} from 'vizmatic/stage'

const SOURCE_POLICY = [
  'Section 4: Service Level Agreement.',
  'Cloud tier guarantees 99.95% monthly uptime across regional zones.',
  'Customers must file claims within a 30-day credit window after an incident.',
  'SLA service credits apply to paid enterprise plans only.',
].join(' ')

const DRAFT_ANSWER = [
  'Our SLA guarantees 99.95% uptime across regions.',
  'Submit requests within a 30-day credit window.',
  'Credits cover all workspaces, including free trial accounts.',
].join('\n')

const REPAIRED_ANSWER = [
  'Our SLA guarantees 99.95% uptime across regions.',
  'Submit requests within a 30-day credit window.',
  'Credits cover workspaces on paid enterprise plans.',
].join('\n')

export default film(
  {
    title: 'Every claim needs a receipt',
    description:
      'Retrieval-augmented generation chunks source policy, links every generated clause back to exact spans, snaps contradicted citations, and repairs ungrounded claims.',
    look: 'paper',
    font: 'text-serif',
    fps: 60,
    poster: 24.0,
  },
  (s) => {
    const kit = sceneKit({ size: 38 })
    const title = kit.heading('Every claim needs a receipt')
    s.add(title)

    const stageArea = new Box(
      kit.area.left + 8,
      kit.area.top + 2,
      kit.area.right - 8,
      kit.area.bottom - 26,
    )
    const [tagRowBox, mainBox] = stageArea.rows([0.07, 0.93], 10)
    const [passagesRowBox, bottomRowBox] = mainBox.rows([0.55, 0.45], 18)
    const [sourceBox, answerBox] = passagesRowBox.columns([1, 1], 96)
    const [tableBox, scoreBox] = bottomRowBox.columns([1.34, 0.66], 28)

    const ch1Tag = text('Chapter 1: Chunk the source policy', {
      size: 28,
      weight: 600,
      color: 'blue',
    })
    const ch2Tag = text('Chapter 2: Trace every clause to evidence', {
      size: 28,
      weight: 600,
      color: 'teal',
    })
    const ch3Tag = text('Chapter 3: Catch the hallucination', {
      size: 28,
      weight: 600,
      color: 'red',
    })
    const ch4Tag = text('Chapter 4: Repair and verify', {
      size: 28,
      weight: 600,
      color: 'green',
    })
    for (const tag of [ch1Tag, ch2Tag, ch3Tag, ch4Tag]) {
      place(tag, tagRowBox, 'left')
    }
    s.add(ch1Tag.hide())

    // =========================================================================
    // Source & Answer Passages (with fixed line reserve so diff/accept stay steady)
    // =========================================================================
    const sourceDoc = fitted(sourceBox, (width) =>
      passage(SOURCE_POLICY, {
        width,
        size: 28,
        leading: 1.56,
        title: 'Source: Enterprise SLA Policy v4.2',
        lines: 6,
      }),
    )
    place(sourceDoc, sourceBox, 'center')

    const answerDoc = fitted(answerBox, (width) =>
      passage(DRAFT_ANSWER, {
        width,
        size: 28,
        leading: 1.56,
        title: 'Model Draft Answer',
        lines: 6,
      }),
    )
    place(answerDoc, answerBox, 'center')

    // =========================================================================
    // Faithfulness Audit Table + Grounding Readout
    // =========================================================================
    const auditTable = table(
      [
        { key: 'clause', label: 'Answer clause' },
        { key: 'evidence', label: 'Retrieved span', sample: 'paid enterprise plans only' },
        { key: 'verdict', label: 'Verdict', marks: true, sample: 'contradicted' },
      ],
      [
        {
          id: 'c1',
          clause: '99.95% uptime',
          evidence: 'pending...',
          verdict: { value: 'pending', state: 'pending' },
        },
        {
          id: 'c2',
          clause: '30-day credit window',
          evidence: 'pending...',
          verdict: { value: 'pending', state: 'pending' },
        },
        {
          id: 'c3',
          clause: 'account eligibility',
          evidence: 'pending...',
          verdict: { value: 'pending', state: 'pending' },
        },
      ],
      {
        size: 27,
        leading: 1.78,
        width: Math.round(tableBox.width - 12),
      },
    )
    place(auditTable, tableBox, 'center')

    const [counterSlot, statusCardSlot] = scoreBox.rows([0.28, 0.72], 12)

    const groundedCounter = counter(0, {
      suffix: ' / 3 claims grounded',
      size: 32,
      weight: 700,
      color: 'green',
    })
    place(groundedCounter, counterSlot, 'center')

    const chunkCard = infoBox({
      title: 'Retriever index (top-3 spans)',
      rows: [
        { label: 'chunker', value: 'sentence boundary', tone: 'blue' },
        { label: 'hits', value: '3 policy clauses', tone: 'teal' },
      ],
      accent: 'blue',
      size: 27,
    })
    place(chunkCard, statusCardSlot, 'center')

    const alertCard = infoBox({
      title: 'Verifier blocked ungrounded output',
      rows: [
        { label: 'claim 3', value: 'free trial accounts', tone: 'red' },
        { label: 'policy', value: 'paid enterprise only', tone: 'orange' },
      ],
      accent: 'red',
      size: 27,
    })
    place(alertCard, statusCardSlot, 'center')

    const verifiedCard = infoBox({
      title: 'All 3 receipts verified (100%)',
      rows: [
        { label: 'rewritten', value: 'paid enterprise plans', tone: 'green' },
        { label: 'hallucinations', value: '0 ungrounded spans', tone: 'teal' },
      ],
      accent: 'green',
      size: 27,
    })
    place(verifiedCard, statusCardSlot, 'center')

    s.add(
      sourceDoc.hide(),
      answerDoc.hide(),
      auditTable.hide(),
      groundedCounter.hide(),
      chunkCard.hide(),
      alertCard.hide(),
      verifiedCard.hide(),
    )

    // =========================================================================
    // Chapter 1: Chunk the source
    // =========================================================================
    s.chapter('Chunk the source')
    s.caption(
      'Split the SLA policy into sentence chunks and highlight retrieved evidence spans.',
      9.8,
    )

    s.play(
      par(
        fadeIn(ch1Tag, { duration: 0.65 }),
        sourceDoc.enter({ duration: 1.1 }),
        auditTable.enter({ duration: 1.05 }),
        fadeIn(groundedCounter, { duration: 0.75 }),
        fadeIn(chunkCard, { duration: 0.85 }),
      ),
    )
    s.play(
      sourceDoc.cut({ by: 'sentence' }, { colors: ['blue', 'teal'], duration: 1.25 }),
    )
    assertEqual(sourceDoc.chunks.length, 4, '4 sentence chunks in SLA policy')
    s.wait(2.8)

    // Transition from raw sentence chunks to exact retrieved spans.
    s.play(sourceDoc.cut(null, { duration: 0.65 }))
    s.play(
      par(
        sourceDoc.mark('99.95% monthly uptime', 'mark', { duration: 0.8 }),
        sourceDoc.mark('30-day credit window', 'mark', { duration: 0.8 }),
        sourceDoc.mark('paid enterprise plans only', 'mark', { duration: 0.8 }),
      ),
    )
    s.wait(3.2)

    // =========================================================================
    // Chapter 2: Trace every clause to evidence
    // =========================================================================
    s.chapter('Trace every clause to evidence')
    s.caption(
      'Citation links bind each generated clause to its supporting policy span and score faithfulness.',
      10.8,
    )

    s.play(
      par(
        morphMatching(ch1Tag, ch2Tag, { duration: 0.65 }),
        answerDoc.enter({ duration: 1.05 }),
      ),
    )

    s.play(
      par(
        answerDoc.mark('99.95% uptime', 'claim', { duration: 0.6 }),
        answerDoc.mark('30-day credit window', 'claim', { duration: 0.6 }),
        answerDoc.mark('including free trial accounts', 'claim', { duration: 0.6 }),
      ),
    )

    const link1 = answerDoc.link(
      '99.95% uptime',
      sourceDoc.span('99.95% monthly uptime'),
      { color: 'green', shift: -22 },
    )
    s.play(
      par(
        link1.enter({ duration: 0.85 }),
        answerDoc.mark('99.95% uptime', 'supported', { duration: 0.75 }),
        sourceDoc.mark('99.95% monthly uptime', 'supported', { duration: 0.75 }),
        auditTable.light('c1', null, { duration: 0.55 }),
        auditTable.setCell('c1', 'evidence', '99.95% monthly uptime', { duration: 0.6 }),
        auditTable.setCell(
          'c1',
          'verdict',
          { value: 'grounded', state: 'pass' },
          { duration: 0.6 },
        ),
        countUp(groundedCounter, 1, { duration: 0.5 }),
      ),
    )
    s.wait(1.2)

    const link2 = answerDoc.link(
      '30-day credit window',
      sourceDoc.span('30-day credit window'),
      { color: 'green', shift: 0 },
    )
    s.play(
      par(
        link2.enter({ duration: 0.85 }),
        answerDoc.mark('30-day credit window', 'supported', { duration: 0.75 }),
        sourceDoc.mark('30-day credit window', 'supported', { duration: 0.75 }),
        auditTable.light('c2', null, { duration: 0.55 }),
        auditTable.setCell('c2', 'evidence', '30-day credit window', { duration: 0.6 }),
        auditTable.setCell(
          'c2',
          'verdict',
          { value: 'grounded', state: 'pass' },
          { duration: 0.6 },
        ),
        countUp(groundedCounter, 2, { duration: 0.5 }),
      ),
    )
    assertEqual(answerDoc.count('supported'), 2, 'first 2 claims grounded')
    s.wait(4.8)

    // =========================================================================
    // Chapter 3: Catch the hallucination
    // =========================================================================
    s.chapter('Catch the hallucination')
    s.caption(
      'When the draft invents free-trial coverage against an enterprise-only rule, the citation snaps.',
      9.6,
    )

    const badLink = answerDoc.link(
      'including free trial accounts',
      sourceDoc.span('paid enterprise plans only'),
      { color: 'orange', shift: 22 },
    )

    s.play(
      par(
        morphMatching(ch2Tag, ch3Tag, { duration: 0.65 }),
        badLink.enter({ duration: 0.85 }),
        auditTable.light('c3', null, { duration: 0.55 }),
        auditTable.setCell('c3', 'evidence', 'paid enterprise plans only', {
          duration: 0.6,
        }),
      ),
    )
    s.wait(0.75)

    // Snap the contradicted link in crimson and flag the hallucination!
    s.play(
      par(
        badLink.break({ color: 'red', duration: 0.75 }),
        answerDoc.mark('including free trial accounts', 'contradicted', {
          duration: 0.75,
        }),
        sourceDoc.mark('paid enterprise plans only', 'contradicted', {
          duration: 0.75,
        }),
        auditTable.setCell(
          'c3',
          'verdict',
          { value: 'contradicted', state: 'fail' },
          { duration: 0.65 },
        ),
        fadeOut(chunkCard, { duration: 0.35 }),
        delay(fadeIn(alertCard, { duration: 0.5 }), 0.42),
      ),
    )
    assertEqual(badLink.broken, true, 'contradicted citation link broken')
    assertEqual(answerDoc.count('contradicted'), 1, '1 contradicted claim flagged')
    s.wait(4.4)

    // =========================================================================
    // Chapter 4: Repair and verify
    // =========================================================================
    s.chapter('Repair and verify')
    s.caption(
      'Diff and accept rewrite the contradicted span to match policy, locking in 3 of 3 grounded claims.',
      11.4,
    )

    s.play(
      par(
        morphMatching(ch3Tag, ch4Tag, { duration: 0.65 }),
        fadeOut(badLink, { duration: 0.45 }),
        answerDoc.mark('including free trial accounts', null, { duration: 0.45 }),
      ),
    )

    s.play(answerDoc.diff(REPAIRED_ANSWER, { duration: 1.55 }))
    s.wait(1.3)
    s.play(answerDoc.accept({ duration: 1.15 }))

    const fixedLink = answerDoc.link(
      'paid enterprise plans',
      sourceDoc.span('paid enterprise plans only'),
      { color: 'green', shift: 22 },
    )

    s.play(
      par(
        fixedLink.enter({ duration: 0.85 }),
        answerDoc.mark('paid enterprise plans', 'supported', { duration: 0.75 }),
        sourceDoc.mark('paid enterprise plans only', 'supported', {
          duration: 0.75,
        }),
        auditTable.setCell(
          'c3',
          'verdict',
          { value: 'grounded', state: 'pass' },
          { duration: 0.65 },
        ),
        auditTable.light(null, null, { duration: 0.45 }),
        countUp(groundedCounter, 3, { duration: 0.55 }),
        fadeOut(alertCard, { duration: 0.35 }),
        delay(fadeIn(verifiedCard, { duration: 0.5 }), 0.42),
      ),
    )
    assertEqual(answerDoc.count('supported'), 3, 'all 3 claims grounded after repair')

    s.play(
      spotlight([answerDoc, auditTable, verifiedCard], {
        keep: [title, ch4Tag, sourceDoc, link1, link2, fixedLink, groundedCounter],
        dim: 0.25,
        duration: 0.85,
      }),
    )
    s.wait(4.6)
    s.play(spotlight(null, { duration: 0.75 }))
    s.wait(3.4)
  },
)
