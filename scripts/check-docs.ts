import { access, readFile, readdir, stat } from 'fs/promises'
import { basename, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { catalogComponentCount, componentCatalog } from './component-catalog'
import { preparePlaygroundSource } from '../src/playground-source'
import { applyComponentControls, type ComponentControl } from '../src/component-controls'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const htmlPath = join(root, 'docs', 'index.html')
const html = await readFile(htmlPath, 'utf8')
const templateHtml = await readFile(join(root, 'docs', 'index.template.html'), 'utf8')
const componentsHtml = await readFile(join(root, 'docs', 'components.html'), 'utf8')
const componentsTemplateHtml = await readFile(join(root, 'docs', 'components.template.html'), 'utf8')
const playgroundHtml = await readFile(join(root, 'docs', 'playground.html'), 'utf8')
const playgroundTemplateHtml = await readFile(join(root, 'docs', 'playground.template.html'), 'utf8')
const benchmarksHtml = await readFile(join(root, 'docs', 'benchmarks.html'), 'utf8')
const benchmarksTemplateHtml = await readFile(join(root, 'docs', 'benchmarks.template.html'), 'utf8')
const agentsHtml = await readFile(join(root, 'docs', 'agents.html'), 'utf8')
const siteScript = await readFile(join(root, 'docs', 'site.js'), 'utf8')
const skillPath = join(root, 'plugins', 'vizmatic', 'skills', 'vizmatic', 'SKILL.md')
const pluginSkillDir = join(root, 'plugins', 'vizmatic', 'skills', 'vizmatic')
const portableSkillDir = join(root, '.agents', 'skills', 'vizmatic')
const codexPluginPath = join(root, 'plugins', 'vizmatic', '.codex-plugin', 'plugin.json')
const claudePluginPath = join(root, 'plugins', 'vizmatic', '.claude-plugin', 'plugin.json')
const codexMarketplacePath = join(root, '.agents', 'plugins', 'marketplace.json')
const claudeMarketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const galleryAssetUrl = 'https://bvolpato.github.io/vizmatic/assets/examples'
const ncclGalleryAssets = [
    {
        name: 'nccl-broadcast',
        alt: 'Animated NCCL Broadcast: root rank sends one buffer to every rank',
    },
    {
        name: 'nccl-all-reduce',
        alt: 'Animated NCCL AllReduce: every rank reduces values and receives the sum',
    },
    {
        name: 'nccl-all-gather',
        alt: 'Animated NCCL AllGather: every rank receives concatenated tensors',
    },
    {
        name: 'nccl-reduce-scatter',
        alt: 'Animated NCCL ReduceScatter: each rank receives one reduced chunk',
    },
    {
        name: 'nccl-all-to-all',
        alt: 'Animated NCCL AllToAll: every rank exchanges one chunk with every rank',
    },
] as const

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = await Promise.all(entries.map(async (entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return listFiles(path)
        if (entry.isFile()) return [path]
        return []
    }))
    return files.flat()
}

function fail(message: string): never {
    throw new Error(message)
}

