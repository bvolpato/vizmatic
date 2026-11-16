import { mixColor, parseColor, scalarField, type Node, type StageImage, type Vec3 } from 'vizmatic/stage'

const POLAR = 0.902
const INV_POLAR_SQUARED = 1 / (POLAR * POLAR)
// NASA axial tilt: https://science.nasa.gov/saturn/facts/
const TILT = 26.73 * Math.PI / 180
const COS_TILT = Math.cos(TILT), SIN_TILT = Math.sin(TILT)
// C, B and A ring radii, in equatorial radii. The Cassini division stays open.
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/satringfact.html
const RINGS = [[1.239, 1.526, 0.57], [1.526, 1.950, 0.83], [2.030, 2.270, 0.72]] as const

// Work in Saturn's untilted coordinates: the ellipsoid and rings share z = 0.
function local(x: number, y: number, z: number): Vec3 {
    return [x, y * COS_TILT + z * SIN_TILT, z * COS_TILT - y * SIN_TILT]
}

// Illustrative, low lighting makes the planet's shadow visible across the rings.
const lightLength = Math.hypot(-0.7, -0.35, 0.3)
const LIGHT = local(-0.7 / lightLength, -0.35 / lightLength, 0.3 / lightLength)
const LIGHT_A = metric(LIGHT, LIGHT)
const COLORS = ['#251c18', '#624b32', '#a58453', '#cfb47b', '#e9d8a9', '#fff1ce']
const stops = COLORS.map(parseColor)
const PALETTE = Array.from({ length: 1025 }, (_, i) => {
    const position = i / 1024 * (stops.length - 1), low = Math.min(stops.length - 2, Math.floor(position))
    return mixColor(stops[low], stops[low + 1], position - low)
})
const NX = 480, NY = 360

function metric(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] * INV_POLAR_SQUARED
}

// For p = origin + depth * direction, return the larger ellipsoid root.
// Camera direction points toward the viewer, so larger depth is in front.
function ellipsoidDepth(origin: Vec3, direction: Vec3, a: number): number {
    const b = metric(origin, direction), c = metric(origin, origin) - 1
    const discriminant = b * b - a * c
    return discriminant < 0 ? -Infinity : (-b + Math.sqrt(discriminant)) / a
}

function ringAt(radius: number): number {
    for (let i = 0; i < RINGS.length; i++) if (radius >= RINGS[i][0] && radius <= RINGS[i][1]) return i
    return -1
}

