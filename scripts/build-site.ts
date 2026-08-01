import { readFile, writeFile } from 'fs/promises'
import { codeToHtml } from 'shiki'
import { buildPlayground } from './build-playground'
import { catalogComponentCount, componentCatalog } from './component-catalog'

const templatePath = 'docs/index.template.html'
const outPath = 'docs/index.html'
const componentsTemplatePath = 'docs/components.template.html'
const componentsOutPath = 'docs/components.html'
const promptPath = 'PROMPT.md'
const docsPromptPath = 'docs/PROMPT.md'

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

function renderComponentCatalog(): string {
    return componentCatalog.map((category) => {
        const components = category.components.map((component) => {
            const search = `${component.name} ${component.description}`.toLowerCase()
            return [
                `<article class="catalog-item" data-catalog-item data-catalog-search="${encodeHtml(search)}">`,
                `<code>${encodeHtml(component.name)}</code>`,
                `<p>${encodeHtml(component.description)}</p>`,
                '</article>',
            ].join('')
        }).join('\n')

        return [
            `<section class="catalog-group" data-catalog-group="${encodeHtml(category.id)}">`,
            '<div class="catalog-group-heading">',
            '<div>',
            `<h3>${encodeHtml(category.label)}</h3>`,
            `<p>${encodeHtml(category.description)}</p>`,
            '</div>',
            `<span>${category.components.length} components</span>`,
            '</div>',
            '<div class="catalog-group-layout">',
            '<div class="catalog-preview">',
            `<img loading="lazy" decoding="async" data-theme-image src="assets/examples/${encodeHtml(category.source)}_dark.png" alt="${encodeHtml(category.label)} component catalog rendered by Vizmatic">`,
            `<button class="source-button" type="button" data-source="${encodeHtml(category.source)}" aria-label="View source for ${encodeHtml(category.label)} catalog" title="View source">${sourceIcon}</button>`,
            '</div>',
            `<div class="catalog-items">${components}</div>`,
            '</div>',
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
const catalogReplacements = (template: string) => template
    .replaceAll('{{COMPONENT_COUNT}}', String(catalogComponentCount))
    .replace('{{COMPONENT_FILTERS}}', renderCatalogFilters)
    .replace('{{COMPONENT_CATALOG}}', renderComponentCatalog)
const indexTemplate = catalogReplacements((await readFile(templatePath, 'utf8'))
    .replace('{{PROMPT_MD}}', () => encodeHtml(prompt)))
const componentsTemplate = catalogReplacements(await readFile(componentsTemplatePath, 'utf8'))
const [highlightedIndex, highlightedComponents] = await Promise.all([
    replaceAsync(indexTemplate, /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g),
    replaceAsync(componentsTemplate, /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g),
])
const output = highlightedIndex.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${generatedNotice(templatePath)}\n`)
const componentsOutput = highlightedComponents.replace(
    '<!DOCTYPE html>\n',
    `<!DOCTYPE html>\n${generatedNotice(componentsTemplatePath)}\n`,
)

await Promise.all([
    writeFile(outPath, output),
    writeFile(componentsOutPath, componentsOutput),
    writeFile(docsPromptPath, prompt),
])
console.log(`built ${outPath}, ${componentsOutPath}, and ${docsPromptPath}`)
