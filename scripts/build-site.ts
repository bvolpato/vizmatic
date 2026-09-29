import { copyFile, mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { codeToHtml } from 'shiki'
import { buildPlayground } from './build-playground'
import { catalogComponentCount, componentCatalog, type ComponentCatalogCategory } from './component-catalog'

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

await mkdir('docs/assets/licenses', { recursive: true })
await Promise.all([
    copyFile('assets/THIRD_PARTY_LICENSES.md', 'docs/assets/THIRD_PARTY_LICENSES.md'),
    ...(await readdir('assets/licenses')).map((name) => copyFile('assets/licenses/' + name, 'docs/assets/licenses/' + name)),
])

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

function decodeHtml(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
}

function getAttribute(attrs: string, name: string): string | undefined {
    return attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

function removeAttribute(attrs: string, name: string): string {
    return attrs.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), '')
}

function formatAttributes(attrs: string): string {
    const trimmed = attrs.trim()
    return trimmed ? ` ${trimmed}` : ''
}

const sourceIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></svg>'

function renderComponentItems(category: ComponentCatalogCategory): string {
    return category.components.map((component) => {
        const search = (component.name + ' ' + component.description + ' ' + category.label).toLowerCase()
        const playgroundUrl = 'playground.html#vizmatic-playground=' + encodeURIComponent(component.example)
        return [
            '<article class="catalog-item" data-catalog-item data-catalog-search="' + encodeHtml(search) + '">',
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

function renderComponentCatalog(includePreviews = true): string {
    return componentCatalog.map((category) => {
        const components = renderComponentItems(category)
        const count = category.components.length
        return [
            '<section class="catalog-group" data-catalog-group="' + encodeHtml(category.id) + '">',
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

async function highlightCodeBlock(_match: string, beforeDataAttr: string, lang: string, afterDataAttr: string, codeAttrs: string, encodedCode: string): Promise<string> {
    const rawPreAttrs = `${beforeDataAttr}${afterDataAttr}`
    const originalClass = getAttribute(rawPreAttrs, 'class')
    const preAttrs = removeAttribute(removeAttribute(rawPreAttrs, 'class'), 'tabindex')
    const classes = ['shiki', 'shiki-themes', 'github-light-high-contrast', 'github-dark-high-contrast', originalClass].filter(Boolean).join(' ')
    const code = decodeHtml(encodedCode)
    const highlighted = await codeToHtml(code, {
        lang,
        themes: {
            light: 'github-light-high-contrast',
            dark: 'github-dark-high-contrast',
        },
        defaultColor: false,
    })

    return highlighted
        .replace(/^<pre[^>]*>/, `<pre${formatAttributes(preAttrs)} data-shiki="${lang}" class="${classes}" tabindex="0">`)
        .replace('<code>', `<code${codeAttrs}>`)
}

async function replaceAsync(input: string, pattern: RegExp): Promise<string> {
    const replacements = await Promise.all(
        Array.from(input.matchAll(pattern), ([match, beforeDataAttr, lang, afterDataAttr, codeAttrs, encodedCode]) =>
            highlightCodeBlock(match, beforeDataAttr, lang, afterDataAttr, codeAttrs, encodedCode),
        ),
    )
    let index = 0
    return input.replace(pattern, () => replacements[index++] ?? '')
}

await buildPlayground()

const prompt = await readFile(promptPath, 'utf8')
const benchmarkTemplate = await readFile(benchmarksTemplatePath, 'utf8')
const benchmarkResults = JSON.parse(await readFile(benchmarkResultsPath, 'utf8')) as BenchmarkResults
const catalogReplacements = (template: string) => template
    .replaceAll('{{COMPONENT_COUNT}}', String(catalogComponentCount))
    .replace('{{COMPONENT_FILTERS}}', renderCatalogFilters)
    .replace('{{COMPONENT_CATALOG}}', () => renderComponentCatalog())
    .replace('{{HOME_COMPONENT_CATALOG}}', () => renderComponentCatalog(false))
const indexTemplate = catalogReplacements((await readFile(templatePath, 'utf8'))
    .replace('{{PROMPT_MD}}', () => encodeHtml(prompt)))
const componentsTemplate = catalogReplacements(await readFile(componentsTemplatePath, 'utf8'))
const playgroundTemplate = await readFile(playgroundTemplatePath, 'utf8')
const [highlightedIndex, highlightedComponents] = await Promise.all([
    replaceAsync(indexTemplate, /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g),
    replaceAsync(componentsTemplate, /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g),
])
const output = highlightedIndex.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${generatedNotice(templatePath)}\n`)
const componentsOutput = highlightedComponents.replace(
    '<!DOCTYPE html>\n',
    `<!DOCTYPE html>\n${generatedNotice(componentsTemplatePath)}\n`,
)
const playgroundOutput = playgroundTemplate.replace(
    '<!DOCTYPE html>\n',
    `<!DOCTYPE html>\n${generatedNotice(playgroundTemplatePath)}\n`,
)
const benchmarksOutput = benchmarkTemplate
    .replaceAll('{{GENERATED_AT}}', () => encodeHtml(benchmarkResults.generatedAt))
    .replace('{{ENVIRONMENT}}', () => renderBenchmarkEnvironment(benchmarkResults))
    .replace('{{QUALITY_SUMMARY}}', () => renderBenchmarkSummary(benchmarkResults))
    .replace('{{QUALITY_FINDINGS}}', () => renderBenchmarkFindings(benchmarkResults))
    .replace('{{BENCHMARK_ROWS}}', () => renderBenchmarkRows(benchmarkResults))
    .replace(
        '<!DOCTYPE html>\n',
        `<!DOCTYPE html>\n${generatedNotice(benchmarksTemplatePath)}\n`,
    )

await Promise.all([
    writeFile(outPath, output),
    writeFile(componentsOutPath, componentsOutput),
    writeFile(playgroundOutPath, playgroundOutput),
    writeFile(benchmarksOutPath, benchmarksOutput),
    writeFile(docsPromptPath, prompt),
])
console.log(`built ${outPath}, ${componentsOutPath}, ${playgroundOutPath}, ${benchmarksOutPath}, and ${docsPromptPath}`)
