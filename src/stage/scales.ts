/** Axis transforms. A log domain is positive; symlog is linear near zero and logarithmic in both tails. */
export type AxisScale = 'linear' | 'log' | 'symlog'
    | { type: 'linear' }
    | { type: 'log'; base?: number }
    | { type: 'symlog'; constant?: number }

/** Internal normalized mapping shared by coordinates, ticks, and sampling. */
export interface ScaleMapping {
    readonly domain: readonly [number, number]
    readonly type: 'linear' | 'log' | 'symlog'
    map(value: number): number
    invert(position: number): number
    ticks(step?: number): number[]
}

export function scaleMapping(domain: readonly [number, number], spec: AxisScale = 'linear', name = 'axis'): ScaleMapping {
    const type = typeof spec === 'string' ? spec : spec?.type
    if (!['linear', 'log', 'symlog'].includes(type)) throw new Error(`${name}: scale must be linear, log, or symlog`)
    const [low, high] = domain
    if (domain.length !== 2 || !Number.isFinite(low) || !Number.isFinite(high) || !(high > low) || !Number.isFinite(high - low)) {
        throw new Error(`${name}: domain must have two finite increasing ends with a finite span`)
    }
    const base = typeof spec === 'object' && spec.type === 'log' ? spec.base ?? 10 : 10
    const constant = typeof spec === 'object' && spec.type === 'symlog' ? spec.constant ?? 1 : 1
    if (!(base > 1) || !Number.isFinite(base)) throw new Error(`${name}: log base must be finite and greater than 1`)
    if (!(constant > 0) || !Number.isFinite(constant)) throw new Error(`${name}: symlog constant must be finite and greater than 0`)
    if (type === 'log' && !(low > 0)) throw new Error(`${name}: a log domain must be positive`)
    const transform = type === 'linear' ? (v: number) => v
        : type === 'log' ? (v: number) => v > 0 ? Math.log(v) : NaN
        : (v: number) => Math.sign(v) * (Number.isFinite(Math.abs(v) / constant) ? Math.log1p(Math.abs(v) / constant) : Math.log(Math.abs(v)) - Math.log(constant))
    const inverse = type === 'linear' ? (v: number) => v
        : type === 'log' ? Math.exp
        : (v: number) => Math.sign(v) * (Math.abs(v) < 700 ? Math.expm1(Math.abs(v)) * constant : Math.exp(Math.abs(v) + Math.log(constant)))
    // Relative logarithms retain small differences on a large offset. Log
    // subtraction is safer when the ratio overflows or approaches -1.
    const logDistance = (value: number): number => {
        if (!(value > 0)) return NaN
        const relative = (value - low) / low
        return Number.isFinite(relative) && relative > -0.5 ? Math.log1p(relative) : Math.log(value) - Math.log(low)
    }
    const start = transform(low)
    const distance = (value: number): number => {
        if (type === 'log') return logDistance(value)
        if (type === 'symlog' && value === 0) return -start
        if (type === 'symlog' && ((low >= 0 && value >= 0) || (low <= 0 && value <= 0))) {
            const origin = Math.abs(low), delta = Math.abs(value) - origin, sum = constant + origin
            const relative = Number.isFinite(sum) ? delta / sum : (delta / constant) / (1 + origin / constant)
            if (Number.isFinite(relative) && relative > -0.5) return (low < 0 || value < 0 ? -1 : 1) * Math.log1p(relative)
        }
        return transform(value) - start
    }
    const span = distance(high)
    if (!(span > 0) || !Number.isFinite(span)) throw new Error(`${name}: the transformed domain must have a finite positive span`)
    return {
        domain: [low, high], type,
        map: (v) => distance(v) / span,
        invert: (t) => {
            if (t === 0) return low
            if (t === 1) return high
            const offset = t * span
            if (type === 'log' && Math.abs(offset) < 1) return low + low * Math.expm1(offset)
            if (type === 'symlog' && Math.abs(offset) < 1 && Math.sign(start + offset) === Math.sign(start)) {
                const sign = low < 0 ? -1 : 1, delta = Math.expm1(sign * offset)
                return low + sign * (constant * delta + Math.abs(low) * delta)
            }
            return inverse(start + offset)
        },
        ticks: (step) => {
            if (step !== undefined || type === 'linear') return linearTicks(domain, step, name)
            if (type === 'log') return logTicks(domain, base)
            // Use ordinary linear ticks near zero and signed powers in the tails.
            if (Math.max(Math.abs(low), Math.abs(high)) <= 2 * constant) return linearTicks(domain, undefined, name)
            const values = [0]
            for (const sign of [-1, 1]) {
                const max = sign < 0 ? -low : high
                if (max < constant) continue
                const min = Math.max(constant, sign < 0 ? -high : low)
                values.push(...logTicks([min, max], 10).map((v) => sign * v))
            }
            values.push(...linearTicks([-constant, constant]).filter((v) => v !== 0))
            const candidates = [...new Set(values)].filter((v) => v >= low && v <= high).sort((a, b) => a - b)
            const selected: number[] = []
            // Keep the tails and zero legible even when many decades squeeze the linear center.
            for (const v of [candidates[0], candidates.at(-1)!, ...[...candidates].sort((a, b) => Math.abs(a) - Math.abs(b))]) {
                if (v !== undefined && selected.every((other) => Math.abs(distance(v) - distance(other)) / span >= 0.075)) selected.push(v)
            }
            return selected.sort((a, b) => a - b)
        },
    }
}

