import { readFile, readdir, writeFile } from 'fs/promises'
import { spawnSync } from 'child_process'
import { basename, join } from 'path'
import { codeToHtml } from 'shiki'

const examplesDir = 'examples'
const outDir = 'docs/assets/examples'
const themes = ['dark', 'light'] as const
const files = (await readdir(examplesDir))
    .filter((file) => file.endsWith('.tsx'))
    .sort()

const manifest: Array<{ name: string; source: string; outputs: string[] }> = []
const sources: Array<{ name: string; title: string; source: string; code: string; html: string }> = []

function titleFor(name: string): string {
    return name
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

for (const file of files) {
    const source = join(examplesDir, file)
    const result = spawnSync(process.execPath, [
        'dist/cli.js',
        'render',
        source,
        '--out',
        outDir,
        '--theme',
        themes.join(','),
        '--watermark',
        'Vizmatic',
        '--force',
    ], {
        stdio: 'inherit',
    })

    if (result.status !== 0) {
        process.exit(result.status ?? 1)
    }

    const name = basename(file, '.tsx')
    const code = await readFile(source, 'utf8')
    const html = await codeToHtml(code, {
        lang: 'tsx',
        theme: 'github-dark',
    })

    sources.push({
        name,
        title: titleFor(name),
        source,
        code,
        html,
    })

    const outputs = themes.map((theme) => `${name}_${theme}.png`)

    if (code.includes('createScenes')) {
        const gifResult = spawnSync(process.execPath, [
            'dist/cli.js',
            'gif',
            source,
            '--out',
            outDir,
            '--theme',
            themes.join(','),
            '--watermark',
            'Vizmatic',
            '--scale',
            '1',
        ], {
            stdio: 'inherit',
        })

        if (gifResult.status !== 0) {
            process.exit(gifResult.status ?? 1)
        }

        outputs.push(...themes.map((theme) => `${name}_${theme}.gif`))
    }

    manifest.push({
        name,
        source,
        outputs,
    })
}

await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(outDir, 'sources.json'), `${JSON.stringify(sources, null, 2)}\n`)
console.log(`rendered ${files.length} example frames in ${themes.join('/')} themes`)
