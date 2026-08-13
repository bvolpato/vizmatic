import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeRenderedLayout, diagnosticFromMessage } from '../src/diagnostics'
import type { SatoriNode } from '../src'
import { playgroundTemplates } from '../src/playground-templates'

interface CheckReport {
    schemaVersion: number
    command: string
    ok: boolean
    files: Array<{
        ok: boolean
        themes: Array<{
            ok: boolean
            dimensions: {
                input: { width: number; height: number }
                resolved?: { width: number; height: number }
            }
            diagnostics: Array<{
                code: string
                severity: string
                edges?: string[]
                suggestedDimensions?: { width: number; height: number }
            }>
        }>
    }>
    summary: { files: number; errors: number; warnings: number; info: number }
}

const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function runCheck(source: string, extraArgs: string[] = []) {
    const dir = await mkdtemp(join(tmpdir(), 'vizmatic-check-test-'))
    tempDirs.push(dir)
    const framePath = join(dir, 'frame.tsx')
    await writeFile(framePath, source)

    const result = spawnSync(process.execPath, [
        '--import',
        'tsx',
        resolve('src/cli.ts'),
        'check',
        framePath,
        '--theme',
        'light',
        '--json',
        ...extraArgs,
    ], {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, VIZMATIC_DISABLE_NETWORK: '1' },
    })

    return {
        dir,
        result,
        report: JSON.parse(result.stdout) as CheckReport,
    }
}

