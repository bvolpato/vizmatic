import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

function run(label, command, args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: root,
            stdio: 'inherit',
            env: { ...process.env, ...env },
            shell: process.platform === 'win32',
        })
        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (code === 0) resolve()
            else reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
        })
    })
}

async function runAll(tasks) {
    const results = await Promise.allSettled(tasks.map((fn) => fn()))
    const failed = results.find((result) => result.status === 'rejected')
    if (failed) throw failed.reason
}

// Phase 1: lint (tsc --noEmit + actionlint) and build dist/ have disjoint outputs.
await runAll([
    () => run('lint', 'pnpm', ['lint']),
    () => run('build', 'pnpm', ['build']),
])

// Phase 2: full Vitest suite reusing the fresh build from Phase 1.
await run('vitest', 'pnpm', ['exec', 'vitest', 'run'], { VIZMATIC_TEST_USE_EXISTING_BUILD: '1' })

// Phase 3: refresh gallery PNGs, GIFs, manifests, and examples/README.md.
await run('render-examples', 'pnpm', ['exec', 'tsx', 'scripts/render-examples.ts'])

// Phase 4: site build + docs verification, examples/films checks, and package/consumer checks are independent.
// check:examples recursively validates every file under examples/ (including all films in dark + light looks).
await runAll([
    async () => {
        await run('site:build', 'pnpm', ['site:build'])
        await run('docs:check', 'pnpm', ['docs:check'])
    },
    () => run('check:examples', 'pnpm', ['check:examples']),
    () => run('deps:check', 'pnpm', ['deps:check']),
])
