import { parametricSurface, type Rgba, type Vec3 } from 'vizmatic/stage'

export const COLORS = ['#b8b1a7', '#e5c68c', '#62b8ed', '#dd8566', '#e4b482', '#dbc999', '#8ad9d8', '#739cf2']
export const RADII = [0.075, 0.12, 0.135, 0.1, 0.30, 0.25, 0.19, 0.185]
export const SPACING = [1.15, 1.7, 2.3, 2.95, 4.3, 5.6, 6.9, 8.1]
const TAU = Math.PI * 2
const tilt = 26.7 * Math.PI / 180

const rotate = ([x, y, z]: Vec3, angle: number): Vec3 => [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)]
const mix = (a: Vec3, b: Vec3, f: number): Vec3 => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]

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
    const angle = index === 5 ? tilt : index === 2 ? 0.41 : 0.08
    const flatten = index === 5 ? 0.902 : index === 4 ? 0.935 : 1
    const length = Math.hypot(...light)
    const direction: Vec3 = [light[0] / length, light[1] / length, light[2] / length]
    return parametricSurface((u, v) => {
        const p = rotate([Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), flatten * Math.sin(v)], angle)
        return [center[0] + radius * p[0], center[1] + radius * p[1], center[2] + radius * p[2]]
    }, [0, TAU], [-Math.PI / 2, Math.PI / 2], {
        resolution: [40, 24], outwardFrom: center, cull: true, shaded: false,
        colorAt: (_x, _y, _z, u, v): Rgba => {
            const longitude = u * TAU, latitude = (v - 0.5) * Math.PI
            const normal = rotate([Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude) / flatten], angle)
            const dot = normal.reduce((sum, n, i) => sum + n * direction[i], 0) / Math.hypot(...normal)
            const illumination = 0.12 + 0.88 * Math.max(0, dot)
            const rgb = surfaceColor(index, longitude + spin, latitude)
            return [rgb[0] * illumination, rgb[1] * illumination, rgb[2] * illumination, 1]
        },
    })
}

export function saturnRings(center: Vec3, radius: number, light: Vec3, camera: Vec3) {
    const length = Math.hypot(...light)
    const direction: Vec3 = [light[0] / length, light[1] / length, light[2] / length]
    const facing = -Math.sin(tilt) * camera[1] + Math.cos(tilt) * camera[2] >= 0 ? 1 : -1
    const incidence = facing * (-Math.sin(tilt) * direction[1] + Math.cos(tilt) * direction[2])
    const illumination = 0.22 + 0.78 * Math.max(0, incidence)
    // The three annuli leave the Cassini division visibly open. Ring colors and
    // opacity are illustrative; the shadow is the sphere's geometric shadow.
    return [[1.24, 1.53, 0.52], [1.53, 1.95, 0.91], [2.03, 2.27, 0.74]].map(([inner, outer, brightness]) =>
        parametricSurface((angle, r) => {
            const p = rotate([r * radius * Math.cos(angle), r * radius * Math.sin(angle), 0], tilt)
            return [center[0] + p[0], center[1] + p[1], center[2] + p[2]]
        }, [0, TAU], [inner, outer], {
            resolution: [80, 3], shaded: false,
            colorAt: (x, y, z, _u, v): Rgba => {
                const p = [x - center[0], y - center[1], z - center[2]]
                const towardLight = p.reduce((sum, n, i) => sum + n * direction[i], 0)
                const shadow = towardLight < 0 && p.reduce((sum, n) => sum + n * n, 0) - towardLight ** 2 < radius ** 2
                const band = brightness * (0.96 + 0.04 * Math.cos(v * 4)) * illumination * (shadow ? 0.18 : 1)
                return [224 * band, 205 * band, 162 * band, 1]
            },
        }))
}