export function saturnPortrait(): Node {
    let lastTime = NaN
    let right: Vec3, up: Vec3, towardCamera: Vec3, cameraA: number
    let material = 0, sampleIndex = 0
    const materials = new Uint8Array(NX * NY)

    const sample = (x: number, y: number, time: number): number => {
        if (time !== lastTime) {
            const theta = -0.4 + (time - 27) * 0.025, phi = 1.16 - 0.016 * (time - 27)
            const sinT = Math.sin(theta), cosT = Math.cos(theta), sinP = Math.sin(phi), cosP = Math.cos(phi)
            right = local(-sinT, cosT, 0)
            up = local(-cosP * cosT, -cosP * sinT, sinP)
            towardCamera = local(sinP * cosT, sinP * sinT, cosP)
            cameraA = metric(towardCamera, towardCamera)
            lastTime = time
        }

        material = 0
        const origin: Vec3 = [x * right[0] + y * up[0], x * right[1] + y * up[1], x * right[2] + y * up[2]]
        const bodyDepth = ellipsoidDepth(origin, towardCamera, cameraA)
        if (Math.abs(towardCamera[2]) > 1e-8) {
            const depth = -origin[2] / towardCamera[2]
            if (depth > bodyDepth) {
                const ringPoint: Vec3 = [origin[0] + depth * towardCamera[0], origin[1] + depth * towardCamera[1], 0]
                const radius = Math.hypot(ringPoint[0], ringPoint[1]), ring = ringAt(radius)
                if (ring >= 0) {
                    // Only an intersection ahead of the ring point blocks the light.
                    const shadow = ellipsoidDepth(ringPoint, LIGHT, LIGHT_A) > 0
                    material = 2 + ring + (shadow ? 3 : 0)
                    const shade = RINGS[ring][2] + 0.012 * Math.cos((radius - 1.239) * 18) + 0.008 * Math.sin(radius * 32)
                    return shade * (shadow ? 0.22 : 0.84 + 0.16 * Math.abs(LIGHT[2]))
                }
            }
        }
        if (!Number.isFinite(bodyDepth)) return NaN
        material = 1

        const px = origin[0] + bodyDepth * towardCamera[0]
        const py = origin[1] + bodyDepth * towardCamera[1]
        const pz = origin[2] + bodyDepth * towardCamera[2]
        const nz = pz * INV_POLAR_SQUARED
        const lambert = Math.max(0, (px * LIGHT[0] + py * LIGHT[1] + nz * LIGHT[2]) / Math.hypot(px, py, nz))
        const latitude = Math.asin(Math.max(-1, Math.min(1, pz / POLAR)))
        // Illustrative cloud belts and faint, surface-anchored grain, not imagery.
        const bands = 0.032 * Math.sin(latitude * 16) + 0.016 * Math.cos(latitude * 29)
        const grain = 0.0025 * Math.sin(22 * px + 11 * py) * Math.sin(19 * pz - 13 * px)
        return (0.89 + bands + grain) * (0.24 + 0.76 * lambert)
    }
    const node = scalarField((x, y, time) => {
        const shade = sample(x, y, time)
        materials[sampleIndex++] = material
        return shade
    }, {
        x: [-2.5, 2.5], y: [-1.875, 1.875], domain: [0, 1],
        colors: COLORS, resolution: [NX, NY], width: 885, height: 664,
    })

    const rasterize = node.rawOps!
    let sourcePixels: StageImage['pixels'], antialiased: StageImage['pixels']
    node.rawOps = function (matrix, alpha, ops) {
        sampleIndex = 0
        const first = ops.length
        rasterize.call(this, matrix, alpha, ops)
        const op = ops[first]
        if (!op || op.kind !== 'image' || !op.image.pixels) return
        const source = op.image.pixels
        if (source !== sourcePixels) {
            // Resample only material edges, including shadow edges. Keep straight
            // RGB separate from coverage alpha to avoid a dark transparent fringe.
            const data = source.data.slice(), dx = 5 / (NX - 1), dy = 3.75 / (NY - 1)
            for (let row = 1; row < NY - 1; row++) for (let col = 1; col < NX - 1; col++) {
                const index = row * NX + col, center = materials[index]
                let edge = false
                for (let oy = -1; oy <= 1 && !edge; oy++) for (let ox = -1; ox <= 1; ox++) {
                    if (materials[index + oy * NX + ox] !== center) { edge = true; break }
                }
                if (!edge) continue
                let red = 0, green = 0, blue = 0, covered = 0
                for (const oy of [-0.25, 0.25]) for (const ox of [-0.25, 0.25]) {
                    const shade = sample(-2.5 + (col + ox) * dx, 1.875 - (row + oy) * dy, lastTime)
                    if (!Number.isFinite(shade)) continue
                    const color = PALETTE[Math.round(Math.max(0, Math.min(1, shade)) * 1024)]
                    red += color[0]; green += color[1]; blue += color[2]; covered++
                }
                const pixel = index * 4
                data[pixel] = covered ? red / covered : 0
                data[pixel + 1] = covered ? green / covered : 0
                data[pixel + 2] = covered ? blue / covered : 0
                data[pixel + 3] = covered * 255 / 4
            }
            sourcePixels = source
            antialiased = { width: NX, height: NY, data }
        }
        ops[first] = { ...op, image: { ...op.image, pixels: antialiased } }
    }
    return node
}
