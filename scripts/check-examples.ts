import { spawnSync } from 'child_process'

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

console.log(`examples ok: ${summary.files ?? 0} files, 0 errors, 0 warnings`)