/** The established axes spacing: about eight intervals, in steps of 1, 2, or 5. */
export function niceStep(span: number): number {
    const rough = span / 8
    const power = 10 ** Math.floor(Math.log10(rough))
    if (power === 0) return Number.MIN_VALUE
    const unit = rough / power
    return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power
}

function linearTicks([low, high]: readonly [number, number], step = niceStep(high - low), name = 'axis'): number[] {
    if (!(step > 0) || !Number.isFinite(step)) throw new Error(`${name}: tick step must be finite and greater than 0`)
    const first = Math.ceil(low / step - 1e-9), last = Math.floor(high / step + 1e-9)
    const count = last - first + 1
    if (!Number.isFinite(count) || count > 10000) throw new Error(`${name}: too many ticks; give a larger step`)
    const values = Array.from({ length: Math.max(0, count) }, (_, i) => {
        const value = (first + i) * step, rounded = Number(value.toPrecision(15))
        return Math.abs(value - rounded) < step * 1e-6 ? rounded : value
    })
    return [...new Set(values)].filter((v) => Number.isFinite(v) && v >= low && v <= high)
}

function logTicks([low, high]: readonly [number, number], base: number): number[] {
    if (low === high) return [low]
    const start = Math.log(low) / Math.log(base), end = Math.log(high) / Math.log(base)
    const stride = Math.max(1, Math.ceil((end - start) / 8))
    // Subdecades get 1, 2, 5 labels. Wide domains keep powers only.
    const factors = base === 10 && end - start < 2 ? [1, 2, 5] : [1]
    const values: number[] = []
    for (let e = Math.floor(start / stride) * stride; e <= Math.ceil(end); e += stride) {
        for (const factor of factors) {
            const v = Number((factor * base ** e).toPrecision(15))
            if (v >= low && v <= high && Number.isFinite(v)) values.push(v)
        }
    }
    return values.length >= 2 ? values : linearTicks([low, high])
}

/** TeX tick labels preserve small nonzero values and omit floating-point accumulation noise. */
export function formatAxisTick(value: number, step?: number): string {
    if (value === 0) return '0'
    const digits = step && step > 0 ? Math.floor(Math.log10(Math.abs(value))) - Math.floor(Math.log10(step)) + 1 : 12
    const clean = Number(value.toPrecision(Math.min(17, Math.max(12, digits))))
    if (Math.abs(clean) >= 1e6 || Math.abs(clean) < 1e-3) {
        const [coefficient, exponent] = clean.toExponential().split('e')
        return `${coefficient}\\times 10^{${Number(exponent)}}`
    }
    return String(clean)
}
