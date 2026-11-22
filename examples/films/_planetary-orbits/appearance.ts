import { parametricSurface, type Rgba, type Vec3 } from 'vizmatic/stage'

export const COLORS = ['#b8b1a7', '#e5c68c', '#62b8ed', '#dd8566', '#e4b482', '#dbc999', '#8ad9d8', '#739cf2']
export const RADII = [0.075, 0.12, 0.135, 0.1, 0.30, 0.25, 0.19, 0.185]
export const SPACING = [1.15, 1.7, 2.3, 2.95, 4.3, 5.6, 6.9, 8.1]
const TAU = Math.PI * 2
const tilt = 26.7 * Math.PI / 180

const rotate = ([x, y, z]: Vec3, angle: number): Vec3 => [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)]
const mix = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]

const PLANET_RES: readonly (readonly [number, number])[] = [
    [16, 10], // Mercury
    [22, 12], // Venus
    [22, 12], // Earth
    [16, 10], // Mars
    [28, 16], // Jupiter
    [28, 16], // Saturn
    [22, 12], // Uranus
    [22, 12], // Neptune
]

interface SphereTemplate {
    readonly res: readonly [number, number]
    readonly ux: Float64Array
    readonly uy: Float64Array
    readonly uz: Float64Array
    readonly nx: Float64Array
    readonly ny: Float64Array
    readonly nz: Float64Array
    readonly lon: Float64Array
    readonly lat: Float64Array
}

// Precompute rotated unit-sphere grids and unit normals once per planet to avoid
// redundant trig and vector allocations on every animation frame.
const SPHERE_TEMPLATES: readonly SphereTemplate[] = PLANET_RES.map(([nu, nv], index) => {
    const angle = index === 5 ? tilt : index === 2 ? 0.41 : 0.08
    const flatten = index === 5 ? 0.902 : index === 4 ? 0.935 : 1
    const vCount = (nu + 1) * (nv + 1)
    const ux = new Float64Array(vCount), uy = new Float64Array(vCount), uz = new Float64Array(vCount)
    for (let iu = 0; iu <= nu; iu++) {
        const u = (iu / nu) * TAU
        const cu = Math.cos(u), su = Math.sin(u)
        for (let iv = 0; iv <= nv; iv++) {
            const v = -Math.PI / 2 + (iv / nv) * Math.PI
            const cv = Math.cos(v), sv = Math.sin(v)
            const [rx, ry, rz] = rotate([cv * cu, cv * su, flatten * sv], angle)
            const k = iu * (nv + 1) + iv
            ux[k] = rx; uy[k] = ry; uz[k] = rz
        }
    }
    const qCount = nu * nv
    const nx = new Float64Array(qCount), ny = new Float64Array(qCount), nz = new Float64Array(qCount)
    const lon = new Float64Array(qCount), lat = new Float64Array(qCount)
    for (let iu = 0; iu < nu; iu++) {
        const longitude = ((iu + 0.5) / nu) * TAU
        const cl = Math.cos(longitude), sl = Math.sin(longitude)
        for (let iv = 0; iv < nv; iv++) {
            const latitude = ((iv + 0.5) / nv - 0.5) * Math.PI
            const cp = Math.cos(latitude), sp = Math.sin(latitude)
            const [rx, ry, rz] = rotate([cp * cl, cp * sl, sp / flatten], angle)
            const len = Math.hypot(rx, ry, rz) || 1
            const k = iu * nv + iv
            nx[k] = rx / len; ny[k] = ry / len; nz[k] = rz / len
            lon[k] = longitude; lat[k] = latitude
        }
    }
    return { res: [nu, nv], ux, uy, uz, nx, ny, nz, lon, lat }
})

const RING_BANDS: readonly (readonly [number, number, number])[] = [
    [1.24, 1.53, 0.52],
    [1.53, 1.95, 0.91],
    [2.03, 2.27, 0.74],
]
const RING_NU = 56
const RING_NV = 2
const RING_TEMPLATES = RING_BANDS.map(([inner, outer, brightness]) => {
    const count = (RING_NU + 1) * (RING_NV + 1)
    const ux = new Float64Array(count), uy = new Float64Array(count), uz = new Float64Array(count)
    for (let iu = 0; iu <= RING_NU; iu++) {
        const a = (iu / RING_NU) * TAU
        const ca = Math.cos(a), sa = Math.sin(a)
        for (let iv = 0; iv <= RING_NV; iv++) {
            const r = inner + (outer - inner) * (iv / RING_NV)
            const [rx, ry, rz] = rotate([r * ca, r * sa, 0], tilt)
            const k = iu * (RING_NV + 1) + iv
            ux[k] = rx; uy[k] = ry; uz[k] = rz
        }
    }
    return { inner, outer, brightness, ux, uy, uz }
})

