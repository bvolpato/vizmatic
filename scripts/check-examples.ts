import { spawnSync } from 'child_process'
import { access, readFile, readdir } from 'fs/promises'
import { dirname, extname, join } from 'path'
import { isDeepStrictEqual } from 'util'
import { fileURLToPath, pathToFileURL } from 'url'
import { sampleAnimationFrames, type DefinedAnimation } from '../src/timeline'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

interface CheckReport {
    summary?: {
        files?: number
        errors?: number
        warnings?: number
        info?: number
    }
}

const result = spawnSync(process.execPath, [
    'dist/cli.js',
    'check',
    'examples',
    '--theme',
    'dark,light',
    '--json',
], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
})

if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout) as CheckReport
const summary = report.summary
if (!summary || summary.errors || summary.warnings) {
    process.stderr.write(result.stdout)
    process.exit(1)
}

interface ExampleManifestEntry {
    name?: string
    source?: string
    outputs?: string[]
}

function fail(message: string): never {
    throw new Error(message)
}

function unique(values: string[]): string[] {
    return [...new Set(values)]
}

function assertUnique(label: string, values: string[]): void {
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index)
    if (duplicates.length) {
        fail(`${label} contains duplicates: ${unique(duplicates).join(', ')}`)
    }
}

function compareSets(label: string, expectedValues: string[], actualValues: string[]): void {
    const expected = unique(expectedValues).sort()
    const actual = unique(actualValues).sort()
    const missing = expected.filter((value) => !actual.includes(value))
    const extra = actual.filter((value) => !expected.includes(value))
    if (missing.length || extra.length) {
        const details = [
            missing.length ? `missing: ${missing.join(', ')}` : '',
            extra.length ? `extra: ${extra.join(', ')}` : '',
        ].filter(Boolean).join('; ')
        fail(`${label} mismatch (${details})`)
    }
}

const examplesDir = join(root, 'examples')
const exampleFiles = (await readdir(examplesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name) === '.tsx')
    .map((entry) => entry.name)
    .sort()
const animatedSources: string[] = []
const timelineSources: string[] = []
for (const file of exampleFiles) {
    const source = await readFile(join(examplesDir, file), 'utf8')
    if (source.includes('createScenes') || source.includes('createAnimation')) {
        animatedSources.push(`examples/${file}`)
    }
    if (source.includes('createAnimation')) timelineSources.push(`examples/${file}`)
}

for (const source of timelineSources) {
    const module = await import(pathToFileURL(join(root, source)).href) as {
        createAnimation?: (theme: 'dark' | 'light') => DefinedAnimation<object>
    }
    if (typeof module.createAnimation !== 'function') fail(`${source} declares createAnimation but does not export it`)

    for (const theme of ['dark', 'light'] as const) {
        const frames = sampleAnimationFrames(module.createAnimation(theme))
        const first = frames[0]?.state
        const last = frames.at(-1)?.state
        if (!first || !last || !isDeepStrictEqual(first, last)) {
            fail(`${source} ${theme} animation loop does not return to its initial state`)
        }
    }
}

const assetsDir = join(root, 'docs', 'assets', 'examples')
const mainManifest = JSON.parse(await readFile(join(assetsDir, 'manifest.json'), 'utf8')) as ExampleManifestEntry[]
const expectedGifEntries = mainManifest
    .filter((entry) => entry.outputs?.some((output) => output.endsWith('.gif')))
    .map((entry, index) => {
        if (!entry.name || !entry.source || !entry.outputs) {
            fail(`manifest GIF entry ${index} is missing name, source, or outputs`)
        }
        return {
            name: entry.name,
            source: entry.source,
            outputs: entry.outputs.filter((output) => output.endsWith('.gif')),
        }
    })
const expectedGifNames = expectedGifEntries.map((entry) => entry.name)
const expectedGifSources = expectedGifEntries.map((entry) => entry.source)
const expectedGifOutputs = expectedGifEntries.flatMap((entry) => entry.outputs)
assertUnique('manifest GIF entry names', expectedGifNames)
assertUnique('manifest GIF entry sources', expectedGifSources)
assertUnique('manifest GIF outputs', expectedGifOutputs)
for (const entry of expectedGifEntries) {
    assertUnique(`${entry.name} manifest GIF outputs`, entry.outputs)
}

compareSets('animated example sources in manifest', animatedSources, expectedGifSources)

const gifManifest = JSON.parse(await readFile(join(assetsDir, 'gif-manifest.json'), 'utf8')) as ExampleManifestEntry[]
for (const [index, entry] of gifManifest.entries()) {
    if (!entry.name || !entry.source || !entry.outputs) {
        fail(`gif-manifest entry ${index} is missing name, source, or outputs`)
    }
}
const gifNames = gifManifest.map((entry) => entry.name as string)
const gifSources = gifManifest.map((entry) => entry.source as string)
assertUnique('GIF manifest entries', gifNames)
assertUnique('GIF manifest sources', gifSources)

compareSets('GIF manifest names', expectedGifNames, gifNames)
compareSets('GIF manifest sources', expectedGifSources, gifSources)

const expectedByName = new Map(expectedGifEntries.map((entry) => [entry.name, entry]))
const seenOutputs = new Set<string>()
for (const entry of gifManifest) {
    const name = entry.name as string
    const expectedEntry = expectedByName.get(name)
    const expectedOutputs = expectedEntry?.outputs
    if (!expectedOutputs) fail(`GIF manifest has unexpected entry: ${name || '(unnamed)'}`)
    if (entry.source !== expectedEntry.source) {
        fail(`${name} GIF manifest source mismatch: expected ${expectedEntry.source}, got ${entry.source}`)
    }
    const outputs = entry.outputs as string[]
    assertUnique(`${name} GIF manifest outputs`, outputs)
    compareSets(`${name} GIF outputs`, expectedOutputs, outputs)
    for (const output of outputs) {
        if (!output.endsWith('.gif')) fail(`${name} GIF manifest contains non-GIF output: ${output}`)
        if (seenOutputs.has(output)) fail(`GIF manifest reuses output: ${output}`)
        seenOutputs.add(output)
        await access(join(assetsDir, output)).catch(() => fail(`${name} GIF output missing: ${output}`))
    }
}

console.log(`examples ok: ${summary.files ?? 0} files, 0 errors, 0 warnings`)
