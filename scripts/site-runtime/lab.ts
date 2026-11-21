/**
 * The landing page's live laboratory. A one-frame film reads plain variables
 * from a `dynamic` node, so moving a control only needs a repaint.
 */
import {
    arrow, circle, compileFilm, concat, contourPaths, dot, dynamic, film, line, Node, polyPath, ramp, text,
    type Path, type Rgba, type Vec,
} from 'vizmatic/stage'
import { FilmPlayer } from '../../src/stage/player'

const WIDTH = 1600
const HEIGHT = 1000
const UNIT = 118
const HIT_RADIUS = 56

type Matrix = [number, number, number, number]
type Mode = 'matrix' | 'descent'

interface FilmTheme {
    look: string
    background: string
}

// Two-basin loss surface matching examples/films/gradient-descent.ts so visitors can probe the ridge live.
const LOSS_SPAN_X = 3.4
const LOSS_SPAN_Y = 2.6
const DESCENT_STEPS = 72

const bump = (dx: number, dy: number, s: number) => Math.exp(-(dx * dx + dy * dy) / (2 * s * s))
const lossAt = (x: number, y: number): number =>
    1.5 - 1.25 * bump(x - 1.25, y + 0.95, 0.95) - 0.82 * bump(x + 1.45, y - 1.05, 0.8)
    + 0.045 * (x * x + y * y) + 0.1 * Math.sin(1.5 * x + 0.4) * Math.cos(1.3 * y)

function gradientAt(x: number, y: number): Vec {
    const h = 1e-4
    return [
        (lossAt(x + h, y) - lossAt(x - h, y)) / (2 * h),
        (lossAt(x, y + h) - lossAt(x, y - h)) / (2 * h),
    ]
}

function runDescent(x0: number, y0: number, eta: number): { points: Vec[]; diverged: boolean; finalLoss: number } {
    const points: Vec[] = [[x0, y0]]
    let x = x0, y = y0
    let diverged = false
    for (let i = 0; i < DESCENT_STEPS; i++) {
        const [gx, gy] = gradientAt(x, y)
        x -= eta * gx
        y -= eta * gy
        if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 8 || Math.abs(y) > 8) {
            diverged = true
            break
        }
        points.push([x, y])
    }
    const last = points[points.length - 1]!
    return { points, diverged, finalLoss: lossAt(last[0], last[1]) }
}

const domainToStage = (x: number, y: number): Vec => [
    (x / LOSS_SPAN_X) * (WIDTH * 0.46),
    -(y / LOSS_SPAN_Y) * (HEIGHT * 0.45),
]
const stageToDomain = (sx: number, sy: number): Vec => [
    Math.max(-LOSS_SPAN_X, Math.min(LOSS_SPAN_X, (sx / (WIDTH * 0.46)) * LOSS_SPAN_X)),
    Math.max(-LOSS_SPAN_Y, Math.min(LOSS_SPAN_Y, (-sy / (HEIGHT * 0.45)) * LOSS_SPAN_Y)),
]