// Procedural colors suggest clouds and rock. They are not planetary imagery.
function surfaceColor(index: number, longitude: number, latitude: number): Vec3 {
    const bands = Math.sin(latitude * 38 + 0.8 * Math.sin(longitude * 5))
    const detail = Math.sin(longitude * 17 + latitude * 12) * Math.sin(latitude * 29 - longitude * 7)
    if (index === 4) return mix([141, 87, 59], [240, 217, 178], 0.52 + 0.32 * bands + 0.08 * detail)
    if (index === 5) return mix([172, 144, 95], [243, 223, 174], 0.62 + 0.12 * Math.sin(latitude * 16) + 0.015 * detail)
    if (index === 2) {
        const land = Math.sin(longitude * 3 + 1.4 * Math.sin(latitude * 4)) + Math.cos(latitude * 6 - longitude * 2)
        const base = land > 0.72 ? [92, 139, 106] as const : [39, 118, 190] as const
        const cloud = Math.max(0, Math.sin(longitude * 8 + latitude * 13) * Math.sin(latitude * 9 - longitude * 2) - 0.5)
        return mix(base, [221, 236, 235], Math.abs(latitude) > 1.3 ? 0.85 : cloud)
    }
    const bases: Vec3[] = [[159, 151, 141], [220, 181, 112], [50, 130, 195], [191, 98, 65], [220, 175, 130], [221, 197, 149], [119, 205, 207], [66, 117, 206]]
    return mix(bases[index], [245, 235, 212], (index < 4 ? 0.11 : 0.05) * (1 + detail))
}

export function planetSurface(index: number, center: Vec3, radius: number, light: Vec3, spin: number) {
    const tpl = SPHERE_TEMPLATES[index]!
    const [nu, nv] = tpl.res
    const length = Math.hypot(light[0], light[1], light[2]) || 1
    const lx = light[0] / length, ly = light[1] / length, lz = light[2] / length
    const cx = center[0], cy = center[1], cz = center[2]
    let vIdx = 0
    let qIdx = 0
    return parametricSurface(() => {
        const k = vIdx++
        return [cx + radius * tpl.ux[k]!, cy + radius * tpl.uy[k]!, cz + radius * tpl.uz[k]!]
    }, [0, TAU], [-Math.PI / 2, Math.PI / 2], {
        resolution: [nu, nv], outwardFrom: center, cull: true, shaded: false,
        colorAt: (): Rgba => {
            const k = qIdx++
            const dot = tpl.nx[k]! * lx + tpl.ny[k]! * ly + tpl.nz[k]! * lz
            const illumination = 0.12 + 0.88 * Math.max(0, dot)
            const rgb = surfaceColor(index, tpl.lon[k]! + spin, tpl.lat[k]!)
            return [rgb[0] * illumination, rgb[1] * illumination, rgb[2] * illumination, 1]
        },
    })
}

export function saturnRings(center: Vec3, radius: number, light: Vec3, camera: Vec3) {
    const length = Math.hypot(light[0], light[1], light[2]) || 1
    const lx = light[0] / length, ly = light[1] / length, lz = light[2] / length
    const facing = -Math.sin(tilt) * camera[1] + Math.cos(tilt) * camera[2] >= 0 ? 1 : -1
    const incidence = facing * (-Math.sin(tilt) * ly + Math.cos(tilt) * lz)
    const illumination = 0.22 + 0.78 * Math.max(0, incidence)
    const cx = center[0], cy = center[1], cz = center[2]
    const r2 = radius * radius
    // The three annuli leave the Cassini division visibly open. Ring colors and
    // opacity are illustrative; the shadow is the sphere's geometric shadow.
    return RING_TEMPLATES.map((tpl) => {
        let vIdx = 0
        return parametricSurface(() => {
            const k = vIdx++
            return [cx + radius * tpl.ux[k]!, cy + radius * tpl.uy[k]!, cz + radius * tpl.uz[k]!]
        }, [0, TAU], [tpl.inner, tpl.outer], {
            resolution: [RING_NU, RING_NV], shaded: false,
            colorAt: (x, y, z, _u, v): Rgba => {
                const px = x - cx, py = y - cy, pz = z - cz
                const towardLight = px * lx + py * ly + pz * lz
                const shadow = towardLight < 0 && (px * px + py * py + pz * pz - towardLight * towardLight) < r2
                const band = tpl.brightness * (0.96 + 0.04 * Math.cos(v * 4)) * illumination * (shadow ? 0.18 : 1)
                return [224 * band, 205 * band, 162 * band, 1]
            },
        })
    })
}
