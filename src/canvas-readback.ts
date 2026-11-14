// Only these synchronous, value-based 2D operations can reuse a readback.
const calls = new Set(['arc', 'beginPath', 'clearRect', 'clip', 'closePath', 'fill', 'fillRect',
    'fillText', 'lineTo', 'moveTo', 'restore', 'roundRect', 'save', 'scale', 'setLineDash', 'stroke'])
const settings = new Set(['fillStyle', 'font', 'lineCap', 'lineJoin', 'lineWidth', 'strokeStyle', 'textAlign', 'textBaseline'])
const assign = Symbol('assign'), invoke = Symbol('invoke'), dash = Symbol('dash')
type Scalar = string | boolean | number
const scalar = (v: unknown): v is Scalar => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))

/**
 * Draw on an exclusively owned, fixed-size native context with a stable font registry.
 * The callback uses ordinary method and property access on its supplied context.
 * Native drawing, exceptions and queries always run. Untracked state disables reuse.
 * readPixels returns an owned snapshot after drawing. The returned pixels are borrowed
 * read-only until the next frame, as required by a serial video encoder.
 */
export function createCanvasReadback<C extends { reset(): void }>(context: C, readPixels: () => Uint8Array) {
    let available = true, active = false, tape: unknown[] = [], previous: unknown[] | undefined
    let pixels: Uint8Array | undefined, reused = 0, frames = 0
    const methods = new Map<string, { raw: (...args: unknown[]) => unknown; wrapped: (...args: unknown[]) => unknown }>()
    const disable = () => { available = false; previous = undefined; pixels = undefined }
    const observed = new Proxy(context, {
        get(target, key) {
            if (!active || typeof key !== 'string' || !calls.has(key)) disable()
            let value: unknown
            try { value = Reflect.get(target, key, target) }
            catch (error) { disable(); throw error }
            if (typeof value === 'function') {
                const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
                if (descriptor && !descriptor.configurable && 'value' in descriptor && !descriptor.writable) {
                    disable()
                    return value
                }
            }
            if (typeof key !== 'string' || !calls.has(key) || typeof value !== 'function') {
                disable()
                return typeof value === 'function' ? value.bind(target) : value
            }
            const fn = value as (...args: unknown[]) => unknown
            let cached = methods.get(key)
            if (!cached || cached.raw !== fn) {
                if (cached) disable()
                const wrapped = (...args: unknown[]) => {
                    if (!available) return Reflect.apply(fn, target, args)
                    // A dash array can change after the call. Record Canvas's accepted copy.
                    const isDash = key === 'setLineDash' && args.length === 1
                    if (!active || (!isDash && !args.every(scalar))) disable()
                    try {
                        const result: unknown = Reflect.apply(fn, target, args)
                        if (available && isDash) {
                            const readDash: unknown = Reflect.get(target, 'getLineDash', target)
                            if (typeof readDash !== 'function') disable()
                            else {
                                const segments: unknown = Reflect.apply(readDash, target, [])
                                if (Array.isArray(segments) && segments.every(scalar)) tape.push(dash, segments.length, ...segments)
                                else disable()
                            }
                        } else if (available) tape.push(invoke, key, args.length, ...args)
                        return result
                    } catch (error) {
                        disable()
                        throw error
                    }
                }
                cached = { raw: fn, wrapped }
                methods.set(key, cached)
            }
            return cached.wrapped
        },
        set(target, key, value: unknown) {
            if (!active || typeof key !== 'string' || !settings.has(key) || !scalar(value)) disable()
            let accepted: boolean
            try { accepted = Reflect.set(target, key, value, target) }
            catch (error) { disable(); throw error }
            if (!accepted) disable()
            else if (available) tape.push(assign, key, value)
            return accepted
        },
        defineProperty(target, key, descriptor) { disable(); return Reflect.defineProperty(target, key, descriptor) },
        deleteProperty(target, key) { disable(); return Reflect.deleteProperty(target, key) },
        getOwnPropertyDescriptor(target, key) { disable(); return Reflect.getOwnPropertyDescriptor(target, key) },
        getPrototypeOf(target) { disable(); return Reflect.getPrototypeOf(target) },
        setPrototypeOf(target, proto) { disable(); return Reflect.setPrototypeOf(target, proto) },
    })
    return {
        frame(draw: (context: C) => void): Uint8Array {
            if (active) throw new Error('Canvas readback is already drawing a frame')
            tape = []
            active = true
            try {
                context.reset()
                const result: unknown = draw(observed)
                if (result && typeof (result as PromiseLike<unknown>).then === 'function') throw new TypeError('Canvas drawing must be synchronous')
                if (available && previous && pixels && tape.length === previous.length
                    && tape.every((v, i) => Object.is(v, previous![i]))) {
                    frames++
                    reused++
                    return pixels
                }
                const next = readPixels()
                frames++
                if (available) {
                    pixels = next
                    previous = tape
                }
                return next
            } catch (error) {
                disable()
                throw error
            } finally {
                tape = []
                active = false
            }
        },
        stats: () => ({ frames, reused, tracking: available }),
    }
}
