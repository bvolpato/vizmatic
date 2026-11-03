import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { escapeHtml, renderMarkdown, splitFrontMatter, type FenceBlock, type Heading } from './site-markdown'
import { highlight } from './site-highlight'
import { applySiteShell, registerSitePages, type SitePage } from './site-shell'
import { buildApiReference } from './build-api-reference'
import { SAMPLE_DIR } from './guide-paths'

const GUIDE_DIR = 'docs/guides'
const OUT_DIR = 'docs/docs'

const SECTION_ORDER = ['Start', 'Motion', 'Objects', 'Style', 'Diagrams', 'Ship', 'Reference']

export interface GuideSearchEntry {
    title: string
    description: string
    url: string
    category: string
}

interface Guide {
    slug: string
    title: string
    nav: string
    description: string
    section: string
    order: number
    body: string
    html: string
    headings: Heading[]
    wide: boolean
}

interface PendingFence {
    token: string
    block: FenceBlock
    samplePath: string | null
    demoName: string | null
}

function sampleExtension(lang: string): string {
    return lang === 'tsx' || lang === 'film-tsx' || lang === 'jsx' ? 'tsx' : 'ts'
}

/** Read every guide, record its compilable samples, and return the demos to bundle. */
export async function prepareGuides(): Promise<{ guides: Guide[]; demos: Record<string, string>; fences: Map<string, PendingFence> }> {
    await rm(SAMPLE_DIR, { recursive: true, force: true })
    await mkdir(SAMPLE_DIR, { recursive: true })
    const names = (await readdir(GUIDE_DIR).catch(() => [] as string[])).filter((name) => name.endsWith('.md'))
    const demos: Record<string, string> = {}
    const fences = new Map<string, PendingFence>()
    const guides: Guide[] = []
    for (const name of names) {
        const { data, body } = splitFrontMatter(await readFile(join(GUIDE_DIR, name), 'utf8'))
        const slug = data['slug'] ?? name.replace(/\.md$/, '')
        const guide: Guide = {
            slug,
            title: data['title'] ?? slug,
            nav: data['nav'] ?? data['title'] ?? slug,
            description: data['description'] ?? '',
            section: data['section'] ?? 'Start',
            order: Number(data['order'] ?? 99),
            body,
            html: '',
            headings: [],
            wide: data['wide'] === 'true',
        }
        let counter = 0
        const rendered = renderMarkdown(body, {
            fence: (block) => {
                const index = ++counter
                const isFilm = block.lang === 'film' || block.lang === 'film-tsx'
                // A `jsx` fence is a bare frame unless it imports. Bare frames are checked as frames in check-docs.
                const moduleJsx = block.lang === 'jsx' && /^\s*import\s/m.test(block.code)
                const compiles = isFilm || block.lang === 'ts' || block.lang === 'tsx' || moduleJsx
                const base = `${slug}-${String(index).padStart(2, '0')}`
                const samplePath = compiles ? join(SAMPLE_DIR, `${base}.${sampleExtension(block.lang)}`) : null
                const token = `@@FENCE:${slug}:${index}@@`
                fences.set(token, { token, block, samplePath, demoName: isFilm ? base : null })
                if (isFilm && samplePath) demos[base] = samplePath
                return token
            },
        })
        guide.html = rendered.html
        guide.headings = rendered.headings
        guides.push(guide)
    }
    await Promise.all([...fences.values()].filter((fence) => fence.samplePath).map((fence) => writeFile(fence.samplePath!, `${fence.block.code}\n`)))
    const sectionRank = (section: string) => {
        const rank = SECTION_ORDER.indexOf(section)
        return rank < 0 ? SECTION_ORDER.length : rank
    }
    guides.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.order - b.order)
    return { guides, demos, fences }
}

async function renderFence(fence: PendingFence): Promise<string> {
    const { block, demoName } = fence
    const isFilm = demoName !== null
    const language = isFilm ? (block.lang === 'film-tsx' ? 'tsx' : 'ts') : (block.lang || 'text')
    const code = await highlight(block.code, language === 'text' ? 'text' : language)
    if (!isFilm) return code
    const label = typeof block.info['label'] === 'string' ? block.info['label'] : 'A short animation made from the source shown here'
    const caption = typeof block.info['caption'] === 'string' ? `<figcaption><span>${escapeHtml(block.info['caption'])}</span></figcaption>` : ''
    const attributes = block.info['controls'] ? 'autoplay loop' : 'autoplay loop nocontrols'
    const film = `<vz-film src="../assets/stage/demos/${demoName}.js" ${attributes} label="${escapeHtml(label)}"></vz-film>`
    if (block.info['paired']) return `<figure class="demo is-paired">${code}<div class="demo-frame">${film}</div>${caption}</figure>`
    if (block.info['open']) return `<figure class="demo"><div class="demo-frame">${film}</div>${code}${caption}</figure>`
    return `<figure class="demo"><div class="demo-frame">${film}</div>${caption}<details><summary>Show the source</summary>${code}</details></figure>`
}

