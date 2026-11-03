/**
 * The landing page's live laboratory. A one-frame film reads plain variables
 * from a `dynamic` node, so moving a control only needs a repaint.
 */
import {
    arrow, circle, colorAlong, compileFilm, curveThrough, dot, dynamic, film, line, Node, polyPath, text,
    type Vec,
} from 'vizmatic/stage'
import { FilmPlayer } from '../../src/stage/player'

const WIDTH = 1600
const HEIGHT = 1000
const UNIT = 118
const HIT_RADIUS = 56

type Matrix = [number, number, number, number]
type Mode = 'matrix' | 'fourier'
type Shape = 'square' | 'saw' | 'triangle'

interface FilmTheme {
    look: string
    background: string
}

function harmonics(shape: Shape, count: number): { spin: number; radius: number; phase: number }[] {
    const out: { spin: number; radius: number; phase: number }[] = []
    for (let k = 1; k <= count; k++) {
        if (shape === 'square') out.push({ spin: 2 * k - 1, radius: 4 / (Math.PI * (2 * k - 1)), phase: 0 })
        else if (shape === 'saw') out.push({ spin: k, radius: 2 / (Math.PI * k), phase: k % 2 === 0 ? Math.PI : 0 })
        else {
            const odd = 2 * k - 1
            out.push({ spin: odd, radius: 8 / (Math.PI * Math.PI * odd * odd), phase: k % 2 === 0 ? Math.PI : 0 })
        }
    }
    return out
}

export function mountLab(root: HTMLElement, filmTheme: () => FilmTheme): void {
    const canvas = root.querySelector<HTMLCanvasElement>('[data-lab-canvas]')
    if (!canvas) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const matrix: Matrix = [1, 0, 0, 1]
    let mode: Mode = 'matrix'
    let terms = 3
    let shape: Shape = 'square'
    let phase = 0
    let player: FilmPlayer | null = null
    let visible = true
    let spinning = false
    let lastTick = 0
    let animation = 0

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

    function drawFourier(): Node[] {
        const out: Node[] = []
        const radius = 220
        const hub: Vec = [-470, 0]
        const parts = harmonics(shape, terms)
        const value = (angle: number) => parts.reduce((sum, part) => sum + Math.sin(angle * part.spin + part.phase) * part.radius, 0)
        let x = hub[0], y = hub[1]
        out.push(line([-800, 0], [800, 0], { stroke: 'grid', width: 1.5 }))
        for (const part of parts) {
            const r = part.radius * radius
            const a = phase * part.spin + part.phase
            const nx = x + Math.cos(a) * r, ny = y - Math.sin(a) * r
            if (r > 1.2) out.push(circle(r, { stroke: 'blue', width: 1.3, opacity: 0.4 }).at(x, y))
            out.push(line([x, y], [nx, ny], { stroke: 'ink', width: 2 }))
            x = nx
            y = ny
        }
        const start = -120, width = 860
        const points: Vec[] = []
        for (let i = 0; i <= 520; i++) {
            const u = i / 520
            points.push([start + u * width, -value(phase - u * 4 * Math.PI) * radius])
        }
        out.push(line([x, y], points[0]!, { stroke: 'dim', width: 1.5, dash: [5, 7] }))
        out.push(new Node(curveThrough(points)).stroke(colorAlong('yellow', 'orange', 'pink', 'purple'), 4.5))
        out.push(dot(8, 'yellow').at(x, y))
        return out
    }

    const definition = film({ width: WIDTH, height: HEIGHT, title: 'Live laboratory' }, (s) => {
        s.add(dynamic(() => mode === 'matrix' ? drawMatrix() : drawFourier()))
        s.wait(1)
    })

    function repaint(): void {
        player?.seek(0)
    }

    async function compile(): Promise<void> {
        const { look, background } = filmTheme()
        const compiled = await compileFilm(definition, { look: look as 'midnight', background })
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

    let dragging: 'i' | 'j' | null = null
    canvas.addEventListener('pointerdown', (event) => {
        if (mode !== 'matrix') return
        dragging = pickHandle(toStage(event))
        if (dragging) {
            cancelAnimationFrame(animation)
            canvas.setPointerCapture(event.pointerId)
        }
    })
    canvas.addEventListener('pointermove', (event) => {
        if (!dragging) {
            if (mode === 'matrix') canvas.style.cursor = pickHandle(toStage(event)) ? 'grab' : 'default'
            return
        }
        const [x, y] = toStage(event)
        const mx = Math.round((x / UNIT) * 20) / 20, my = Math.round((-y / UNIT) * 20) / 20
        if (dragging === 'i') {
            matrix[0] = mx
            matrix[2] = my
        } else {
            matrix[1] = mx
            matrix[3] = my
        }
        syncReadout()
        repaint()
    })
    const release = () => {
        dragging = null
    }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    // A touch on a handle drags it. A touch anywhere else scrolls the page as usual.
    canvas.addEventListener('touchstart', (event) => {
        if (mode !== 'matrix') return
        const touch = event.touches[0]
        if (touch && pickHandle(toStage(touch))) event.preventDefault()
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

    function spin(now: number): void {
        spinning = visible && mode === 'fourier' && !reduced
        if (!spinning) return
        phase += Math.min(0.05, (now - lastTick) / 1000) * 1.1
        lastTick = now
        repaint()
        requestAnimationFrame(spin)
    }

    function startSpin(): void {
        if (spinning) return
        lastTick = performance.now()
        requestAnimationFrame(spin)
    }

    root.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((tab) => {
        tab.addEventListener('click', () => {
            mode = tab.dataset.labTab as Mode
            root.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((other) => other.setAttribute('aria-selected', String(other === tab)))
            root.querySelectorAll<HTMLElement>('[data-lab-pane]').forEach((pane) => {
                pane.hidden = pane.dataset.labPane !== mode
            })
            canvas!.style.cursor = 'default'
            repaint()
            if (mode === 'fourier') startSpin()
        })
    })

    const slider = root.querySelector<HTMLInputElement>('[data-lab-terms]')
    const sliderOut = root.querySelector('[data-lab-terms-out]')
    slider?.addEventListener('input', () => {
        terms = Number(slider.value)
        if (sliderOut) sliderOut.textContent = String(terms)
        repaint()
    })
    const shapeSelect = root.querySelector<HTMLSelectElement>('[data-lab-shape]')
    shapeSelect?.addEventListener('change', () => {
        shape = shapeSelect.value as Shape
        repaint()
    })

    new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        if (visible && mode === 'fourier') startSpin()
    }).observe(root)

    document.addEventListener('vizmatic-site-theme', () => void compile())
    void compile()
    syncReadout()
}