export function mountLab(root: HTMLElement, filmTheme: () => FilmTheme): void {
    const canvas = root.querySelector<HTMLCanvasElement>('[data-lab-canvas]')
    if (!canvas) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const matrix: Matrix = [1, 0, 0, 1]
    let mode: Mode = 'matrix'
    let startX = 0.75
    let startY = 1.50
    let eta = 0.28
    let player: FilmPlayer | null = null
    let animation = 0
    let pendingRepaint = 0
    let compileSeq = 0

    // Precompute loss contour geometry once; only the stroke colors change with the site theme.
    const contourLevels = Array.from({ length: 16 }, (_, i) => 0.35 + i * 0.13)
    const contourData: { level: number; path: Path }[] = contourPaths(lossAt, {
        x: [-LOSS_SPAN_X, LOSS_SPAN_X],
        y: [-LOSS_SPAN_Y, LOSS_SPAN_Y],
        levels: contourLevels,
        resolution: [76, 58],
    }).map((entry) => ({
        level: entry.level,
        path: concat(...entry.paths.map((pts) => polyPath(pts.map(([x, y]) => domainToStage(x, y))))),
    }))
    let contourColors: readonly Rgba[] = []

    const apply = (x: number, y: number): Vec => {
        const [a, b, c, d] = matrix
        return [(a * x + b * y) * UNIT, -(c * x + d * y) * UNIT]
    }

    function drawMatrix(): Node[] {
        const out: Node[] = []
        const span = 14
        for (let i = -6; i <= 6; i++) out.push(line([i * UNIT, -HEIGHT], [i * UNIT, HEIGHT], { stroke: 'grid', width: 1 }))
        for (let i = -4; i <= 4; i++) out.push(line([-WIDTH, i * UNIT], [WIDTH, i * UNIT], { stroke: 'grid', width: 1 }))
        for (let i = -span; i <= span; i++) {
            const major = i === 0
            out.push(line(apply(i, -span), apply(i, span), { stroke: major ? 'ink' : 'blue', width: major ? 2.4 : 1.5, opacity: major ? 1 : 0.62 }))
            out.push(line(apply(-span, i), apply(span, i), { stroke: major ? 'ink' : 'blue', width: major ? 2.4 : 1.5, opacity: major ? 1 : 0.62 }))
        }
        const det = matrix[0] * matrix[3] - matrix[1] * matrix[2]
        out.push(new Node(polyPath([apply(0, 0), apply(1, 0), apply(1, 1), apply(0, 1)], true)).fill(det < 0 ? 'red' : 'yellow', 0.16).stroke(det < 0 ? 'red' : 'yellow', 1.6, 0.7))
        const iTip = apply(1, 0), jTip = apply(0, 1)
        out.push(arrow([0, 0], iTip, { stroke: 'teal', width: 5, tip: 24 }))
        out.push(arrow([0, 0], jTip, { stroke: 'orange', width: 5, tip: 24 }))
        out.push(circle(15, { stroke: 'teal', width: 1.6, opacity: 0.8 }).at(iTip))
        out.push(circle(15, { stroke: 'orange', width: 1.6, opacity: 0.8 }).at(jTip))
        out.push(text('i', { font: 'serif', italic: true, size: 46, color: 'teal' }).at(iTip[0] + 28, iTip[1] - 24))
        out.push(text('j', { font: 'serif', italic: true, size: 46, color: 'orange' }).at(jTip[0] + 28, jTip[1] - 24))
        return out
    }

    function drawDescent(): Node[] {
        const out: Node[] = []
        // Subtle coordinate crosshairs
        out.push(line([-WIDTH * 0.46, 0], [WIDTH * 0.46, 0], { stroke: 'grid', width: 1.2 }))
        out.push(line([0, -HEIGHT * 0.45], [0, HEIGHT * 0.45], { stroke: 'grid', width: 1.2 }))
        // Precomputed 2-basin contour lines
        contourData.forEach((entry, index) => {
            if (entry.path.length === 0) return
            const color = contourColors[index] ?? 'blue'
            out.push(new Node(entry.path).stroke(color, index % 3 === 0 ? 1.8 : 1.15, index % 3 === 0 ? 0.56 : 0.3))
        })
        // Mark the two basin minima
        const globalMin = domainToStage(1.25, -0.95)
        const localMin = domainToStage(-1.45, 1.05)
        out.push(circle(12, { stroke: 'teal', width: 2, opacity: 0.85 }).at(globalMin))
        out.push(text('global min', { size: 22, color: 'teal' }).at(globalMin[0], globalMin[1] + 28))
        out.push(circle(12, { stroke: 'purple', width: 2, opacity: 0.85 }).at(localMin))
        out.push(text('local min', { size: 22, color: 'purple' }).at(localMin[0], localMin[1] - 28))

        // Primary trajectory + twin start 0.14 away to make the separating ridge palpable
        const runA = runDescent(startX, startY, eta)
        const runB = runDescent(Math.max(-LOSS_SPAN_X, startX - 0.14), startY, eta)
        const stageA = runA.points.map(([x, y]) => domainToStage(x, y))
        const stageB = runB.points.map(([x, y]) => domainToStage(x, y))
        if (stageB.length > 1) {
            out.push(new Node(polyPath(stageB)).stroke('pink', 3.2, 0.82))
            for (let i = 1; i < stageB.length; i += 3) out.push(dot(4, 'pink').opacity(0.65).at(stageB[i]!))
            out.push(dot(8, 'pink').at(stageB[stageB.length - 1]!))
        }
        if (stageA.length > 1) {
            out.push(new Node(polyPath(stageA)).stroke('orange', 4.4).glow(6))
            for (let i = 1; i < stageA.length; i += 3) out.push(dot(5, 'yellow').opacity(0.8).at(stageA[i]!))
            out.push(dot(10, 'yellow').glow(10).at(stageA[stageA.length - 1]!))
        }
        const handleA = stageA[0]!
        const handleB = stageB[0]!
        out.push(circle(17, { stroke: 'orange', width: 2, opacity: 0.9 }).at(handleA))
        out.push(dot(8, 'orange').at(handleA))
        out.push(dot(5.5, 'pink').opacity(0.85).at(handleB))
        return out
    }

    const definition = film({ width: WIDTH, height: HEIGHT, title: 'Live laboratory' }, (s) => {
        contourColors = ramp(contourData.length, 'teal', 'blue', 'purple', 'orange')
        s.add(dynamic(() => mode === 'matrix' ? drawMatrix() : drawDescent()))
        s.wait(1)
    })

    function repaint(): void {
        player?.seek(0)
    }

    function scheduleRepaint(): void {
        if (pendingRepaint) return
        pendingRepaint = requestAnimationFrame(() => {
            pendingRepaint = 0
            repaint()
        })
    }

    async function compile(): Promise<void> {
        const seq = ++compileSeq
        const { look, background } = filmTheme()
        const compiled = await compileFilm(definition, { look: look as 'midnight', background })
        if (seq !== compileSeq) return
        player?.destroy()
        player = new FilmPlayer(canvas!, compiled)
        repaint()
    }

    function syncReadout(): void {
        const [a, b, c, d] = matrix
        const set = (name: string, value: number) => {
            const cell = root.querySelector(`[data-m="${name}"]`)
            if (cell) cell.textContent = value.toFixed(2)
        }
        set('a', a)
        set('b', b)
        set('c', c)
        set('d', d)
        const det = root.querySelector('[data-lab-det]')
        if (det) det.textContent = (a * d - b * c).toFixed(2)
        const trace = root.querySelector('[data-lab-trace]')
        if (trace) trace.textContent = (a + d).toFixed(2)

        const startEl = root.querySelector('[data-lab-start]')
        if (startEl) startEl.textContent = `${startX.toFixed(2)}, ${startY.toFixed(2)}`
        const runA = runDescent(startX, startY, eta)
        const runB = runDescent(Math.max(-LOSS_SPAN_X, startX - 0.14), startY, eta)
        const lossEl = root.querySelector('[data-lab-loss]')
        if (lossEl) lossEl.textContent = runA.diverged ? 'diverged' : runA.finalLoss.toFixed(3)
        const outcomeEl = root.querySelector('[data-lab-outcome]')
        if (outcomeEl) {
            const endA = runA.points[runA.points.length - 1]!
            const endB = runB.points[runB.points.length - 1]!
            if (runA.diverged) outcomeEl.textContent = 'Overshot (η too high)'
            else if (!runB.diverged && (endA[0] > 0) !== (endB[0] > 0)) outcomeEl.textContent = 'Basin split!'
            else outcomeEl.textContent = endA[0] > 0 ? 'Global minimum' : 'Local minimum'
        }
    }

    function toStage(event: PointerEvent | Touch): Vec {
        const rect = canvas!.getBoundingClientRect()
        return [
            ((event.clientX - rect.left) / rect.width - 0.5) * WIDTH,
            ((event.clientY - rect.top) / rect.height - 0.5) * HEIGHT,
        ]
    }

    function pickHandle(point: Vec): 'i' | 'j' | null {
        const i = apply(1, 0), j = apply(0, 1)
        const di = Math.hypot(point[0] - i[0], point[1] - i[1]), dj = Math.hypot(point[0] - j[0], point[1] - j[1])
        if (Math.min(di, dj) > HIT_RADIUS) return null
        return di <= dj ? 'i' : 'j'
    }

    let dragging: 'i' | 'j' | 'descent' | null = null
    canvas.addEventListener('pointerdown', (event) => {
        if (mode === 'matrix') {
            dragging = pickHandle(toStage(event))
            if (dragging) {
                cancelAnimationFrame(animation)
                canvas.setPointerCapture(event.pointerId)
            }
            return
        }
        cancelAnimationFrame(animation)
        dragging = 'descent'
        canvas.setPointerCapture(event.pointerId)
        const [sx, sy] = toStage(event)
        const [dx, dy] = stageToDomain(sx, sy)
        startX = dx
        startY = dy
        syncReadout()
        scheduleRepaint()
    })
    canvas.addEventListener('pointermove', (event) => {
        if (!dragging) {
            if (mode === 'matrix') canvas.style.cursor = pickHandle(toStage(event)) ? 'grab' : 'default'
            else canvas.style.cursor = 'crosshair'
            return
        }
        const [x, y] = toStage(event)
        if (dragging === 'descent') {
            const [dx, dy] = stageToDomain(x, y)
            startX = dx
            startY = dy
        } else {
            const mx = Math.round((x / UNIT) * 20) / 20, my = Math.round((-y / UNIT) * 20) / 20
            if (dragging === 'i') {
                matrix[0] = mx
                matrix[2] = my
            } else {
                matrix[1] = mx
                matrix[3] = my
            }
        }
        syncReadout()
        scheduleRepaint()
    })
    const release = () => {
        dragging = null
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('lostpointercapture', release)
    // A touch on a handle drags it. A touch anywhere else scrolls the page as usual.
    canvas.addEventListener('touchstart', (event) => {
        const touch = event.touches[0]
        if (!touch) return
        if (mode === 'descent' || pickHandle(toStage(touch))) event.preventDefault()
    }, { passive: false })

    function animateTo(target: Matrix): void {
        cancelAnimationFrame(animation)
        if (reduced) {
            matrix.splice(0, 4, ...target)
            syncReadout()
            repaint()
            return
        }
        const from = [...matrix]
        const started = performance.now()
        const step = (now: number) => {
            const t = Math.min(1, (now - started) / 750)
            const eased = t * t * t * (t * (t * 6 - 15) + 10)
            for (let i = 0; i < 4; i++) matrix[i] = from[i]! + (target[i]! - from[i]!) * eased
            syncReadout()
            repaint()
            if (t < 1) animation = requestAnimationFrame(step)
        }
        animation = requestAnimationFrame(step)
    }

    root.querySelectorAll<HTMLButtonElement>('[data-lab-preset]').forEach((button) => {
        button.addEventListener('click', () => animateTo(button.dataset.labPreset!.split(',').map(Number) as Matrix))
    })

    const etaSlider = root.querySelector<HTMLInputElement>('[data-lab-eta]')
    const etaOut = root.querySelector('[data-lab-eta-out]')
    etaSlider?.addEventListener('input', () => {
        eta = Number(etaSlider.value)
        if (etaOut) etaOut.textContent = eta.toFixed(2)
        syncReadout()
        scheduleRepaint()
    })

    root.querySelectorAll<HTMLButtonElement>('[data-lab-descent]').forEach((button) => {
        button.addEventListener('click', () => {
            const [x, y, step] = button.dataset.labDescent!.split(',').map(Number)
            startX = x ?? 0.75
            startY = y ?? 1.50
            eta = step ?? 0.28
            if (etaSlider) etaSlider.value = String(eta)
            if (etaOut) etaOut.textContent = eta.toFixed(2)
            syncReadout()
            repaint()
        })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
            mode = tab.dataset.labTab as Mode
            root.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((other) => other.setAttribute('aria-selected', String(other === tab)))
            root.querySelectorAll<HTMLElement>('[data-lab-pane]').forEach((pane) => {
                pane.hidden = pane.dataset.labPane !== mode
            })
            canvas!.style.cursor = mode === 'descent' ? 'crosshair' : 'default'
            syncReadout()
            repaint()
        })
    })

    document.addEventListener('vizmatic-site-theme', () => void compile())
    void compile()
    syncReadout()
}
