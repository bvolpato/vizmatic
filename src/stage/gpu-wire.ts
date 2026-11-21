import type { Frame } from './display'

/** Private transport: keep path coordinates and generated images in binary, not JSON number arrays. */
export interface GpuFrameJob {
    frames: readonly Frame[]
    width: number
    height: number
    dither: boolean
}

export interface GpuFilmJob extends Omit<GpuFrameJob, 'frames'> { times: readonly number[] }
export type GpuJob = GpuFrameJob | GpuFilmJob

const align = (size: number) => Math.ceil(size / 8) * 8

export function encodeGpuJob(job: GpuJob): Uint8Array {
    const arrays: ArrayBufferView[] = []
    const ids = new Map<ArrayBufferView, number>()
    const json = new TextEncoder().encode(JSON.stringify(job, function (key, value) {
        if (key === 'node') return undefined
        // Avoid duplicating multi-MB base64 data URIs on both image.src and image.asset.src.
        if (key === 'asset' && value && typeof value === 'object' && typeof value.src === 'string' && this?.src === value.src) {
            return { ...value, src: { $sameSrc: true } }
        }
        if (!(value instanceof Float64Array) && !(value instanceof Uint8ClampedArray)) return value
        let id = ids.get(value)
        if (id === undefined) { id = arrays.length; ids.set(value, id); arrays.push(value) }
        return { $array: id, type: value instanceof Float64Array ? 'f64' : 'u8', length: value.length }
    }))
    const header = align(8 + json.length)
    const bytes = new Uint8Array(header + arrays.reduce((sum, array) => sum + align(array.byteLength), 0))
    const view = new DataView(bytes.buffer)
    view.setUint32(0, json.length, true)
    view.setUint32(4, arrays.length, true)
    bytes.set(json, 8)
    let at = header
    for (const array of arrays) {
        bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), at)
        at += align(array.byteLength)
    }
    return bytes
}

export function decodeGpuJob(buffer: ArrayBuffer): GpuJob {
    if (buffer.byteLength < 8) throw new Error('Truncated GPU frame packet')
    const view = new DataView(buffer)
    const jsonLength = view.getUint32(0, true), count = view.getUint32(4, true)
    let at = align(8 + jsonLength)
    if (at > buffer.byteLength) throw new Error('Truncated GPU frame metadata')
    const arrays: (Float64Array | Uint8ClampedArray)[] = []
    const result = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonLength)), (_key, value) => {
        if (value && typeof value === 'object' && value.asset && typeof value.asset === 'object'
            && value.asset.src && typeof value.asset.src === 'object' && value.asset.src.$sameSrc === true && typeof value.src === 'string') {
            value.asset.src = value.src
        }
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, '$array')) return value
        const { $array: id, type, length } = value
        if (!Number.isSafeInteger(id) || id < 0 || id >= count || !Number.isSafeInteger(length) || length < 0
            || (type !== 'f64' && type !== 'u8')) throw new Error('Invalid GPU frame array')
        const existing = arrays[id]
        if (existing) {
            if (existing.length !== length || (existing instanceof Float64Array) !== (type === 'f64'))
                throw new Error('Invalid GPU frame array')
            return existing
        }
        const size = length * (type === 'f64' ? 8 : 1)
        if (id !== arrays.length || at + size > buffer.byteLength) throw new Error('Truncated GPU frame array')
        const array = type === 'f64' ? new Float64Array(buffer, at, length) : new Uint8ClampedArray(buffer, at, length)
        arrays.push(array)
        at += align(size)
        return array
    }) as GpuJob
    if (arrays.length !== count || at !== buffer.byteLength) throw new Error('Invalid GPU frame packet length')
    return result
}
