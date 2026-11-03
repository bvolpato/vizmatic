import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { buildPlayground } from './build-playground'
import { catalogComponentCount, componentCatalog, type ComponentCatalogCategory } from './component-catalog'
import { buildAgentDocs } from './build-agent-docs'
import { buildLogo } from './build-logo'
import { buildStage } from './build-stage'
import { prepareGuides, writeGuides } from './build-guides'
import { buildSiteMedia } from './build-site-media'
import { applySiteShell, configureSiteShell, registerSitePages, sitePages } from './site-shell'
import { highlight, highlightPage } from './site-highlight'
import { escapeHtml } from './site-markdown'
import { formatDuration, loadFilmCatalog, renderClaims, renderFigures, renderFilmWall } from './site-content'
import { toPlaygroundExample } from './playground-example'

const templatePath = 'docs/index.template.html'
const outPath = 'docs/index.html'
const componentsTemplatePath = 'docs/components.template.html'
const componentsOutPath = 'docs/components.html'
const playgroundTemplatePath = 'docs/playground.template.html'
const playgroundOutPath = 'docs/playground.html'
const benchmarksTemplatePath = 'docs/benchmarks.template.html'
const benchmarksOutPath = 'docs/benchmarks.html'
const benchmarkResultsPath = 'docs/assets/benchmarks/results.json'
const promptPath = 'PROMPT.md'
const docsPromptPath = 'docs/PROMPT.md'
const agentsTemplatePath = 'docs/agents.template.html'
const agentsOutPath = 'docs/agents.html'
const filmsTemplatePath = 'docs/films.template.html'
const examplesTemplatePath = 'docs/examples.template.html'
const studioTemplatePath = 'docs/studio.template.html'

const exists = (path: string) => access(path).then(() => true, () => false)
const hasStudio = await exists(studioTemplatePath)
configureSiteShell({ studio: hasStudio })

await mkdir('docs/assets/licenses', { recursive: true })
await Promise.all([
    copyFile('assets/THIRD_PARTY_LICENSES.md', 'docs/assets/THIRD_PARTY_LICENSES.md'),
    ...(await readdir('assets/licenses')).map((name) => copyFile('assets/licenses/' + name, 'docs/assets/licenses/' + name)),
])
await mkdir('docs/assets/fonts', { recursive: true })
await Promise.all(['Inter-Regular.woff2', 'Inter-SemiBold.woff2', 'Inter-Bold.woff2', 'JetBrainsMono-Regular.woff2', 'InstrumentSerif-Regular.woff2', 'InstrumentSerif-Italic.woff2']
    .map((name) => copyFile('assets/site-fonts/' + name, 'docs/assets/fonts/' + name)))
await buildLogo()

function generatedNotice(source: string): string {
    return `<!-- Generated from ${source} by pnpm site:build. Edit template. -->`
}

function encodeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}


const sourceIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>'

function renderComponentItems(category: ComponentCatalogCategory): string {
    return category.components.map((component) => {
        const search = (component.name + ' ' + component.description + ' ' + category.label).toLowerCase()
        const playgroundUrl = 'playground.html#component-' + component.name
        return [
            '<article class="catalog-item" id="reference-component-' + encodeHtml(component.name) + '" data-catalog-item data-catalog-search="' + encodeHtml(search) + '">',
            '<div class="catalog-item-copy">',
            '<code>' + encodeHtml(component.name) + '</code>',
            '<p>' + encodeHtml(component.description) + '</p>',
            '</div>',
            '<div class="catalog-component-actions">',
            '<button class="component-copy-button" type="button" data-copy-component data-component-source="' + encodeHtml(component.example) + '" aria-live="polite" aria-label="Copy ' + encodeHtml(component.name) + ' example source">Copy source</button>',
            '<a class="component-try-link" href="' + encodeHtml(playgroundUrl) + '">Try / edit <span aria-hidden="true">→</span></a>',
            '</div>',
            '</article>',
        ].join('')
    }).join('\n')
}