describe('vizmatic check', () => {
    it('inherits rendered font sizes without treating overlapping line boxes as overlapping glyphs', () => {
        const inheritedSmallText: SatoriNode[] = [
            { type: 'div', left: 0, top: 0, width: 200, height: 80, props: { style: { fontSize: 8 } } },
            { type: 'span', left: 10, top: 10, width: 45, height: 15, props: {}, textContent: 'Inherited size' },
        ]
        expect(analyzeRenderedLayout(inheritedSmallText, 'light')).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'readability.small_text' }),
        ]))

        const separateGlyphs: SatoriNode[] = [
            { type: 'div', left: 0, top: 0, width: 200, height: 80, props: {} },
            { type: 'span', left: 10, top: 10, width: 80, height: 20, props: { style: { fontSize: 12 } }, textContent: 'First label' },
            { type: 'span', left: 10, top: 20, width: 90, height: 20, props: { style: { fontSize: 12 } }, textContent: 'Second label' },
        ]
        expect(analyzeRenderedLayout(separateGlyphs, 'light')).not.toContainEqual(expect.objectContaining({
            code: 'layout.text_overlap',
        }))
    })

    it('classifies unsupported prop warnings for agents', () => {
        expect(diagnosticFromMessage('Unknown prop "foo" on MetricCard', 'warning', 'light')).toMatchObject({
            code: 'api.unsupported_prop',
            severity: 'warning',
            theme: 'light',
        })
    })

    it('returns clean structured output without writing render artifacts', async () => {
        const { dir, result, report } = await runCheck(String.raw`width = 640
height = 360

<Scene>
  <CalloutCard title="Checked" detail="Structured validation output" tone="green" width={420} />
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(result.stderr).toBe('')
        expect(report).toMatchObject({
            schemaVersion: 1,
            command: 'check',
            ok: true,
            summary: { files: 1, errors: 0, warnings: 0 },
        })
        expect(report.files[0]?.themes[0]?.ok).toBe(true)
        expect(await readdir(dir)).toEqual(['frame.tsx'])
    }, 30_000)

    it('keeps JSON output valid when frame code logs later', async () => {
        const { result, report } = await runCheck(String.raw`setTimeout(() => {
  console.log("LATE_FRAME_LOG")
  console.info("LATE_FRAME_INFO")
  console.debug("LATE_FRAME_DEBUG")
}, 10)

<Scene>
  <CalloutCard title="Checked" detail="Delayed logs stay out of JSON" tone="green" width={420} />
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.ok).toBe(true)
        expect(result.stdout).not.toContain('LATE_FRAME_LOG')
        expect(result.stdout).not.toContain('LATE_FRAME_INFO')
        expect(result.stdout).not.toContain('LATE_FRAME_DEBUG')
    }, 30_000)

    it('keeps helper JSX and nested metadata in setup code', async () => {
        const { result, report } = await runCheck(String.raw`/*
width = 120
preset = "missing"
*/
function Helper() {
  const width = 200
  const preset = "missing"
  return (
    <Panel title="Helper">
      <CalloutCard title="Nested" detail="Ordinary setup variables" tone="blue" />
    </Panel>
  )
}

<Scene>
  {1 < 2 ? <Helper /> : null}
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.files[0]?.themes[0]?.dimensions.input).toEqual({ width: 960, height: 540 })
        expect(report.files[0]?.themes[0]?.diagnostics).not.toContainEqual(expect.objectContaining({
            code: 'frame.unknown_preset',
        }))
    }, 30_000)

    it('normalizes wrapped default elements and dimensions', async () => {
        const { result, report } = await runCheck(String.raw`import React from "react"

export default {
  default: <div style={{ display: "flex", width: "100%", height: "100%" }} />,
  width: 320,
  height: 180,
}
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.files[0]?.themes[0]?.dimensions.input).toEqual({ width: 320, height: 180 })
    }, 30_000)

    it('reports strict overflow with edges and suggested dimensions', async () => {
        const { result, report } = await runCheck(String.raw`width = 960
height = 540

<Scene>
  <Row gap={18} width="100%" justify="center">
    <CalloutCard title="First" detail="Wide panel" tone="blue" width={470} />
    <CalloutCard title="Second" detail="Wide panel" tone="purple" width={470} />
    <CalloutCard title="Third" detail="Wide panel" tone="green" width={470} />
  </Row>
</Scene>
`)

        expect(result.status).toBe(1)
        expect(result.stderr).toBe('')
        const diagnostic = report.files[0]?.themes[0]?.diagnostics.find(({ code }) => code === 'layout.overflow')
        expect(report.ok).toBe(false)
        expect(diagnostic?.edges).toEqual(expect.arrayContaining(['left', 'right']))
        expect(diagnostic?.suggestedDimensions?.width).toBeGreaterThan(960)
    }, 30_000)

    it('classifies unsupported styles and low contrast', async () => {
        const unsupported = await runCheck(String.raw`width = 400
height = 240

<Scene>
  <div style={{ display: "grid", width: 280, height: 120 }}>Unsupported</div>
</Scene>
`)
        expect(unsupported.result.status).toBe(1)
        expect(unsupported.report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'style.unsupported', severity: 'error' }),
        ]))

        const contrast = await runCheck(String.raw`width = 400
height = 240

function LowContrast() {
  return <div style={{
      display: "flex",
      width: 280,
      height: 120,
      padding: 24,
      backgroundColor: "#ffffff",
      color: "#f5f5f5",
    }}>Low contrast</div>
}

<Scene>
  <LowContrast />
</Scene>
`)
        expect(contrast.result.status, contrast.result.stderr).toBe(0)
        expect(contrast.report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'accessibility.low_contrast', severity: 'warning' }),
        ]))
    }, 30_000)

    it('checks contrast against requested background and parses CSS font sizes', async () => {
        const lowContrast = await runCheck(String.raw`width = 400
height = 240

<Scene>
  <div style={{ color: "#f5f5f5" }}>Low contrast</div>
</Scene>
`, ['--background', '#ffffff'])
        expect(lowContrast.result.status, lowContrast.result.stderr).toBe(0)
        expect(lowContrast.report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'accessibility.low_contrast', severity: 'warning' }),
        ]))

        const largeText = await runCheck(String.raw`width = 400
height = 240

<Scene>
  <div style={{ color: "#777777", fontSize: "24px" }}>Large text</div>
</Scene>
`, ['--background', '#ffffff'])
        expect(largeText.result.status, largeText.result.stderr).toBe(0)
        expect(largeText.report.files[0]?.themes[0]?.diagnostics).not.toContainEqual(expect.objectContaining({
            code: 'accessibility.low_contrast',
        }))
    }, 30_000)

    it('reports tiny and overlapping rendered text', async () => {
        const { result, report } = await runCheck(String.raw`width = 400
height = 240

<Scene>
  <div style={{ position: "relative", display: "flex", width: 280, height: 120 }}>
    <div style={{ position: "absolute", left: 20, top: 20, fontSize: 8 }}>First label</div>
    <div style={{ position: "absolute", left: 20, top: 20, fontSize: 12 }}>Second label</div>
  </div>
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'readability.small_text', severity: 'warning' }),
            expect.objectContaining({ code: 'layout.text_overlap', severity: 'warning' }),
        ]))
    }, 30_000)

    it('reports crossing graph connectors', async () => {
        const { result, report } = await runCheck(String.raw`width = 600
height = 360

<Scene>
  <GraphDiagram
    width={500}
    height={260}
    nodeWidth={80}
    nodeHeight={44}
    nodes={[
      { id: "a", label: "A", x: 0, y: 0 },
      { id: "b", label: "B", x: 0, y: 1 },
      { id: "c", label: "C", x: 1, y: 0 },
      { id: "d", label: "D", x: 1, y: 1 },
    ]}
    edges={[
      { from: "a", to: "d" },
      { from: "b", to: "c" },
    ]}
  />
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'layout.connector_congestion', severity: 'warning' }),
        ]))
    }, 30_000)

    it('reports stretched panels with unused vertical space', async () => {
        const { result, report } = await runCheck(String.raw`width = 640
height = 420

<Scene>
  <Panel title="Sparse panel" width={420} height={280}>
    <div>Only one short row</div>
  </Panel>
</Scene>
`)

        expect(result.status, result.stderr).toBe(0)
        expect(report.files[0]?.themes[0]?.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: 'layout.whitespace_imbalance', severity: 'warning' }),
        ]))
    }, 30_000)

    it('keeps every playground template free of rendering errors', async () => {
        for (const template of playgroundTemplates) {
            const { result, report } = await runCheck(template.source)
            expect(result.status, `${template.id}: ${result.stderr}`).toBe(0)
            expect(report.ok, template.id).toBe(true)
        }
    }, 60_000)
})