const pages = [html, componentsHtml, playgroundHtml, benchmarksHtml, agentsHtml]
const refs = pages.flatMap((page) => Array.from(page.matchAll(/(?:src|href)="([^"]+)"/g)))
    .map((match) => match[1])
    .filter((ref): ref is string => Boolean(ref))
    .filter((ref) => !ref.startsWith('http') && !ref.startsWith('#') && !ref.startsWith('mailto:'))

const missing: string[] = []
for (const ref of refs) {
    const cleanRef = ref.split('#')[0]?.split('?')[0]
    if (!cleanRef) continue
    const target = join(root, 'docs', cleanRef)
    await access(target).catch(() => missing.push(ref))
}

if (missing.length > 0) {
    fail(`missing docs assets:\n${missing.map((ref) => `- ${ref}`).join('\n')}`)
}

for (const page of pages) {
    if (/\{\{(?:SITE_|EXAMPLE_URL:|VERSION|PROMPT_MD|COMPONENT_)/.test(page)) fail('generated site contains unreplaced placeholders')
    if (!/<main\b[^>]*id="main-content"[^>]*tabindex="-1"/.test(page) || !page.includes('href="#main-content"')) fail('every page must provide a focusable skip-link target')
    if (!page.includes('src="site.js"')) fail('every page must load the shared site interactions')
}

const searchIndex = JSON.parse(await readFile(join(root, 'docs', 'search-index.json'), 'utf8')) as Array<{ url: string }>
for (const entry of searchIndex) {
    const [pageName, fragment] = entry.url.split('#')
    const target = await readFile(join(root, 'docs', pageName), 'utf8')
    if (fragment && !Array.from(target.matchAll(/\bid="([^"]+)"/g)).some((match) => match[1] === decodeURIComponent(fragment))) {
        fail(`search result has a missing anchor: ${entry.url}`)
    }
}

const rootPrompt = await readFile(join(root, 'PROMPT.md'), 'utf8')
const docsPrompt = await readFile(join(root, 'docs', 'PROMPT.md'), 'utf8')
if (rootPrompt !== docsPrompt) {
    fail('docs/PROMPT.md must match root PROMPT.md')
}

if (!templateHtml.includes('{{PROMPT_MD}}')) {
    fail('homepage prompt preview must be generated from PROMPT.md')
}

if (html.includes('{{PROMPT_MD}}')) {
    fail('homepage prompt preview contains unreplaced placeholder')
}

if (!html.includes('Vizmatic agent prompt') || !html.includes('Final response') || !html.includes('any overflow or layout fixes made')) {
    fail('homepage prompt preview must include full PROMPT.md')
}

for (const required of [
    'alpha-transparent',
    '--background theme',
    'background={c.bg}',
    'auto-grow',
]) {
    if (!rootPrompt.includes(required) || !html.includes(required)) {
        fail(`docs must mention background mode: ${required}`)
    }
}

if (!rootPrompt.includes('title and subtitle are optional') || !templateHtml.includes('a title when the visual needs them')) {
    fail('docs must mention titleless scenes')
}

const skill = await readFile(skillPath, 'utf8')
if (!skill.includes('name: vizmatic') || !skill.includes('Create and render theme-aware diagrams')) {
    fail('Vizmatic skill frontmatter is missing required metadata')
}

if (skill.includes('TODO')) {
    fail('Vizmatic skill must not contain TODO placeholders')
}

for (const required of [
    'npx skills add bvolpato/vizmatic --skill vizmatic -g -y',
    'Codex',
    'Claude Code',
    'Cursor',
    'OpenCode',
]) {
    if (!templateHtml.includes(required) && !html.includes(required)) {
        fail(`homepage agent skill instructions must include ${required}`)
    }
}

if (!rootPrompt.includes('vizmatic check ./frame.tsx --theme dark,light --json')) {
    fail('agent prompt must include structured validation command')
}

for (const required of [
    'id="playgroundSource"',
    'id="playgroundCanvas"',
    'id="playgroundRunButton"',
    'src="playground.js"',
]) {
    if (!playgroundTemplateHtml.includes(required) && !playgroundHtml.includes(required)) {
        fail(`playground page must include ${required}`)
    }
}

if (!templateHtml.includes('src="playground-redirect.js"') || !html.includes('href="playground.html"')) {
    fail('homepage must redirect legacy shared links and link to the dedicated playground')
}
for (const page of [html, componentsHtml, playgroundHtml]) {
    if (!page.includes('data-component-explorer') || !page.includes('src="playground.js"')) fail('each component explorer must include the live renderer')
    for (const category of componentCatalog) {
        for (const component of category.components) {
            if (!page.includes(`data-explore-component="${component.name}"`)) fail(`component explorer missing ${component.name}`)
        }
    }
    const ids = Array.from(page.matchAll(/\bid="([^"]+)"/g), (match) => match[1])
    if (new Set(ids).size !== ids.length) fail('component explorer pages must have unique element IDs')
}
if (!templateHtml.includes('href="benchmarks.html"') || !html.includes('href="benchmarks.html"')) {
    fail('homepage must link to the benchmark results page')
}
if (!benchmarksTemplateHtml.includes('{{BENCHMARK_ROWS}}') || !benchmarksTemplateHtml.includes('{{QUALITY_SUMMARY}}')) {
    fail('benchmark page template must render measured results and check summaries')
}
if (benchmarksHtml.includes('{{')) {
    fail('generated benchmark page contains an unreplaced placeholder')
}

const playgroundMain = await stat(join(root, 'docs', 'playground.js'))
const playgroundWorker = await stat(join(root, 'docs', 'playground-worker.js'))
const playgroundAssetFiles = await readdir(join(root, 'docs', 'assets', 'playground'))
if (playgroundMain.size > 100 * 1024) {
    fail('playground main bundle must stay below 100 KiB')
}
if (playgroundWorker.size > 1_500 * 1024) {
    fail('playground worker bundle must stay below 1.5 MiB')
}
if (playgroundAssetFiles.filter((file) => file.endsWith('.ttf')).length !== 6) {
    fail('playground must ship six self-hosted font files')
}
if (playgroundAssetFiles.filter((file) => file.endsWith('.wasm')).length !== 3) {
    fail('playground must ship Satori, Resvg, and HarfBuzz WASM files')
}

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { version?: string; files?: string[] }
const packageFiles = packageJson.files ?? []
if (packageFiles.includes('docs/assets')) {
    fail('npm package must not include generated website gallery assets')
}
if (!html.includes('assets/examples/animated-pipeline_dark.gif')) {
    fail('website must retain rendered gallery assets')
}
if (!templateHtml.includes('data-animated') || !siteScript.includes('prefers-reduced-motion: reduce') || !siteScript.includes('imageSource')) {
    fail('animated gallery assets must provide reduced-motion PNG fallbacks')
}
for (const asset of ncclGalleryAssets) {
    const gifRef = `assets/examples/${asset.name}_dark.gif`
    const cardMarker = `data-theme-image data-animated src="${gifRef}" alt="${asset.alt}"`
    if (!templateHtml.includes(cardMarker)) {
        fail(`homepage template missing animated NCCL card: ${asset.name}`)
    }
    if (!html.includes(cardMarker)) {
        fail(`generated homepage missing animated NCCL card: ${asset.name}`)
    }
}

const ofl = await readFile(join(root, 'assets', 'licenses', 'OFL-1.1.txt'), 'utf8')
const twemojiLicense = await readFile(join(root, 'assets', 'licenses', 'twemoji-svg-MIT.txt'), 'utf8')
if (!ofl.includes('SIL OPEN FONT LICENSE Version 1.1') || !ofl.includes('PERMISSION & CONDITIONS')) {
    fail('vendored fonts must include full OFL 1.1 text')
}
if (!twemojiLicense.includes('Copyright (c) 2023 Samuel Kopp') || !twemojiLicense.includes('Permission is hereby granted')) {
    fail('vendored Twemoji assets must include full MIT license text')
}
for (const [name, path] of [
    ['Codex plugin', codexPluginPath],
    ['Claude plugin', claudePluginPath],
] as const) {
    const plugin = JSON.parse(await readFile(path, 'utf8')) as { name?: string; version?: string; skills?: string }
    if (plugin.name !== 'vizmatic' || plugin.skills !== './skills/') {
        fail(`${name} manifest must expose bundled skills`)
    }
    if (plugin.version !== packageJson.version) {
        fail(`${name} manifest version must match package.json`)
    }
}

const portableFiles = await listFiles(portableSkillDir)
const pluginFiles = await listFiles(pluginSkillDir)
const portableRelative = portableFiles.map((path) => relative(portableSkillDir, path)).sort()
const pluginRelative = pluginFiles.map((path) => relative(pluginSkillDir, path)).sort()
if (portableRelative.join('\n') !== pluginRelative.join('\n')) {
    fail('.agents/skills/vizmatic must mirror plugin skill files')
}
for (const rel of pluginRelative) {
    const pluginFile = await readFile(join(pluginSkillDir, rel), 'utf8')
    const portableFile = await readFile(join(portableSkillDir, rel), 'utf8')
    if (pluginFile !== portableFile) {
        fail(`.agents/skills/vizmatic/${rel} must match plugin skill source`)
    }
}

const codexMarketplace = JSON.parse(await readFile(codexMarketplacePath, 'utf8')) as { plugins?: Array<{ name?: string; source?: { source?: string; url?: string; path?: string } }> }
const codexMarketplacePlugin = codexMarketplace.plugins?.find((entry) => entry.name === 'vizmatic')
if (!codexMarketplacePlugin) {
    fail('Codex marketplace.json must expose Vizmatic plugin')
}
if (
    codexMarketplacePlugin.source?.source !== 'git-subdir'
    || codexMarketplacePlugin.source.url !== 'https://github.com/bvolpato/vizmatic.git'
    || codexMarketplacePlugin.source.path !== './plugins/vizmatic'
) {
    fail('Codex marketplace.json must point to Vizmatic plugin git subdir')
}

const claudeMarketplace = JSON.parse(await readFile(claudeMarketplacePath, 'utf8')) as { name?: string; plugins?: Array<{ name?: string; source?: string; version?: string }> }
const claudeMarketplacePlugin = claudeMarketplace.plugins?.find((entry) => entry.name === 'vizmatic')
if (claudeMarketplace.name !== 'vizmatic' || !claudeMarketplacePlugin) {
    fail('Claude marketplace.json must expose Vizmatic plugin')
}
if (claudeMarketplacePlugin.source !== './plugins/vizmatic') {
    fail('Claude marketplace.json must point to Vizmatic plugin directory')
}
if (claudeMarketplacePlugin.version !== packageJson.version) {
    fail('Claude marketplace plugin version must match package.json')
}

if (!html.includes('code-copy-button')) {
    fail('homepage code blocks must install copy buttons')
}

if (!html.includes('id="imageDialog"')) {
    fail('homepage gallery must include image preview dialog')
}

if (componentsHtml.includes('{{COMPONENT_CATALOG}}') || componentsHtml.includes('{{COMPONENT_FILTERS}}') || componentsHtml.includes('{{COMPONENT_COUNT}}')) {
    fail('component catalog contains unreplaced placeholders')
}

if (!componentsTemplateHtml.includes('{{COMPONENT_CATALOG}}') || !componentsTemplateHtml.includes('{{COMPONENT_FILTERS}}')) {
    fail('component catalog page must be generated from registry placeholders')
}

if (!componentsHtml.includes(`>${catalogComponentCount} reusable pieces for technical diagrams`)) {
    fail('component catalog count is stale')
}

if (!html.includes('href="components.html"')) {
    fail('homepage navigation must link to component catalog')
}

const componentData = JSON.parse(await readFile(join(root, 'docs', 'components.json'), 'utf8')) as {
    version: string
    count: number
    categories: Array<{ id: string; components: Array<{ name: string; example: string; playgroundUrl: string; controls: ComponentControl[] }> }>
}
if (componentData.version !== packageJson.version || componentData.count !== catalogComponentCount) {
    fail('machine-readable component catalog metadata must match the package and registry')
}
for (const category of componentCatalog) {
    const generatedCategory = componentData.categories.find((entry) => entry.id === category.id)
    if (generatedCategory?.components.length !== category.components.length) fail(`machine-readable catalog is stale for ${category.label}`)
    for (const component of category.components) {
        const generatedComponent = generatedCategory?.components.find((entry) => entry.name === component.name)
        if (generatedComponent?.example !== component.example) fail(`machine-readable example is stale for ${component.name}`)
        if (JSON.stringify(generatedComponent.controls) !== JSON.stringify(component.controls)) fail(`visual controls are stale for ${component.name}`)
        preparePlaygroundSource(applyComponentControls(component.example, component.controls, Object.fromEntries(component.controls.map((control) => [control.prop, control.value]))))
        const url = new URL(generatedComponent.playgroundUrl)
        if (decodeURIComponent(url.hash.slice('#vizmatic-playground='.length)) !== component.example) fail(`invalid playground source for ${component.name}`)
    }
}
const fullContext = await readFile(join(root, 'docs', 'llms-full.txt'), 'utf8')
if (!fullContext.includes(rootPrompt)) fail('full agent context must include the current prompt verbatim')

for (const category of componentCatalog) {
    if (!componentsHtml.includes(`data-catalog-group="${category.id}"`)) {
        fail(`component catalog missing ${category.label}`)
    }
    if (!componentsHtml.includes(`data-source="${category.source}"`)) {
        fail(`component catalog missing ${category.label} source link`)
    }
    for (const component of category.components) {
        if (!componentsHtml.includes(`<code>${component.name}</code>`)) {
            fail(`component catalog missing ${component.name}`)
        }
    }
}

if (html.includes('Fallback before npm publish')) {
    fail('homepage prompt preview should not mention pre-publish fallback')
}

const titleWords: Record<string, string> = {
    gif: 'GIF',
    ml: 'ML',
    nccl: 'NCCL',
    rag: 'RAG',
}

function titleFor(name: string): string {
    return name
        .split('-')
        .map((part) => titleWords[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

function previewFor(outputs: string[], theme: 'dark' | 'light'): string {
    return outputs.find((output) => output.endsWith(`_${theme}.gif`))
        ?? outputs.find((output) => output.endsWith(`_${theme}.png`))
        ?? outputs[0]
        ?? ''
}

const manifestRaw = await readFile(join(root, 'docs', 'assets', 'examples', 'manifest.json'), 'utf8')
const manifest = JSON.parse(manifestRaw) as Array<{ name?: string; source?: string; outputs?: string[] }>
if (manifest.length === 0) {
    fail('manifest.json must include example outputs')
}

const examplesReadme = await readFile(join(root, 'examples', 'README.md'), 'utf8')
for (const entry of manifest) {
    if (!entry.name) fail('every manifest entry must have a name')
    if (!entry.source) fail(`${entry.name} manifest entry missing source`)
    if (!entry.outputs?.length) fail(`${entry.name} manifest entry missing outputs`)

    const title = titleFor(entry.name)
    if (!examplesReadme.includes(`[${title}](${basename(entry.source)})`)) {
        fail(`examples README missing ${entry.name} source link`)
    }

    for (const theme of ['dark', 'light'] as const) {
        const preview = previewFor(entry.outputs, theme)
        if (!preview) fail(`${entry.name} missing ${theme} preview`)
        if (!examplesReadme.includes(`${galleryAssetUrl}/${preview}`)) {
            fail(`examples README missing ${entry.name} ${theme} preview`)
        }
    }

    for (const output of entry.outputs) {
        await access(join(root, 'docs', 'assets', 'examples', output)).catch(() => fail(`${entry.name} output missing: ${output}`))
    }
}

const sourcesRaw = await readFile(join(root, 'docs', 'assets', 'examples', 'sources.json'), 'utf8')
const sources = JSON.parse(sourcesRaw) as Array<{ name?: string; html?: { dark?: string; light?: string } | string }>
if (sources.length === 0) {
    fail('sources.json must include example sources')
}

for (const source of sources) {
    if (!source.name) fail('every source entry must have a name')
    if (typeof source.html === 'string') {
        fail(`${source.name} source html must include dark and light variants`)
    }
    if (!source.html?.dark?.includes('github-dark-high-contrast')) {
        fail(`${source.name} source html missing github-dark-high-contrast`)
    }
    if (!source.html.light?.includes('github-light-high-contrast')) {
        fail(`${source.name} source html missing github-light-high-contrast`)
    }
    const individualSource = JSON.parse(await readFile(join(root, 'docs', 'assets', 'sources', source.name + '.json'), 'utf8')) as {
        playgroundCode: string
        [key: string]: unknown
    }
    const { playgroundCode, ...originalSource } = individualSource
    if (JSON.stringify(originalSource) !== JSON.stringify(source)) fail(`${source.name} individual website source is stale`)
    preparePlaygroundSource(playgroundCode)
}

console.log(`docs ok: ${refs.length} local references checked`)