const explorerTemplate = await readFile('docs/component-explorer.template.html', 'utf8')
const explorerChoices = componentCatalog.map((category) => `<section class="explorer-choice-group" data-explorer-category="${category.id}"><h4>${encodeHtml(category.label)}</h4>${category.components.map((component) => `<button type="button" id="component-${component.name}" data-explore-component="${component.name}" data-explorer-search="${encodeHtml((component.name + ' ' + component.description + ' ' + category.label).toLowerCase())}" aria-pressed="false" title="${encodeHtml(component.description)}"><span>${component.name}</span><span aria-hidden="true">↗</span></button>`).join('')}</section>`).join('')
const explorerOptions = '<option value="custom" disabled>Custom scene</option>' + componentCatalog.map((category) => `<optgroup label="${encodeHtml(category.label)}">${category.components.map((component) => `<option value="${component.name}">${component.name}</option>`).join('')}</optgroup>`).join('')
const explorer = explorerTemplate.replace('{{COMPONENT_CHOICES}}', () => explorerChoices).replaceAll('{{COMPONENT_OPTIONS}}', () => explorerOptions)

function renderComponentCatalog(includePreviews = true): string {
    return componentCatalog.map((category) => {
        const components = renderComponentItems(category)
        const count = category.components.length
        return [
            '<section class="catalog-group" id="category-' + encodeHtml(category.id) + '" data-catalog-group="' + encodeHtml(category.id) + '">',
            '<div class="catalog-group-heading">',
            '<div>',
            '<h3>' + encodeHtml(category.label) + '</h3>',
            '<p>' + encodeHtml(category.description) + '</p>',
            '</div>',
            '<span>' + count + ' component' + (count === 1 ? '' : 's') + '</span>',
            '</div>',
            includePreviews
                ? [
                    '<div class="catalog-group-layout">',
                    '<div class="catalog-preview">',
                    '<img loading="lazy" decoding="async" data-theme-image src="assets/examples/' + encodeHtml(category.source) + '_dark.png" alt="' + encodeHtml(category.label) + ' component catalog rendered by Vizmatic">',
                    '<button class="source-button" type="button" data-source="' + encodeHtml(category.source) + '" aria-label="View source for ' + encodeHtml(category.label) + ' catalog" title="View source">' + sourceIcon + '</button>',
                    '</div>',
                    '<div class="catalog-items">' + components + '</div>',
                    '</div>',
                ].join('\n')
                : '<div class="catalog-items catalog-items-home">' + components + '</div>',
            '</section>',
        ].join('\n')
    }).join('\n')
}

function renderCatalogFilters(): string {
    return [
        '<button type="button" data-catalog-filter="all" aria-pressed="true">All</button>',
        ...componentCatalog.map((category) =>
            `<button type="button" data-catalog-filter="${encodeHtml(category.id)}" aria-pressed="false">${encodeHtml(category.label)}</button>`),
    ].join('\n')
}

interface BenchmarkResults {
    generatedAt: string
    revision: { commit: string; workingTree: 'clean' | 'modified' }
    environment: {
        node: string
        platform: string
        release: string
        arch: string
        cpuModel: string
        cpuCount: number
        totalMemoryBytes: number
    }
    methodology: {
        measuredRunsPerExampleTheme: number
        warmupRunsPerExampleTheme: number
        timing: string
        peakRss: string
        scale: number
        renderExamples: string[]
    }
    qualityCheck: {
        examples: { checked: number; available: number }
        themesChecked: number
        diagnostics: { errors: number; warnings: number; info: number }
        findings: Array<{
            source: string
            theme?: string
            severity: 'error' | 'warning' | 'info'
            code: string
            message: string
        }>
    }
    renders: Array<{
        example: string
        source: string
        theme: string
        runs: Array<{
            renderMs: number
            peakRssBytes: number
            pngBytes: number
            pixelWidth: number
            pixelHeight: number
        }>
        summary: {
            medianRenderMs: number
            p95RenderMs: number
            peakRssBytes: number
            pngBytes: number
            pixelWidth: number
            pixelHeight: number
        }
    }>
}

