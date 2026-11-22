import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const binDir = join(root, 'node_modules', '.bin')
const tsupBin = join(binDir, process.platform === 'win32' ? 'tsup.cmd' : 'tsup')
const tsxLoader = pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
const browserOnly = process.argv.includes('--browser-only')

function run(label, command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: root,
            stdio: 'inherit',
            shell: process.platform === 'win32' && command.endsWith('.cmd'),
        })
        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (code === 0) resolve()
            else reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
        })
    })
}

const tsup = (label, args) => () => run(label, tsupBin, args)
const tsx = (label, script) => () => run(label, process.execPath, ['--import', tsxLoader, script])

if (!browserOnly) {
    await rm(join(root, 'dist'), { recursive: true, force: true })
}
await mkdir(join(root, 'dist', 'stage-browser'), { recursive: true })

// Every task below writes to disjoint files under dist/.
const nodeTasks = browserOnly ? [] : [
    tsup('esm', [
        'src/index.ts', 'src/scene-runtime.ts', 'src/stage.ts', 'src/stage-export.ts', 'src/cli.ts', 'src/scene-cli.ts',
        '--format', 'esm', '--target', 'node20', '--external', 'react',
    ]),
    tsup('cjs', [
        'src/index.ts', 'src/scene-runtime.ts', 'src/stage.ts', 'src/stage-export.ts',
        '--format', 'cjs', '--target', 'node20', '--external', 'react', '--define.import.meta.url', 'undefined',
    ]),
    tsx('satori', 'scripts/build-satori.ts'),
]

const browserTasks = [
    tsup('scene-browser-dts', ['src/scene-browser.ts', '--dts-only', '--format', 'esm', '--target', 'es2022', '--external', 'react']),
    tsup('scene-browser-assets', ['src/scene-browser-assets.ts', '--format', 'esm', '--dts', '--target', 'node20']),
    tsx('scene-browser', 'scripts/build-scene-browser.ts'),
    tsup('stage-browser-dts', ['src/stage/browser.ts', '--dts-only', '--format', 'esm', '--target', 'es2022', '--out-dir', 'dist/stage-browser']),
    tsx('stage-browser', 'scripts/build-stage-browser.ts'),
]

const results = await Promise.allSettled([...nodeTasks, ...browserTasks].map((task) => task()))
const failed = results.find((result) => result.status === 'rejected')
if (failed) throw failed.reason
