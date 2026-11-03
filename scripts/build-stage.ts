import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

const out = 'docs/assets/stage'

/** Every font the stage engine can ask for. The browser fetches a fallback only when a film needs it. */
export const STAGE_FONTS = [
    'Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'JetBrainsMono-Regular.ttf',
    'InstrumentSerif-Regular.ttf', 'InstrumentSerif-Italic.ttf',
    'SourceSerif4-24pt-Regular.ttf', 'SourceSerif4-24pt-Italic.ttf',
    'NotoSans-Regular.ttf', 'NotoSansMath-Regular.ttf',
]

async function listSources(directory: string): Promise<string[]> {
    const names = await readdir(directory).catch(() => [] as string[])
    return names.filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts') && !name.startsWith('_'))
}

export interface StageBuildOptions {
    /** Films generated from guide samples, by output name. */
    demos?: Record<string, string>
}

/**
 * Bundle the browser engine, every film, the site's own films, and guide demos
 * into one build. They must share one engine module, because that module holds
 * the clock, and splitting gives them the same copy.
 */
export async function buildStage(options: StageBuildOptions = {}): Promise<string[]> {
    await rm(out, { recursive: true, force: true })
    await mkdir(`${out}/assets/fonts`, { recursive: true })
    const films = await listSources('examples/films')
    const entryPoints: Record<string, string> = { stage: 'src/stage/browser.ts' }
    for (const name of films) entryPoints[`films/${name.replace(/\.tsx?$/, '')}`] = join('examples/films', name)
    for (const name of await listSources('scripts/site-films')) entryPoints[`site/${name.replace(/\.tsx?$/, '')}`] = join('scripts/site-films', name)
    for (const name of await listSources('scripts/site-runtime')) entryPoints[`site/${name.replace(/\.tsx?$/, '')}`] = join('scripts/site-runtime', name)
    for (const [name, path] of Object.entries(options.demos ?? {})) entryPoints[`demos/${name}`] = path
    await build({
        entryPoints,
        bundle: true,
        splitting: true,
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        outdir: out,
        minify: true,
        // Chunks stay beside stage.js, because the engine locates fonts relative to its own module URL.
        chunkNames: '[name]-[hash]',
        alias: { 'vizmatic/stage': './src/stage/browser.ts' },
        logLevel: 'warning',
    })
    await Promise.all(STAGE_FONTS.map((font) => copyFile(`assets/fonts/${font}`, `${out}/assets/fonts/${font}`)))
    return films
}

if (process.argv[1]?.endsWith('build-stage.ts')) {
    const films = await buildStage()
    console.log(`Built the stage engine and ${films.length} film(s) into ${out}`)
}