function renderBenchmarkEnvironment(results: BenchmarkResults): string {
    const environment = results.environment
    const memoryGiB = (environment.totalMemoryBytes / (1024 ** 3)).toFixed(1)
    const rows = [
        ['Runtime', `Node.js ${environment.node}`],
        ['Machine', `${environment.cpuModel} · ${environment.cpuCount} logical CPUs · ${memoryGiB} GiB RAM`],
        ['OS', `${environment.platform} ${environment.release} · ${environment.arch}`],
        ['Source', `${results.revision.commit} · working tree ${results.revision.workingTree}`],
    ]

    return rows.map(([label, value]) => `<div><dt>${encodeHtml(label)}</dt><dd>${encodeHtml(value)}</dd></div>`).join('\n')
}

function renderBenchmarkRows(results: BenchmarkResults): string {
    return results.renders.map((render) => [
        '<tr>',
        `<th scope="row">${encodeHtml(render.example)}</th>`,
        `<td>${encodeHtml(render.theme)}</td>`,
        `<td>${render.summary.medianRenderMs.toFixed(1)} ms</td>`,
        `<td>${render.summary.p95RenderMs.toFixed(1)} ms</td>`,
        `<td>${(render.summary.peakRssBytes / (1024 ** 2)).toFixed(1)} MiB</td>`,
        `<td>${render.summary.pixelWidth} × ${render.summary.pixelHeight}</td>`,
        `<td>${(render.summary.pngBytes / 1024).toFixed(1)} KiB</td>`,
        '</tr>',
    ].join('')).join('\n')
}

function renderBenchmarkFindings(results: BenchmarkResults): string {
    const findings = results.qualityCheck.findings.filter((finding) => finding.severity !== 'info')
    if (findings.length === 0) {
        return `<p class="benchmark-clean">No check errors or warnings across ${results.qualityCheck.examples.checked} examples and ${results.qualityCheck.themesChecked} theme renders.</p>`
    }

    return [
        '<div class="benchmark-table-wrap"><table class="benchmark-table">',
        '<thead><tr><th scope="col">Severity</th><th scope="col">Example</th><th scope="col">Theme</th><th scope="col">Code</th><th scope="col">Finding</th></tr></thead>',
        '<tbody>',
        ...findings.map((finding) => `<tr><td>${encodeHtml(finding.severity)}</td><td>${encodeHtml(finding.source)}</td><td>${encodeHtml(finding.theme ?? 'all')}</td><td><code>${encodeHtml(finding.code)}</code></td><td>${encodeHtml(finding.message)}</td></tr>`),
        '</tbody></table></div>',
    ].join('\n')
}

function renderBenchmarkSummary(results: BenchmarkResults): string {
    const { errors, warnings, info } = results.qualityCheck.diagnostics
    return [
        `<span><strong>${results.qualityCheck.examples.checked}/${results.qualityCheck.examples.available}</strong> examples checked</span>`,
        `<span><strong>${results.qualityCheck.themesChecked}</strong> dark/light render checks</span>`,
        `<span><strong>${errors}</strong> errors</span>`,
        `<span><strong>${warnings}</strong> warnings</span>`,
        `<span><strong>${info}</strong> informational notes</span>`,
    ].join('\n')
}

await buildPlayground()

const prompt = await readFile(promptPath, 'utf8')
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
interface ExampleSource {
    name: string
    title: string
    source: string
    code: string
    html: { dark: string; light: string }
}
/**
 * A density variant re-exports another example and overrides its size and density. The builder
 * runs one source with no imports, so it opens the base example with those settings applied.
 */
