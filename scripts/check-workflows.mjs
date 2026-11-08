import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

// actionlint is downloaded from a GitHub release on each run. That download fails now and then
// with a gateway error, which is not a finding about the workflows. So try the download again.
// Seconds to wait before each new try. One outage on 2026-11-08 lasted longer than a minute.
const WAITS = [10, 20, 40, 60, 60]
const ATTEMPTS = WAITS.length + 1
const files = readdirSync('.github/workflows').filter((name) => name.endsWith('.yml')).map((name) => `.github/workflows/${name}`)

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const result = spawnSync('github-actionlint', files, { encoding: 'utf8', shell: process.platform === 'win32' })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    if (result.error) throw result.error
    const download = /Download failed/.test(output)
    if (result.status === 0 || !download || attempt === ATTEMPTS) {
        process.stdout.write(output)
        process.exit(result.status ?? 1)
    }
    const wait = WAITS[attempt - 1]
    console.error(`${output.trim()}\nThe download of actionlint failed (attempt ${attempt} of ${ATTEMPTS}). Trying again in ${wait} s.`)
    await sleep(wait * 1000)
}
