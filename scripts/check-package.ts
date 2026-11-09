import { spawnSync } from 'child_process'

interface PackResult {
    name?: string
    version?: string
    size?: number
    unpackedSize?: number
    entryCount?: number
}

const limits = {
    // Adds validated image preparation to the shared renderer and offline assets. CI packs about 32 KB larger than a
    // laptop does, so leave room: this is a tripwire for an accident, like the unpacked size below.
    // In November 2026 the package was at 5.60 MB, and the objects for system films add about 0.1 MB.
    // A guard against an accident of megabytes, not a cap on features: it has room to spare.
    // With the semibold of the serif text font (0.12 MB), the package is at 5.93 MB.
    size: 7_000_000,
    // Includes image preflight, browser/Node rendering, declarations, and examples. Contact sheets of film stills
    // add the film and text code to the CommonJS export bundle, which holds its own copy of what it imports.
    // A stage object ships in four bundles and three declaration files, so the pictograms cost 48 KB.
    // In November 2026 the package was at 14.92 MB. A check rule and three objects for system films (lanes, the
    // bit field and the terminal) add 0.29 MB together, and more objects of that kind follow.
    // The budget is a tripwire for an accident, such as a font that ships two times. It leaves room for features.
    // With the semibold of the serif text font (one file of 0.33 MB), the package is at 16.03 MB.
    unpackedSize: 18_000_000,
    // Includes the bundled raster codec license notice and film examples. The narration tools (15 files) and the
    // narrated film template (13 files) are 28 files: with them the package holds 209 files.
    entryCount: 220,
}

// Inspect the existing build. npm also runs prepare for a dry run unless suppressed.
const result = spawnSync('npm', ['pack', '--ignore-scripts', '--script-shell=true', '--dry-run', '--json'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
})

if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
}

const jsonStart = result.stdout.search(/^\[/m)
if (jsonStart < 0) {
    process.stderr.write(result.stdout)
    throw new Error('npm pack did not return JSON metadata')
}

let packages: PackResult[]
try {
    packages = JSON.parse(result.stdout.slice(jsonStart)) as PackResult[]
} catch {
    process.stderr.write(result.stdout)
    throw new Error('npm pack returned invalid JSON metadata')
}
const packed = packages[0]
if (!packed || packages.length !== 1) {
    throw new Error(`npm pack returned ${packages.length} package records`)
}

for (const [field, limit] of Object.entries(limits) as Array<[keyof typeof limits, number]>) {
    const value = packed[field]
    if (typeof value !== 'number') {
        throw new Error(`npm pack metadata is missing ${field}`)
    }
    if (value > limit) {
        throw new Error(`npm package ${field} ${value.toLocaleString()} exceeds budget ${limit.toLocaleString()}`)
    }
}

console.log(
    `package ok: ${packed.name}@${packed.version}, ${packed.size?.toLocaleString()} bytes compressed, `
    + `${packed.unpackedSize?.toLocaleString()} bytes unpacked, ${packed.entryCount?.toLocaleString()} files`,
)
