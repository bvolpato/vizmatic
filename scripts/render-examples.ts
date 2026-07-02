import { readdir, writeFile } from 'fs/promises'
import { spawnSync } from 'child_process'
import { basename, join } from 'path'

const examplesDir = 'examples'
const outDir = 'docs/assets/examples'
const files = (await readdir(examplesDir))
    .filter((file) => file.endsWith('.tsx'))
    .sort()

const manifest: Array<{ name: string; source: string; outputs: string[] }> = []

for (const file of files) {
    const source = join(examplesDir, file)
    const result = spawnSync(process.execPath, [
        'dist/cli.js',
        'render',
        source,
        '--out',
        outDir,
        '--theme',
        'dark',
        '--brand',
        'Vizmatic',
        '--force',
    ], {
        stdio: 'inherit',
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }

    const name = basename(file, '.tsx')
    manifest.push({
        name,
        source,
        outputs: [`${name}_dark.png`],
    })
}

await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`rendered ${files.length} example frames`)