async function playgroundCodeFor(path: string): Promise<string> {
    const source = await readFile(path, 'utf8')
    const base = source.match(/from ['"]\.\/([\w-]+)['"]/)?.[1]
    const settings = source.match(/^export const (?:density|width|height) = .+$/gm)
    if (!base || !settings || !/^export const density\b/m.test(source)) return toPlaygroundExample(source)
    const code = toPlaygroundExample(await readFile(`examples/${base}.tsx`, 'utf8'))
    // A variant that passes its density to a shared function keeps that argument too.
    const argument = source.match(/createAt\(theme, '(\w+)'\)/)?.[1]
    const body = code.replace(/^(?:width|height|density) = .+\n/gm, '')
        .replace(/createAt\(theme, '\w+'\)/, (call) => argument ? `createAt(theme, '${argument}')` : call)
    return `${settings.map((line) => line.replace('export const ', '')).join('\n')}\n${body}`
}

const sources = JSON.parse(await readFile('docs/assets/examples/sources.json', 'utf8')) as ExampleSource[]
const sourceByName = new Map(sources.map((source) => [source.name, source]))
await mkdir('docs/assets/sources', { recursive: true })
await Promise.all(sources.map(async (source) => {
    const playgroundCode = await playgroundCodeFor(source.source)
    await writeFile(`docs/assets/sources/${source.name}.json`, JSON.stringify({ ...source, playgroundCode }))
}))

const prepared = await prepareGuides()
await buildStage({ demos: prepared.demos })
// Studio is its own application with its own page. The site only links to it.
if (hasStudio) {
    const { buildStudio } = await import('./build-studio')
    await buildStudio()
    registerSitePages([{ file: 'studio.html', title: 'Studio | Vizmatic', description: 'Build and animate films in one browser tab: a timeline, an inspector, live code, and frame-exact MP4 export.' }])
}
await buildSiteMedia()
const films = await loadFilmCatalog()

function preparePage(template: string, file: string): string {
    return applySiteShell(template, file)
        .replaceAll('{{VERSION}}', packageJson.version)
        .replaceAll('{{STUDIO_HREF}}', hasStudio ? 'studio.html' : 'playground.html')
        .replace(/\{\{EXAMPLE_URL:([\w-]+)\}\}/g, (_match, name: string) => {
            const source = sourceByName.get(name)
            if (!source) throw new Error(`Unknown website example: ${name}`)
            return encodeHtml('playground.html?example=' + encodeURIComponent(source.name))
        })
}

// ── Film pages ──────────────────────────────────────────────────────────────

registerSitePages(await Promise.all(films.map(async (film) => ({
    file: `film/${film.id}.html`,
    title: `${film.title} | Vizmatic films`,
    description: film.summary,
    ...(await exists(`docs/assets/site/posters/${film.id}_dark.webp`) ? { image: `assets/site/posters/${film.id}_dark.webp` } : {}),
}))))
await rm('docs/film', { recursive: true, force: true })
await mkdir('docs/film', { recursive: true })
await Promise.all(films.map(async (film, index) => {
    const file = `film/${film.id}.html`
    const sourcePath = (await exists(`examples/films/${film.id}.ts`)) ? `examples/films/${film.id}.ts` : `examples/films/${film.id}.tsx`
    const source = await readFile(sourcePath, 'utf8')
    const code = await highlight(source, sourcePath.endsWith('x') ? 'tsx' : 'ts')
    const previous = films[index - 1]
    const next = films[index + 1]
    const meta = [film.topic, formatDuration(film.duration)].filter(Boolean).join(', ')
    const page = applySiteShell(`<!DOCTYPE html>
<html lang="en">
<head>
  {{SITE_HEAD}}
</head>
<body>
  {{SITE_NAV}}
  <main id="main-content" tabindex="-1">
    <article class="section" style="padding-top:0" data-film-page>
      <header class="film-page-head"><h1>${escapeHtml(film.title)}</h1><span class="meta">${escapeHtml(meta)}</span></header>
      <vz-film src="../assets/stage/films/${film.id}.js" autoplay${film.look && film.look !== 'midnight' ? ` data-fixed-look look="${escapeHtml(film.look)}"` : ''} label="${escapeHtml(film.summary || film.title)}"></vz-film>
      <ol class="chapter-list" data-chapters hidden></ol>
      <p class="film-page-summary">${escapeHtml(film.summary)}</p>
      <div class="film-actions">
        <a class="button primary" href="../assets/films/${film.id}.mp4" download>Download MP4</a>
        <a class="button" href="https://github.com/bvolpato/vizmatic/blob/main/${sourcePath}">Source on GitHub</a>
        ${hasStudio ? `<a class="button" href="../studio.html?film=${film.id}">Open in the Studio</a>` : ''}
      </div>
      <details class="film-source"><summary>Read the source</summary>${code}</details>
      <nav class="film-pager" aria-label="Other films">${previous ? `<a href="${previous.id}.html"><small>Previous</small>${escapeHtml(previous.title)}</a>` : ''}${next ? `<a href="${next.id}.html"><small>Next</small>${escapeHtml(next.title)}</a>` : ''}</nav>
    </article>
  </main>
  {{SITE_FOOTER}}
  {{SITE_DIALOGS}}
</body>
</html>
`, file)
    await writeFile(`docs/${file}`, `<!DOCTYPE html>\n<!-- Generated from examples/films/catalog.json by scripts/build-site.ts. -->\n${page.replace('<!DOCTYPE html>\n', '')}`)
}))

// ── Guides and agent files ──────────────────────────────────────────────────

const guideSearch = await writeGuides(prepared, (page) => hasStudio ? page : page.replaceAll('../studio.html', '../playground.html'))
await buildAgentDocs()

// ── Landing page content ────────────────────────────────────────────────────

const besideSource = await readFile('scripts/site-films/beside.ts', 'utf8')
const besideLines = besideSource.split('\n').flatMap((line, index) => /^\s*s\.play\(/.test(line) ? [index] : [])
const heroFilm = (await exists('examples/films/vizmatic-title.ts')) ? 'assets/stage/films/vizmatic-title.js' : 'assets/stage/site/scrub.js'
const figures = await renderFigures([
    { name: 'production-system-map', label: 'System map', alt: 'A dense production system map with services, data stores, regions, ports, and live metrics', caption: 'A production system on one page: services, boundaries, ports, protocols, and live numbers.' },
    { name: 'production-system-map-presentation', label: 'Same source, larger', alt: 'The same production system map rendered at presentation density, with larger type and strokes', caption: 'The same source at presentation density. One prop changes, and nothing else does.' },
    { name: 'system-architecture', label: 'Architecture', alt: 'System architecture diagram with nested production boundaries and labeled relationships', caption: 'Nested boundaries, typed relationships, and labeled protocols.' },
    { name: 'aurora-incident', label: 'Incident room', alt: 'A fictional reliability drill with routed services, recovery signals, and a timeline', caption: 'Routing, recovery metrics, and a response timeline on one page.' },
    { name: 'eval-dashboard', label: 'Dashboard', alt: 'An evaluation dashboard with charts and tables', caption: 'Charts and tables that share one scale of type and rule.' },
])
const landingWall = await renderFilmWall(films, '', { limit: 6 })
const fullWall = await renderFilmWall(films, '')
const claims = await renderClaims(catalogComponentCount)

const benchmarkTemplate = await readFile(benchmarksTemplatePath, 'utf8')
const benchmarkResults = JSON.parse(await readFile(benchmarkResultsPath, 'utf8')) as BenchmarkResults
const catalogReplacements = (template: string) => template
    .replace('{{COMPONENT_EXPLORER}}', () => explorer)
    .replaceAll('{{COMPONENT_COUNT}}', String(catalogComponentCount))
    .replace('{{COMPONENT_FILTERS}}', renderCatalogFilters)
    .replace('{{COMPONENT_CATALOG}}', () => renderComponentCatalog())
    .replace('{{HOME_COMPONENT_CATALOG}}', () => renderComponentCatalog(false))

const notice = (source: string, html: string) => html.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${generatedNotice(source)}\n`)

const landing = (await readFile(templatePath, 'utf8'))
    .replace('{{HERO_FILM}}', heroFilm)
    .replace('{{BESIDE_SOURCE}}', () => encodeHtml(besideSource.trimEnd()))
    .replace('{{BESIDE_LINES}}', besideLines.join(','))
    .replace('{{FILM_WALL}}', () => landingWall)
    .replace('{{FIGURES}}', () => figures)
    .replace('{{CLAIMS}}', () => claims)
const filmsPage = (await readFile(filmsTemplatePath, 'utf8')).replace('{{FILM_WALL_ALL}}', () => fullWall)
const examplesPage = await readFile(examplesTemplatePath, 'utf8')
const componentsTemplate = catalogReplacements(await readFile(componentsTemplatePath, 'utf8'))
const playgroundTemplate = catalogReplacements(await readFile(playgroundTemplatePath, 'utf8'))
const agentsTemplate = (await readFile(agentsTemplatePath, 'utf8')).replace('{{PROMPT_MD}}', () => encodeHtml(prompt))
const benchmarksOutput = preparePage(benchmarkTemplate, 'benchmarks.html')
    .replaceAll('{{GENERATED_AT}}', () => encodeHtml(benchmarkResults.generatedAt))
    .replace('{{ENVIRONMENT}}', () => renderBenchmarkEnvironment(benchmarkResults))
    .replace('{{QUALITY_SUMMARY}}', () => renderBenchmarkSummary(benchmarkResults))
    .replace('{{QUALITY_FINDINGS}}', () => renderBenchmarkFindings(benchmarkResults))
    .replace('{{BENCHMARK_ROWS}}', () => renderBenchmarkRows(benchmarkResults))

// ── Search and sitemap ──────────────────────────────────────────────────────

const searchIndex = [
    ...sitePages.filter((page) => !page.file.startsWith('docs/') && !page.file.startsWith('film/')).map((page) => ({ title: page.title.split(' | ')[0], description: page.description, url: page.file, category: 'Page' })),
    ...films.map((film) => ({ title: film.title, description: film.summary, url: `film/${film.id}.html`, category: 'Film' })),
    ...guideSearch.map(({ title, description, url, category }) => ({ title, description, url, category })),
    ...componentCatalog.flatMap((category) => category.components.map((component) => ({
        title: component.name,
        description: component.description,
        url: 'components.html#component-' + component.name,
        category: category.label,
    }))),
    // A -presentation file is another size of one example, and that example's card links to it.
    ...sources.filter((source) => !source.name.startsWith('catalog-') && !source.name.endsWith('-presentation')).map((source) => ({
        title: source.title,
        description: 'View and edit the ' + source.title.toLowerCase() + ' example.',
        url: 'examples.html#example-' + source.name,
        category: 'Example',
    })),
    { title: 'Agent resources', description: 'Markdown instructions, skills, and a machine-readable component catalog.', url: 'agents.html#resources', category: 'Guide' },
]
await writeFile('docs/search-index.json', JSON.stringify(searchIndex))
await writeFile('docs/sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + sitePages.map((page) => `<url><loc>https://bvolpato.github.io/vizmatic/${page.file === 'index.html' ? '' : page.file}</loc></url>`).join('\n') + '\n</urlset>\n')
await writeFile('docs/robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: https://bvolpato.github.io/vizmatic/sitemap.xml\n')

// ── Pages ───────────────────────────────────────────────────────────────────

const [output, filmsOutput, examplesOutput, componentsOutput, agentsOutput] = await Promise.all([
    highlightPage(preparePage(landing, 'index.html')),
    highlightPage(preparePage(filmsPage, 'films.html')),
    highlightPage(preparePage(examplesPage, 'examples.html')),
    highlightPage(preparePage(componentsTemplate, 'components.html')),
    highlightPage(preparePage(agentsTemplate, 'agents.html')),
])
const playgroundOutput = preparePage(playgroundTemplate, 'playground.html')
const writes: Promise<void>[] = [
    writeFile(outPath, notice(templatePath, output)),
    writeFile('docs/films.html', notice(filmsTemplatePath, filmsOutput)),
    writeFile('docs/examples.html', notice(examplesTemplatePath, examplesOutput)),
    writeFile(componentsOutPath, notice(componentsTemplatePath, componentsOutput)),
    writeFile(playgroundOutPath, notice(playgroundTemplatePath, playgroundOutput)),
    writeFile(benchmarksOutPath, notice(benchmarksTemplatePath, benchmarksOutput)),
    writeFile(agentsOutPath, notice(agentsTemplatePath, agentsOutput)),
    writeFile(docsPromptPath, prompt),
]
await Promise.all(writes)
console.log(`built ${sitePages.length} pages, ${films.length} film pages, and ${Object.keys(prepared.demos).length} guide demos`)
