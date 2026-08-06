import { spawnSync } from 'child_process'

interface PackResult {
    name?: string
    version?: string
    size?: number
    unpackedSize?: number
    entryCount?: number
}

const limits = {
    size: 3_250_000,
    unpackedSize: 12_500_000,
    entryCount: 4_000,
}

const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
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
