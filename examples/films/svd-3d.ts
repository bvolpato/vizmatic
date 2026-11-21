import {
  Box,
  type Vec3,
  assertEqual,
  axes3d,
  delay,
  draw,
  fadeIn,
  fadeOut,
  film,
  gridPlane3d,
  infoBox,
  label3d,
  matrix,
  morphMatching,
  par,
  parametricSurface,
  place,
  scene3d,
  sceneKit,
  spotlight,
  tex,
  text,
  vector3d,
  write,
} from 'vizmatic/stage'

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
]

function rotX(a: number): Mat3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ]
}

function rotY(a: number): Mat3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ]
}

function rotZ(a: number): Mat3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ]
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  return [0, 1, 2].map((i) =>
    [0, 1, 2].map(
      (j) =>
        a[i]![0]! * b[0]![j]! +
        a[i]![1]! * b[1]![j]! +
        a[i]![2]! * b[2]![j]!,
    ),
  ) as unknown as Mat3
}

function transposeMat3(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ]
}

function diagMat3(d0: number, d1: number, d2: number): Mat3 {
  return [
    [d0, 0, 0],
    [0, d1, 0],
    [0, 0, d2],
  ]
}

function mulMatVec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}

function det3(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function maxDiffMat3(a: Mat3, b: Mat3): number {
  let err = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      err = Math.max(err, Math.abs(a[i]![j]! - b[i]![j]!))
    }
  }
  return err
}

function fmtEntry(x: number): string {
  const clean = Math.abs(x) < 1e-9 ? 0 : x
  return clean.toFixed(2)
}

// Real SVD has orthogonal factors, which can include reflections:
// https://netlib.org/lapack/lug/node53.html
// Smooth orthogonal rotations parameterized by share in [0, 1].
function makeVt(share: number): Mat3 {
  return mulMat3(rotX(0.46 * share), rotZ(0.68 * share))
}

function makeU(share: number): Mat3 {
  return mulMat3(rotZ(0.54 * share), rotY(-0.58 * share))
}

const SIGMA_1 = 2.1
const SIGMA_2 = 1.2
const SIGMA_3 = 0.55

// The mesh, arrows, and endpoint checks all use this exact transformation.
function animatedMatrix(vtShare: number, sigmaShare: number, uShare: number, collapse: number): Mat3 {
  const d1 = 1 + (SIGMA_1 - 1) * sigmaShare
  const d2 = 1 + (SIGMA_2 - 1) * sigmaShare
  const d3 = (1 + (SIGMA_3 - 1) * sigmaShare) * (1 - collapse)
  return mulMat3(makeU(uShare), mulMat3(diagMat3(d1, d2, d3), makeVt(vtShare)))
}

const IDENTITY_3 = diagMat3(1, 1, 1)
const VT_FULL = makeVt(1)
const V_FULL = transposeMat3(VT_FULL)
const U_FULL = makeU(1)
const UT_FULL = transposeMat3(U_FULL)
const SIGMA_FULL = diagMat3(SIGMA_1, SIGMA_2, SIGMA_3)
const A_FULL = mulMat3(U_FULL, mulMat3(SIGMA_FULL, VT_FULL))
const A_RANK2 = mulMat3(U_FULL, mulMat3(diagMat3(SIGMA_1, SIGMA_2, 0), VT_FULL))

// Right singular vectors v1, v2, v3 (columns of V, i.e. rows of V^T).
const VEC_1: Vec3 = [V_FULL[0][0], V_FULL[1][0], V_FULL[2][0]]
const VEC_2: Vec3 = [V_FULL[0][1], V_FULL[1][1], V_FULL[2][1]]
const VEC_3: Vec3 = [V_FULL[0][2], V_FULL[1][2], V_FULL[2][2]]

