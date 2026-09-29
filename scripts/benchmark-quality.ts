import { execFileSync, spawnSync } from 'child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { cpus, platform, release, tmpdir, totalmem } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputPath = join(root, 'docs', 'assets', 'benchmarks', 'results.json')
const examplesPath = join(root, 'examples')
const renderExamples = ['catalog-charts', 'catalog-diagrams', 'catalog-ml', 'catalog-dataflow'] as const
const themes = ['dark', 'light'] as const
const warmupRuns = 1
const measuredRuns = 3
const renderScale = 1
const renderModuleUrl = pathToFileURL(join(root, 'dist', 'index.js')).href
const offlineEnv = { ...process.env, VIZMATIC_OFFLINE: '1' }

interface CheckDiagnostic {
    severity: 'error' | 'warning' | 'info'
    code: string
    message: string
    theme?: string
}

interface CheckFile {
    source: string
    diagnostics: CheckDiagnostic[]
    themes: Array<{ theme: string; diagnostics: CheckDiagnostic[] }>
}

interface CheckReport {
    files: CheckFile[]
    summary: { files: number; errors: number; warnings: number; info: number }
}

interface WorkerResult {
    runs: Array<{
        renderMs: number
        pngBytes: number
        pixelWidth: number
        pixelHeight: number
    }>
    peakRssBytes: number
}

const workerSource = `
import { mkdir, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const [rendererUrl, examplePath, theme, outputDir, scaleText, warmupText, measuredText] = process.argv.slice(1)
const { renderToPngWithOutput } = await import(rendererUrl)
const example = await import(pathToFileURL(examplePath).href)
const factory = example.create ?? example.default?.create
const width = example.width ?? example.default?.width
const height = example.height ?? example.default?.height
if (typeof factory !== 'function' || typeof width !== 'number' || typeof height !== 'number') {
  throw new Error('benchmark example must export create(theme), width, and height')
}
await mkdir(outputDir, { recursive: true })
const scale = Number(scaleText)
const warmups = Number(warmupText)
const measured = Number(measuredText)
async function render(index) {
  const outputPath = new URL('./' + index + '.png', pathToFileURL(outputDir + '/')).pathname
  const started = performance.now()
  const output = await renderToPngWithOutput(factory(theme), {
    width,
    height,
    outputPath,
    theme,
    scale,
  })
  const renderMs = performance.now() - started
  const pngBytes = (await stat(outputPath)).size
  return {
    renderMs: Math.round(renderMs * 100) / 100,
    pngBytes,
    pixelWidth: output.pixelWidth,
    pixelHeight: output.pixelHeight,
  }
}
for (let index = 0; index < warmups; index += 1) await render('warmup-' + index)
const runs = []
for (let index = 0; index < measured; index += 1) runs.push(await render('run-' + index))
const maxRss = process.resourceUsage().maxRSS
const peakRssBytes = Math.round(maxRss * (process.platform === 'win32' ? 1 : 1024))
process.stdout.write(JSON.stringify({ runs, peakRssBytes }) + '\\n')
`

function fail(message: string): never {
    throw new Error(message)
}

function commandOutput(command: string, args: string[]): string {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim()
}

function percentileNearestRank(values: number[], percentile: number): number {
    const ordered = [...values].sort((left, right) => left - right)
    const index = Math.max(0, Math.ceil(percentile * ordered.length) - 1)
    return ordered[index] ?? 0
}

function median(values: number[]): number {
    const ordered = [...values].sort((left, right) => left - right)
    const middle = Math.floor(ordered.length / 2)
    if (ordered.length % 2 === 1) return ordered[middle] ?? 0
    return ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2
}

function round(value: number): number {
    return Math.round(value * 100) / 100
}

function captureQualityCheck(availableSources: string[]): CheckReport {
    const check = spawnSync(process.execPath, [
        join(root, 'dist', 'cli.js'),
        'check',
        'examples',
        '--theme',
        themes.join(','),
        '--json',
    ], {
        cwd: root,
        encoding: 'utf8',
        env: offlineEnv,
        maxBuffer: 50 * 1024 * 1024,
    })

    if (check.error) throw check.error
    let report: CheckReport
    try {
        report = JSON.parse(check.stdout) as CheckReport
    } catch {
        fail(`vizmatic check did not return JSON (exit ${check.status}):\n${check.stderr || check.stdout}`)
    }

    if (!report.summary || !Array.isArray(report.files)) {
        fail('vizmatic check returned an incomplete JSON report')
    }
    const checkedSources = new Set(report.files.map((file) => file.source))
    const missing = availableSources.filter((source) => !checkedSources.has(source))
    if (missing.length > 0) fail(`vizmatic check skipped examples: ${missing.join(', ')}`)

    return report
}