function renderNav(guides: readonly Guide[], current: string): string {
    const sections = [...new Set(guides.map((guide) => guide.section))]
    return sections.map((section) => `<h2>${section}</h2>${guides.filter((guide) => guide.section === section)
        .map((guide) => `<a href="${guide.slug}.html"${guide.slug === current ? ' aria-current="page"' : ''}>${escapeHtml(guide.nav)}</a>`).join('')}`).join('')
}

function renderToc(headings: readonly Heading[]): string {
    const items = headings.filter((heading) => heading.level <= 3)
    if (items.length === 0) return ''
    return `<aside class="docs-toc" data-toc aria-label="On this page"><h2>On this page</h2>${items.map((heading) => `<a href="#${heading.id}"${heading.level === 3 ? ' class="is-sub"' : ''}>${escapeHtml(heading.text)}</a>`).join('')}</aside>`
}

export async function writeGuides(prepared: Awaited<ReturnType<typeof prepareGuides>>, inject: (html: string) => string = (html) => html): Promise<GuideSearchEntry[]> {
    const { guides, fences } = prepared
    await rm(OUT_DIR, { recursive: true, force: true })
    await mkdir(OUT_DIR, { recursive: true })
    const rendered = new Map<string, string>()
    await Promise.all([...fences.values()].map(async (fence) => rendered.set(fence.token, await renderFence(fence))))

    const api = await buildApiReference()
    const allPages: SitePage[] = guides.map((guide) => ({
        file: `docs/${guide.slug}.html`,
        title: `${guide.title} | Vizmatic docs`,
        description: guide.description,
    }))
    registerSitePages(allPages)
    const searchEntries: GuideSearchEntry[] = []

    await Promise.all(guides.map(async (guide, index) => {
        let article = guide.html.replace(/@@FENCE:[^@]+@@/g, (token) => rendered.get(token) ?? '')
        let headings = guide.headings
        if (guide.slug === 'api') {
            article = article.replace('@@API@@', () => api.html)
            headings = [...headings, ...api.headings]
        }
        const previous = guides[index - 1]
        const next = guides[index + 1]
        const pager = `<nav class="docs-pager" aria-label="Previous and next pages">${previous ? `<a href="${previous.slug}.html"><small>Previous</small>${escapeHtml(previous.nav)}</a>` : ''}${next ? `<a href="${next.slug}.html"><small>Next</small>${escapeHtml(next.nav)}</a>` : ''}</nav>`
        const file = `docs/${guide.slug}.html`
        const nav = renderNav(guides, guide.slug)
        const page = applySiteShell(`<!DOCTYPE html>
<html lang="en">
<head>
  {{SITE_HEAD}}
</head>
<body>
  {{SITE_NAV}}
  <div class="docs">
    <aside class="docs-nav" aria-label="Documentation">${nav}</aside>
    <main id="main-content" tabindex="-1" class="docs-main">
      <details class="docs-mobile-nav"><summary>All guides</summary><div class="docs-nav">${nav}</div></details>
      <article class="docs-article">
        <h1>${escapeHtml(guide.title)}</h1>
        ${guide.description ? `<p class="docs-lede">${escapeHtml(guide.description)}</p>` : ''}
        ${article}
        ${pager}
      </article>
    </main>
    ${renderToc(headings)}
  </div>
  {{SITE_FOOTER}}
  {{SITE_DIALOGS}}
</body>
</html>
`, file)
        await writeFile(join('docs', file), `<!DOCTYPE html>\n<!-- Generated from docs/guides by scripts/build-site.ts. Edit the guide. -->\n${inject(page).replace('<!DOCTYPE html>\n', '')}`)
        searchEntries.push({ title: guide.title, description: guide.description, url: file, category: 'Guide' })
        for (const heading of guide.headings) {
            if (heading.level === 2 || heading.level === 3) searchEntries.push({ title: heading.text, description: `${guide.title}`, url: `${file}#${heading.id}`, category: 'Guide section' })
        }
        if (guide.slug === 'api') searchEntries.push(...api.search.map((entry) => ({ ...entry, url: `${file}#${entry.anchor}` })))
    }))
    return searchEntries
}