// Verify SVD orthogonality, singular values, and rank-collapse determinant at build time.
assertEqual(
  maxDiffMat3(mulMat3(VT_FULL, V_FULL), IDENTITY_3) < 1e-12,
  true,
  'V^T V equals identity within 1e-12',
)
assertEqual(
  maxDiffMat3(mulMat3(UT_FULL, U_FULL), IDENTITY_3) < 1e-12,
  true,
  'U^T U equals identity within 1e-12',
)
const av1 = mulMatVec3(A_FULL, VEC_1)
const su1: Vec3 = [
  SIGMA_1 * U_FULL[0][0],
  SIGMA_1 * U_FULL[1][0],
  SIGMA_1 * U_FULL[2][0],
]
assertEqual(
  Math.hypot(av1[0] - su1[0], av1[1] - su1[1], av1[2] - su1[2]) < 1e-12,
  true,
  'A * v1 equals sigma_1 * u1 within 1e-12',
)
assertEqual(
  Math.abs(det3(A_FULL) - SIGMA_1 * SIGMA_2 * SIGMA_3) < 1e-12,
  true,
  'det(A) equals product of singular values',
)
assertEqual(
  Math.abs(det3(A_RANK2)) < 1e-12,
  true,
  'rank-collapsed matrix has zero 3D volume determinant',
)

const renderedEndpoint = animatedMatrix(1, 1, 1, 1)
assertEqual(maxDiffMat3(renderedEndpoint, A_RANK2) < 1e-12, true, 'rendered endpoint equals the displayed rank-2 operator')
assertEqual(Math.hypot(...mulMatVec3(renderedEndpoint, VEC_3)) < 1e-12, true, 'rendered endpoint annihilates the third singular direction')
assertEqual(Math.abs(det3(renderedEndpoint)) < 1e-12, true, 'rendered endpoint has zero volume')

