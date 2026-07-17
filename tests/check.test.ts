import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnosticFromMessage } from '../src/diagnostics'
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

async function runCheck(source: string) {
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

    it('keeps every playground template free of rendering errors', async () => {
        for (const template of playgroundTemplates) {
            const { result, report } = await runCheck(template.source)
            expect(result.status, `${template.id}: ${result.stderr}`).toBe(0)
            expect(report.ok, template.id).toBe(true)
        }
    }, 60_000)
})
