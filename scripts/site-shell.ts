import { MARK_PATH, MARK_POINT } from './build-logo'

const baseUrl = 'https://bvolpato.github.io/vizmatic/'

export interface SitePage {
    file: string
    title: string
    description: string
    /** Social preview image, relative to the site root. */
    image?: string
}

export const sitePages: SitePage[] = [
    { file: 'index.html', title: 'Vizmatic | Moving pictures of ideas, written as code', description: 'A vector animation engine and diagram library for TypeScript. Films play live in the browser, seek instantly, and export to exact MP4.' },
    { file: 'films.html', title: 'Films | Vizmatic', description: 'Short mathematical and technical films made with Vizmatic. Each one plays live in your browser, with its full source.' },
    { file: 'examples.html', title: 'Examples | Vizmatic', description: 'Rendered diagrams, charts, dashboards, and lessons with their editable TSX source, in dark and light.' },
    { file: 'components.html', title: 'Components | Vizmatic', description: 'Choose a Vizmatic component and see it render. Explore live examples, change visual settings, edit the TSX, and download the result.' },
    { file: 'playground.html', title: 'Diagram builder | Vizmatic', description: 'Build diagrams and charts on an editable canvas. Arrange components, edit data, route connectors, save projects, and export PNG, SVG, or GIF.' },
    { file: 'agents.html', title: 'For agents | Vizmatic', description: 'Install the Vizmatic skill, use a verified render workflow, and discover machine-readable instructions and runnable component examples.' },
    { file: 'benchmarks.html', title: 'Benchmarks | Vizmatic', description: 'Inspect reproducible Vizmatic render time, process memory, environment details, and automated example-check results.' },
]

/** Add pages generated later in the build, such as guides and film pages. */
export function registerSitePages(pages: readonly SitePage[]): void {
    for (const page of pages) {
        const existing = sitePages.findIndex((entry) => entry.file === page.file)
        if (existing >= 0) sitePages[existing] = page
        else sitePages.push(page)
    }
}

/** Pages one folder down reach shared assets through this prefix. */
export function rootPrefix(file: string): string {
    return '../'.repeat(file.split('/').length - 1)
}

const TOOL_PAGES = new Set(['components.html', 'playground.html'])

export function siteHead(file: string): string {
    const page = sitePages.find((entry) => entry.file === file)
    if (!page) throw new Error(`Unknown site page: ${file}. Add it to sitePages or call registerSitePages first.`)
    const root = rootPrefix(file)
    const url = baseUrl + (file === 'index.html' ? '' : file)
    const image = `${baseUrl}${page.image ?? 'assets/site/og.png'}`
    return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}</title>
  <meta name="description" content="${page.description}">
  <meta name="theme-color" content="#0c0b09">
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="${page.title}">
  <meta property="og:description" content="${page.description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${image}">