function runRenderWorker(example: string, theme: typeof themes[number], outputDir: string): WorkerResult {
    const child = spawnSync(process.execPath, [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        workerSource,
        renderModuleUrl,
        join(examplesPath, `${example}.tsx`),
        theme,
        outputDir,
        String(renderScale),
        String(warmupRuns),
        String(measuredRuns),
    ], {
        cwd: root,
        encoding: 'utf8',
        env: offlineEnv,
        maxBuffer: 10 * 1024 * 1024,
    })

    if (child.error) throw child.error
    if (child.status !== 0) {
        fail(`benchmark worker failed for ${example} (${theme}):\n${child.stderr || child.stdout}`)
    }

    const lastOutputLine = child.stdout.trim().split('\n').at(-1)
    if (!lastOutputLine) fail(`benchmark worker returned no measurements for ${example} (${theme})`)
    try {
        return JSON.parse(lastOutputLine) as WorkerResult
    } catch {
        fail(`benchmark worker returned invalid JSON for ${example} (${theme}): ${lastOutputLine}`)
    }
}

const exampleFiles = (await readdir(examplesPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'))
    .map((entry) => entry.name)
    .sort()
const availableSources = exampleFiles.map((file) => `examples/${file}`)
const qualityReport = captureQualityCheck(availableSources)
const qualityFindings = qualityReport.files.flatMap((file) => [
    ...file.diagnostics.map((diagnostic) => ({ source: file.source, ...diagnostic })),
    ...file.themes.flatMap((theme) => theme.diagnostics.map((diagnostic) => ({
        source: file.source,
        ...diagnostic,
        theme: diagnostic.theme ?? theme.theme,
    }))),
])

const temporaryDir = await mkdtemp(join(tmpdir(), 'vizmatic-benchmark-'))
const renders: Array<{
    example: string
    source: string
    theme: typeof themes[number]
    runs: WorkerResult['runs']
    summary: {
        medianRenderMs: number
        p95RenderMs: number
        peakRssBytes: number
        pngBytes: number
        pixelWidth: number
        pixelHeight: number
    }
}> = []

try {
    for (const example of renderExamples) {
        for (const theme of themes) {
            const result = runRenderWorker(example, theme, join(temporaryDir, `${example}-${theme}`))
            if (result.runs.length !== measuredRuns) {
                fail(`expected ${measuredRuns} measured renders for ${example} (${theme}), got ${result.runs.length}`)
            }
            const durations = result.runs.map((run) => run.renderMs)
            const lastRun = result.runs.at(-1)
            if (!lastRun) fail(`missing final render for ${example} (${theme})`)
            renders.push({
                example,
                source: `examples/${example}.tsx`,
                theme,
                runs: result.runs,
                summary: {
                    medianRenderMs: round(median(durations)),
                    p95RenderMs: percentileNearestRank(durations, 0.95),
                    peakRssBytes: result.peakRssBytes,
                    pngBytes: lastRun.pngBytes,
                    pixelWidth: lastRun.pixelWidth,
                    pixelHeight: lastRun.pixelHeight,
                },
            })
        }
    }
} finally {
    await rm(temporaryDir, { recursive: true, force: true })
}

const availableCpus = cpus()
const dirty = commandOutput('git', ['status', '--porcelain']).length > 0
const results = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: {
        commit: commandOutput('git', ['rev-parse', '--short=12', 'HEAD']),
        workingTree: dirty ? 'modified' : 'clean',
    },
    environment: {
        node: process.version,
        platform: platform(),
        release: release(),
        arch: process.arch,
        cpuModel: availableCpus[0]?.model.trim() ?? 'unknown',
        cpuCount: availableCpus.length,
        totalMemoryBytes: totalmem(),
    },
    methodology: {
        measuredRunsPerExampleTheme: measuredRuns,
        warmupRunsPerExampleTheme: warmupRuns,
        timing: 'performance.now() around create(theme) and renderToPngWithOutput, including PNG encoding and file writing; excludes Node startup and module imports; one worker process per example/theme.',
        peakRss: 'process.resourceUsage().maxRSS captured after the warmup and measured renders; includes Node startup, imports, warmup, and measured renders; normalized to bytes.',
        scale: renderScale,
        renderExamples: renderExamples.map((example) => `examples/${example}.tsx`),
    },
    qualityCheck: {
        command: 'vizmatic check examples --theme dark,light --json',
        examples: { checked: qualityReport.summary.files, available: availableSources.length },
        themesChecked: qualityReport.files.reduce((count, file) => count + file.themes.length, 0),
        diagnostics: {
            errors: qualityReport.summary.errors,
            warnings: qualityReport.summary.warnings,
            info: qualityReport.summary.info,
        },
        findings: qualityFindings,
    },
    renders,
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`)
console.log(`wrote ${outputPath}`)
console.log(`checked ${qualityReport.summary.files}/${availableSources.length} examples across ${results.qualityCheck.themesChecked} theme renders: ${qualityReport.summary.errors} errors, ${qualityReport.summary.warnings} warnings`)
console.log(`measured ${renders.length} example/theme pairs (${measuredRuns} runs each; ${warmupRuns} warmup each)`)