export default film(
  {
    title: 'SVD: reorient, stretch, reorient',
    description:
      'SVD factors a real matrix as A = U Sigma V^T. Orthogonal factors may rotate or reflect; this 3D example uses rotations and collapses to rank 2 when sigma_3 reaches zero.',
    look: 'chalk',
    font: 'text-serif',
    fps: 60,
    poster: 26.0,
  },
  (s) => {
    const kit = sceneKit({ size: 38, source: { y: -420 } })
    const title = kit.heading('SVD: reorient, stretch, reorient')
    const qualification = kit.source('U and V are orthogonal: rotations or reflections. This example uses rotations.')
    s.add(title, qualification)

    const stageArea = new Box(
      kit.area.left + 8,
      kit.area.top + 2,
      kit.area.right - 8,
      kit.area.bottom - 26,
    )
    const [tagRowBox, mainBox] = stageArea.rows([0.07, 0.93], 12)
    const [left3dPane, rightMathPane] = mainBox.columns([1.14, 0.86], 36)

    const ch1Tag = text('Chapter 1: A sphere of unit vectors', {
      size: 28,
      weight: 600,
      color: 'blue',
    })
    const ch2Tag = text('Chapter 2: First rotation (V^T)', {
      size: 28,
      weight: 600,
      color: 'teal',
    })
    const ch3Tag = text('Chapter 3: Stretch along the axes (Σ)', {
      size: 28,
      weight: 600,
      color: 'yellow',
    })
    const ch4Tag = text('Chapter 4: Second rotation (U) and rank collapse', {
      size: 28,
      weight: 600,
      color: 'orange',
    })
    for (const tag of [ch1Tag, ch2Tag, ch3Tag, ch4Tag]) {
      place(tag, tagRowBox, 'left')
    }
    s.add(ch1Tag.hide())

    // =========================================================================
    // 3D Stage (left pane): reactive matrix M(t) deforming unit sphere + 3 vectors
    // =========================================================================
    const tVt = s.value(0)
    const tSigma = s.value(0)
    const tU = s.value(0)
    const tCollapse = s.value(0)

    const currentMatrix = (): Mat3 =>
      animatedMatrix(tVt.value, tSigma.value, tU.value, tCollapse.value)

    const mapPoint = (p: Vec3): Vec3 => mulMatVec3(currentMatrix(), p)

    const view = scene3d({
      phi: 1.12,
      theta: -0.78,
      distance: 11.8,
      unit: 122,
      fog: 0.28,
      shine: 0.24,
    }).at(left3dPane.cx, left3dPane.cy - 22)

    const floorGrid = gridPlane3d({
      x: [-2.3, 2.3],
      y: [-2.3, 2.3],
      z: -1.45,
      step: 1,
      opacity: 0.42,
    })

    const axes = axes3d({
      x: [-2.35, 2.35],
      y: [-2.35, 2.35],
      z: [-1.5, 1.95],
      numbers: false,
      labelSize: 36,
      width: 2.2,
    })

    const shell = parametricSurface(
      (u, v) => {
        const sx = Math.sin(v) * Math.cos(u)
        const sy = Math.sin(v) * Math.sin(u)
        const sz = Math.cos(v)
        return mapPoint([sx, sy, sz])
      },
      [0, Math.PI * 2],
      [0, Math.PI],
      {
        resolution: [40, 26],
        animate: true,
        colors: ['blue', 'teal', 'yellow'],
        opacity: 0.44,
        mesh: 'ink',
        meshOpacity: 0.2,
        meshWidth: 0.9,
        outwardFrom: [0, 0, 0],
      },
    )

    // A single cover of the exact rank-2 image avoids coincident sphere faces.
    const flatDisc = parametricSurface(
      (angle, radius) => mulMatVec3(U_FULL, [
        SIGMA_1 * radius * Math.cos(angle),
        SIGMA_2 * radius * Math.sin(angle),
        0,
      ]),
      [0, Math.PI * 2],
      [0, 1],
      {
        resolution: [40, 16],
        colors: ['blue', 'teal', 'yellow'],
        opacity: 0.6,
        mesh: 'ink',
        meshOpacity: 0.2,
        meshWidth: 0.9,
        shaded: false,
      },
    )

    const arrow1 = vector3d([0, 0, 0], () => mapPoint(VEC_1), {
      color: 'blue',
      width: 5,
      tip: 24,
      onTop: true,
    })
    const arrow2 = vector3d([0, 0, 0], () => mapPoint(VEC_2), {
      color: 'teal',
      width: 5,
      tip: 24,
      onTop: true,
    })
    const arrow3 = vector3d([0, 0, 0], () => mapPoint(VEC_3), {
      color: 'yellow',
      width: 5,
      tip: 24,
      onTop: true,
    })

    const tipLabel1 = label3d(
      '\\|v_i\\| = 1',
      [-1.95, -1.75, 1.55],
      { size: 34, color: 'blue', offset: [-18, -12] },
    )
    const tipLabelOut = label3d(
      '\\sigma_1 u_1',
      () => {
        const p = mapPoint(VEC_1)
        return [p[0] * 1.18, p[1] * 1.18, p[2] * 1.18]
      },
      { size: 34, color: 'blue', offset: [22, -16] },
    )

    view.add(
      floorGrid.hide(),
      axes.hide(),
      shell.hide(),
      flatDisc.hide(),
      arrow1.hide(),
      arrow2.hide(),
      arrow3.hide(),
      tipLabel1.hide(),
      tipLabelOut.hide(),
    )
    s.add(view)

    // =========================================================================
    // Right-hand Decomposition Panel (equation + 3x3 matrix + singular values)
    // =========================================================================
    const [eqBox, matBox, cardBox] = rightMathPane.rows([0.22, 0.44, 0.34], 16)

    const eqStep1 = tex('x \\;\\mapsto\\; I\\,x', { size: 42, color: 'ink' })
    const eqStep2 = tex('x \\;\\mapsto\\; V^T x', { size: 42, color: 'teal' })
    const eqStep3 = tex('x \\;\\mapsto\\; \\Sigma\\, V^T x', {
      size: 42,
      color: 'yellow',
    })
    const eqStep4 = tex('A\\,x \\;=\\; U\\,\\Sigma\\,V^T x', {
      size: 42,
      color: 'ink',
    })
    for (const eq of [eqStep1, eqStep2, eqStep3, eqStep4]) {
      place(eq, eqBox, 'center')
    }

    const matCaptionI = text('Initial operator: Identity I', {
      size: 27,
      color: 'dim',
    })
    const matCaptionVt = text('Target factor: rotation Vᵀ', {
      size: 27,
      color: 'teal',
    })
    const matCaptionSigma = text('Target factor: Σ = diag(2.10, 1.20, 0.55)', {
      size: 27,
      color: 'yellow',
    })
    const matCaptionA = text('Target composite: A = U Σ Vᵀ', {
      size: 27,
      color: 'orange',
    })

    const opMatrix = matrix(
      [
        ['1.00', '0.00', '0.00'],
        ['0.00', '1.00', '0.00'],
        ['0.00', '0.00', '1.00'],
      ],
      { size: 31, bracket: '[', gapX: 1.15, gapY: 1.28 },
    )

    const [matTitleSlot, matBodySlot] = matBox.rows([0.2, 0.8], 8)
    for (const cap of [matCaptionI, matCaptionVt, matCaptionSigma, matCaptionA]) {
      place(cap, matTitleSlot, 'center')
    }
    place(opMatrix, matBodySlot, 'center')

    const svdCard = infoBox({
      title: 'Target singular values',
      rows: [
        { label: 'σ₁ (blue)', value: '2.10  major stretch', tone: 'blue' },
        { label: 'σ₂ (teal)', value: '1.20  mid stretch', tone: 'teal' },
        { label: 'σ₃ (gold)', value: '0.55  minor axis', tone: 'yellow' },
      ],
      accent: 'blue',
      size: 27,
    })
    place(svdCard, cardBox, 'center')

    const rankCard = infoBox({
      title: 'Rank collapse: σ₃ → 0.00',
      rows: [
        { label: 'final axes', value: '2 of 3  (rank 2)', tone: 'orange' },
        { label: 'image of sphere', value: '2D ellipse disc', tone: 'yellow' },
        { label: '3D volume det(A)', value: '1.39 → 0.00', tone: 'red' },
      ],
      accent: 'orange',
      size: 27,
    })
    place(rankCard, cardBox, 'center')

    s.add(
      eqStep1.hide(),
      matCaptionI.hide(),
      matCaptionVt.hide(),
      matCaptionSigma.hide(),
      matCaptionA.hide(),
      opMatrix.hide(),
      svdCard.hide(),
      rankCard.hide(),
    )

    const setMatrixEntries = (target: Mat3, duration = 0.85) => {
      const anims = []
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          anims.push(opMatrix.setCell(i, j, fmtEntry(target[i]![j]!), { duration }))
        }
      }
      return par(...anims)
    }

    // =========================================================================
    // Chapter 1: A sphere of unit vectors
    // =========================================================================
    s.chapter('A sphere of unit vectors')
    s.caption(
      'Start with all unit vectors in R^3 and three orthogonal right-singular directions.',
      9.4,
    )

    s.play(
      par(
        fadeIn(ch1Tag, { duration: 0.65 }),
        draw(floorGrid, { duration: 0.85 }),
        draw(axes, { duration: 0.95 }),
        write(eqStep1, { duration: 0.85 }),
        fadeIn([matCaptionI, opMatrix, svdCard], { duration: 0.85 }),
      ),
    )
    s.play(
      par(
        fadeIn(shell, { duration: 1.1 }),
        draw(arrow1, { duration: 0.9 }),
        draw(arrow2, { duration: 0.9 }),
        draw(arrow3, { duration: 0.9 }),
        fadeIn(tipLabel1, { duration: 0.85 }),
      ),
    )
    s.play(view.orbit({ theta: -0.52, phi: 1.08 }, { duration: 4.8 }))
    s.wait(2.6)

    // =========================================================================
    // Chapter 2: First rotation (V^T)
    // =========================================================================
    s.chapter('First rotation: V^T')
    s.caption(
      'V^T rotates space rigidly until the three right-singular vectors align with x, y, and z.',
      9.6,
    )

    s.play(
      par(
        morphMatching(ch1Tag, ch2Tag, { duration: 0.65 }),
        morphMatching(eqStep1, eqStep2, { duration: 0.75 }),
        fadeOut(tipLabel1, { duration: 0.4 }),
        fadeOut(matCaptionI, { duration: 0.35 }),
        delay(fadeIn(matCaptionVt, { duration: 0.5 }), 0.42),
        setMatrixEntries(VT_FULL, 0.9),
      ),
    )
    s.play(
      par(
        tVt.to(1, { duration: 4.6 }),
        view.orbit({ theta: -0.74, phi: 1.14 }, { duration: 4.6 }),
      ),
    )
    s.wait(3.0)

    // =========================================================================
    // Chapter 3: Stretch along the axes (Sigma)
    // =========================================================================
    s.chapter('Stretch along the axes: Σ')
    s.caption(
      'Σ scales the aligned x, y, and z axes by (2.10, 1.20, 0.55) into a triaxial ellipsoid.',
      9.8,
    )

    s.play(
      par(
        morphMatching(ch2Tag, ch3Tag, { duration: 0.65 }),
        morphMatching(eqStep2, eqStep3, { duration: 0.75 }),
        fadeOut(matCaptionVt, { duration: 0.35 }),
        delay(fadeIn(matCaptionSigma, { duration: 0.5 }), 0.42),
        setMatrixEntries(SIGMA_FULL, 0.9),
      ),
    )
    s.play(
      par(
        tSigma.to(1, { duration: 4.8 }),
        view.orbit({ theta: -0.96, phi: 1.1 }, { duration: 4.8 }),
      ),
    )
    s.wait(3.0)

    // =========================================================================
    // Chapter 4: Second rotation (U, and rank collapse)
    // =========================================================================
    s.chapter('Second rotation: U, and rank collapse')
    s.caption(
      'U rotates the ellipsoid into A x; driving σ₃ to zero collapses 3D volume onto a 2D ellipse.',
      12.4,
    )

    s.play(
      par(
        morphMatching(ch3Tag, ch4Tag, { duration: 0.65 }),
        morphMatching(eqStep3, eqStep4, { duration: 0.75 }),
        fadeOut(matCaptionSigma, { duration: 0.35 }),
        delay(fadeIn(matCaptionA, { duration: 0.5 }), 0.42),
        setMatrixEntries(A_FULL, 0.9),
      ),
    )
    s.play(
      par(
        tU.to(1, { duration: 3.6 }),
        view.orbit({ theta: -0.64, phi: 1.06 }, { duration: 3.6 }),
        delay(fadeIn(tipLabelOut, { duration: 0.65 }), 2.6),
      ),
    )
    s.wait(1.2)

    // Rank collapse: sigma_3 -> 0 flattens the 3D ellipsoid smoothly onto a tilted 2D disc!
    s.play(
      par(
        fadeOut(svdCard, { duration: 0.4 }),
        delay(fadeIn(rankCard, { duration: 0.55 }), 0.46),
        setMatrixEntries(A_RANK2, 1.1),
        tCollapse.to(1, { duration: 3.6 }),
        view.orbit({ theta: -1.08, phi: 0.96 }, { duration: 3.6 }),
      ),
    )

    s.play(
      par(
        fadeOut(shell, { duration: 0.15 }),
        fadeIn(flatDisc, { duration: 0.15 }),
        spotlight([eqStep4, rankCard], {
        keep: [title, qualification, ch4Tag, view, opMatrix, matCaptionA],
        dim: 0.25,
        duration: 0.85,
        }),
      ),
    )
    s.wait(2.2)
    s.play(spotlight(null, { duration: 0.7 }))
    s.wait(1.8)
  },
)
