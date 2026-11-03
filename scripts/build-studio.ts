import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const out = 'docs/assets/studio'

interface CatalogEntry {
    id?: string
    file?: string
    name?: string
    slug?: string
    title?: string
    description?: string
    summary?: string
}

/** Copy hand-written films so people can open them in the code editor. */
async function copyFilmCatalog(): Promise<number> {
    let raw: string
    try {
        raw = await readFile('examples/films/catalog.json', 'utf8')
    } catch {
        await writeFile(`${out}/films.json`, '[]\n')
        return 0
    }
    const parsed = JSON.parse(raw) as CatalogEntry[] | { films?: CatalogEntry[] }
    const list = Array.isArray(parsed) ? parsed : parsed.films ?? []
    const films: { id: string; title: string; description: string; file: string; poster?: string }[] = []
    await mkdir(`${out}/films`, { recursive: true })
    for (const entry of list) {
        const stem = (entry.id ?? entry.slug ?? entry.name ?? entry.file?.replace(/\.tsx?$/, '') ?? '').toString()
        if (!stem) continue
        const file = entry.file ?? `${stem}.ts`
        const source = await readFile(`examples/films/${file}`, 'utf8').catch(() => null)
        // The sandbox only provides vizmatic/stage, so films with other imports stay out of the list.
        if (source === null) continue
        const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
        if (imports.some((name) => name !== 'vizmatic/stage')) continue
        await writeFile(`${out}/films/${stem}.tsx`, source)
        // Posters are optional: the rendered films may not be built yet.
        const poster = await access(`docs/assets/films/${stem}.png`).then(() => `assets/films/${stem}.png`, () => undefined)
        films.push({
            id: stem, title: entry.title ?? stem, description: entry.summary ?? entry.description ?? '', file: `${stem}.tsx`,
            ...(poster ? { poster } : {}),
        })
    }
    await writeFile(`${out}/films.json`, `${JSON.stringify(films, null, 2)}\n`)
    return films.length
}

/** Bundle the Studio and write its page. The result is static files with no server. */
export async function buildStudio(): Promise<{ films: number }> {
    await rm(out, { recursive: true, force: true })
    await mkdir(`${out}/assets/fonts`, { recursive: true })
    await build({
        entryPoints: { studio: 'src/studio/main.ts' },
        bundle: true,
        splitting: true,
        format: 'esm',
        target: 'es2022',
        platform: 'browser',
        outdir: out,
        minify: true,
        chunkNames: '[name]-[hash]',
        alias: { 'vizmatic/stage': './src/stage/index.ts' },
        logLevel: 'warning',
    })
    // The sandbox receives this file as text and has no way to load chunks, so it is a single script.
    await build({
        entryPoints: { 'sandbox-runtime': 'src/studio/sandbox-runtime.ts' },
        bundle: true,
        format: 'iife',
        target: 'es2022',
        platform: 'browser',
        outdir: out,
        minify: true,
        alias: { 'vizmatic/stage': './src/stage/index.ts' },
        // The asset base is set explicitly at start up, so the module URL is never read here.
        define: { 'import.meta.url': 'undefined' },
        logLevel: 'warning',
    })
    for (const font of ['Inter-Regular.ttf', 'Inter-SemiBold.ttf', 'Inter-Bold.ttf', 'JetBrainsMono-Regular.ttf', 'InstrumentSerif-Regular.ttf', 'InstrumentSerif-Italic.ttf']) {
        await copyFile(`assets/fonts/${font}`, `${out}/assets/fonts/${font}`)
    }
    const films = await copyFilmCatalog()
    const template = await readFile('docs/studio.template.html', 'utf8')
    await writeFile('docs/studio.html', `<!-- Generated from docs/studio.template.html by scripts/build-studio.ts. Edit the template. -->\n${template}`)
    return { films }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
    const { films } = await buildStudio()
    console.log(`Built the Studio into ${out} with ${films} film(s) from the catalog`)
}