${page.image ? '' : `  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
`}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${page.title}">
  <meta name="twitter:description" content="${page.description}">
  <meta name="twitter:image" content="${image}">
  <link rel="icon" href="${root}assets/icon.svg" type="image/svg+xml">
  <link rel="alternate" type="text/markdown" href="${root}llms.txt" title="Agent documentation index">
  <script>
    (() => {
      let mode = 'system'
      try { mode = localStorage.getItem('vizmatic-theme') || 'system' } catch {}
      if (mode !== 'light' && mode !== 'dark') mode = 'system'
      const root = document.documentElement
      root.dataset.themeMode = mode
      root.dataset.siteTheme = mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode
      root.dataset.siteRoot = ${JSON.stringify(root)}
      root.classList.add('js')
    })()
  </script>
  <link rel="preload" href="${root}assets/fonts/InstrumentSerif-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${root}assets/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${root}style.css">${TOOL_PAGES.has(file) ? `\n  <link rel="stylesheet" href="${root}explorer.css">` : ''}
  <script type="module" src="${root}site.js"></script>`
}

/** The mark: one stroke and a point. It draws itself once when the page loads. */
function mark(): string {
    return `<svg class="mark" viewBox="0 0 40 40" width="30" height="30" aria-hidden="true"><path class="mark-curve" pathLength="1" d="${MARK_PATH}"/><circle class="mark-point" cx="${MARK_POINT.x}" cy="${MARK_POINT.y}" r="${MARK_POINT.r}"/></svg>`
}

export function brand(root = ''): string {
    return `<a class="brand" href="${root}index.html" aria-label="Vizmatic home">${mark()}<span>vizmatic</span></a>`
}

const GITHUB_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.57 9.57 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.21 2.39.11 2.64.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.58 4.94.36.31.68.92.68 1.85v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>'
const THEME_ICONS = {
    system: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none"/><path d="M12 4.5a7.5 7.5 0 0 1 0 15z" stroke="none" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6" fill="none"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4M6 6l1.7 1.7M16.3 16.3 18 18M18 6l-1.7 1.7M7.7 16.3 6 18"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z" fill="none"/></svg>',
}

export interface NavOptions {
    /** Studio ships as its own page. Until it does, the builder link opens the diagram builder. */
    studio?: boolean
}

let navOptions: NavOptions = {}

export function configureSiteShell(options: NavOptions): void {
    navOptions = options
}

function studioHref(): string {
    return navOptions.studio ? 'studio.html' : 'playground.html'
}

export function siteNav(file: string): string {
    const root = rootPrefix(file)
    const items: [string, string, string[]][] = [
        ['films.html', 'Films', ['films.html', 'film/']],
        ['docs/index.html', 'Docs', ['docs/']],
        ['components.html', 'Components', ['components.html']],
        ['examples.html', 'Examples', ['examples.html']],
        [studioHref(), 'Studio', ['studio.html', 'playground.html']],
        ['agents.html', 'For agents', ['agents.html']],
    ]
    const links = items.map(([href, label, matches]) => {
        const current = matches.some((match) => file === match || (match.endsWith('/') && file.startsWith(match)))
        return `<a href="${root}${href}"${current ? ' aria-current="page"' : ''}>${label}</a>`
    }).join('')
    return `<a class="skip-link" href="#main-content">Skip to content</a>
  <div class="nav-shell">
    <nav class="nav" aria-label="Primary navigation">
      ${brand(root)}
      <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="siteNavigation">Menu</button>
      <div class="nav-actions" id="siteNavigation" data-site-navigation>
        <div class="nav-links">${links}</div>
        <div class="nav-tools">
          <button class="search-trigger" type="button" data-open-search aria-label="Search Vizmatic"><span>Search</span><kbd>⌘K</kbd></button>
          <div class="theme-toggle" role="group" aria-label="Site theme">
            <button type="button" data-theme-choice="system" aria-pressed="true" aria-label="Use system theme" title="System theme">${THEME_ICONS.system}</button>
            <button type="button" data-theme-choice="light" aria-pressed="false" aria-label="Use light theme" title="Light theme">${THEME_ICONS.light}</button>
            <button type="button" data-theme-choice="dark" aria-pressed="false" aria-label="Use dark theme" title="Dark theme">${THEME_ICONS.dark}</button>
          </div>
          <a class="github-link" href="https://github.com/bvolpato/vizmatic" aria-label="Vizmatic on GitHub">${GITHUB_ICON}</a>
        </div>
      </div>
    </nav>
  </div>`
}

export function siteFooter(file: string): string {
    const root = rootPrefix(file)
    const group = (title: string, links: [string, string][]) => `<div><h2>${title}</h2>${links.map(([href, label]) => `<a href="${href.startsWith('http') ? href : root + href}">${label}</a>`).join('')}</div>`
    return `<footer class="site-footer">
    <div class="footer-main">
      <div class="footer-brand">${brand(root)}<p>Moving pictures of ideas, written as code.</p></div>
      <div class="footer-links">
        ${group('Make', [['films.html', 'Films'], [studioHref(), 'Studio'], ['playground.html', 'Diagram builder'], ['examples.html', 'Examples'], ['components.html', 'Components']])}
        ${group('Learn', [['docs/index.html', 'Getting started'], ['docs/animations.html', 'Animations'], ['docs/cookbook.html', 'Cookbook'], ['docs/api.html', 'API reference'], ['benchmarks.html', 'Benchmarks']])}
        ${group('Source', [['https://github.com/bvolpato/vizmatic', 'GitHub'], ['https://www.npmjs.com/package/vizmatic', 'npm'], ['agents.html', 'For agents'], ['llms.txt', 'llms.txt']])}
      </div>
    </div>
    <div class="footer-bottom"><p>MIT licensed. Built by <a href="https://github.com/bvolpato">Bruno Volpato</a>.</p><a href="${root}assets/THIRD_PARTY_LICENSES.md">Third-party licenses</a></div>
  </footer>`
}

export function siteDialogs(file: string): string {
    const root = rootPrefix(file)
    return `<dialog class="search-dialog" id="searchDialog" aria-labelledby="searchTitle">
    <div class="search-dialog-heading"><h2 id="searchTitle">Search</h2><button class="button small" type="button" data-close-search>Close <kbd>Esc</kbd></button></div>
    <label class="site-search-label" for="siteSearch">Search films, guides, the API, and components</label>
    <input id="siteSearch" type="search" placeholder="Try morph, camera, or architecture" autocomplete="off" aria-controls="siteSearchResults">
    <p id="siteSearchStatus" class="search-status" role="status"></p><div id="siteSearchResults" class="search-results"></div>
    <div class="search-help"><span>↑ ↓ to navigate</span><span>Enter to open</span><span>Esc to close</span></div>
  </dialog>
  <dialog class="source-dialog" id="sourceDialog" aria-labelledby="sourceTitle">
    <div class="source-dialog-panel"><header><div><span>Editable TSX</span><h2 id="sourceTitle">Example source</h2></div><div class="dialog-actions"><a class="button primary" id="trySourceLink" href="${root}playground.html">Open in the builder</a><button class="button" type="button" id="copySourceButton">Copy code</button><button class="button" type="button" id="closeSourceButton">Close</button></div></header><p class="source-note">Open the builder to edit this scene, preview animations, and export your visual.</p><div class="source-code" id="sourceCode"></div></div>
  </dialog>
  <dialog class="image-dialog" id="imageDialog" aria-labelledby="imageDialogTitle">
    <div class="image-dialog-panel"><div class="image-dialog-header"><h2 id="imageDialogTitle">Example preview</h2><button class="button" type="button" id="closeImageButton">Close</button></div><div class="image-dialog-viewport"><img id="imageDialogImage" alt=""></div></div>
  </dialog>`
}

export function applySiteShell(template: string, file: string): string {
    return template.replace('{{SITE_HEAD}}', () => siteHead(file))
        .replace('{{SITE_NAV}}', () => siteNav(file))
        .replace('{{SITE_FOOTER}}', () => siteFooter(file))
        .replace('{{SITE_DIALOGS}}', () => siteDialogs(file))
}
