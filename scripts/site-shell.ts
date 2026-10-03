const baseUrl = 'https://bvolpato.github.io/vizmatic/'

export const sitePages = [
    { file: 'index.html', title: 'Vizmatic | Your ideas, rendered', description: 'Compose diagrams, charts, and animated visuals in TSX. Explore runnable examples, render locally, or give your coding agent the Vizmatic skill.' },
    { file: 'components.html', title: 'Components | Vizmatic', description: 'Choose a Vizmatic component and see it render. Explore live examples, change visual settings, edit the TSX, and download the result.' },
    { file: 'playground.html', title: 'Playground | Vizmatic', description: 'Explore Vizmatic components with a live preview and visual controls. Edit TSX, switch themes, share source, and download PNG or SVG.' },
    { file: 'agents.html', title: 'For agents | Vizmatic', description: 'Install the Vizmatic skill, use a verified render workflow, and discover machine-readable instructions and runnable component examples.' },
    { file: 'benchmarks.html', title: 'Benchmarks | Vizmatic', description: 'Inspect reproducible Vizmatic render time, process memory, environment details, and automated example-check results.' },
]

export function siteHead(file: string): string {
    const page = sitePages.find((page) => page.file === file)!
    const url = baseUrl + (file === 'index.html' ? '' : file)
    return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}</title>
  <meta name="description" content="${page.description}">
  <meta name="theme-color" content="#0b0d16">
  <link rel="canonical" href="${url}">
  <meta property="og:title" content="${page.title}">
  <meta property="og:description" content="${page.description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${baseUrl}assets/examples/vizmatic-hero_dark.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${page.title}">
  <meta name="twitter:description" content="${page.description}">
  <meta name="twitter:image" content="${baseUrl}assets/examples/vizmatic-hero_dark.png">
  <link rel="icon" href="assets/icon.svg" type="image/svg+xml">
  <link rel="alternate" type="text/markdown" href="llms.txt" title="Agent documentation index">
  <script>
    (() => {
      let mode = 'system'
      try { mode = localStorage.getItem('vizmatic-theme') || 'system' } catch {}
      if (mode !== 'light' && mode !== 'dark') mode = 'system'
      document.documentElement.dataset.themeMode = mode
      document.documentElement.dataset.siteTheme = mode === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : mode
    })()
  </script>
  <link rel="preload" href="assets/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="style.css">
  <script type="module" src="site.js"></script>`
}

export function siteNav(file: string): string {
    const items = [
        ['index.html#gallery', 'Examples'],
        ['components.html', 'Components'],
        ['playground.html', 'Playground'],
        ['agents.html', 'For agents'],
    ]
    return `<a class="skip-link" href="#main-content">Skip to content</a>
  <div class="nav-shell">
    <nav class="nav" aria-label="Primary navigation">
      <a class="brand" href="index.html" aria-label="Vizmatic home"><img src="assets/icon.svg" alt="" width="28" height="28"><span>vizmatic<span class="brand-dot">.</span></span></a>
      <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="siteNavigation">Menu <span aria-hidden="true">☰</span></button>
      <div class="nav-actions" id="siteNavigation" data-site-navigation>
        <div class="nav-links">${items.map(([url, label]) => `<a href="${url}"${url === file ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>
        <div class="nav-tools">
          <button class="search-trigger" type="button" data-open-search aria-label="Search Vizmatic"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span>Search</span><kbd>⌘ K</kbd></button>
          <div class="theme-toggle" role="group" aria-label="Site theme">
            <button type="button" data-theme-choice="system" aria-pressed="true" aria-label="Use system theme" title="System theme">◐</button>
            <button type="button" data-theme-choice="light" aria-pressed="false" aria-label="Use light theme" title="Light theme">☼</button>
            <button type="button" data-theme-choice="dark" aria-pressed="false" aria-label="Use dark theme" title="Dark theme">☾</button>
          </div>
          <a class="github-link" href="https://github.com/bvolpato/vizmatic" aria-label="Vizmatic on GitHub"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.57 9.57 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.21 2.39.11 2.64.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.69-4.58 4.94.36.31.68.92.68 1.85v2.76c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg></a>
        </div>
      </div>
    </nav>
  </div>`
}

export const siteFooter = `<footer class="site-footer">
    <div class="footer-main">
      <div><a class="brand" href="index.html"><img src="assets/icon.svg" alt="" width="28" height="28"><span>vizmatic<span class="brand-dot">.</span></span></a><p>Visuals you can build on.</p></div>
      <div class="footer-links"><div><h2>Create</h2><a href="playground.html">Playground</a><a href="index.html#gallery">Examples</a><a href="components.html">Components</a></div><div><h2>Learn</h2><a href="index.html#quick-start">Quick start</a><a href="agents.html">For agents</a><a href="benchmarks.html">Benchmarks</a></div><div><h2>Source</h2><a href="https://github.com/bvolpato/vizmatic">GitHub ↗</a><a href="https://www.npmjs.com/package/vizmatic">npm ↗</a><a href="llms.txt">llms.txt</a></div></div>
    </div>
    <div class="footer-bottom"><p>MIT licensed. Built by <a href="https://github.com/bvolpato">Bruno Volpato</a>.</p><a href="assets/THIRD_PARTY_LICENSES.md">Third-party licenses</a></div>
  </footer>`

export const siteDialogs = `<dialog class="search-dialog" id="searchDialog" aria-labelledby="searchTitle">
    <div class="search-dialog-heading"><h2 id="searchTitle">Find your next building block</h2><button class="button small" type="button" data-close-search>Close <kbd>Esc</kbd></button></div>
    <label class="site-search-label" for="siteSearch">Search pages, components, and examples</label>
    <input id="siteSearch" type="search" placeholder="Try architecture, chart, or agent…" autocomplete="off" aria-controls="siteSearchResults">
    <p id="siteSearchStatus" class="search-status" role="status"></p><div id="siteSearchResults" class="search-results"></div>
    <div class="search-help"><span>↑ ↓ to navigate</span><span>Enter to open</span><span>Esc to close</span></div>
  </dialog>
  <dialog class="source-dialog" id="sourceDialog" aria-labelledby="sourceTitle">
    <div class="source-dialog-panel"><header><div><span>Editable TSX</span><h2 id="sourceTitle">Example source</h2></div><div class="dialog-actions"><a class="button primary" id="trySourceLink" href="playground.html">Try / edit ↗</a><button class="button" type="button" id="copySourceButton">Copy code</button><button class="button" type="button" id="closeSourceButton">Close</button></div></header><p class="source-note">The playground edits a static frame. Use the CLI to render GIF animations.</p><div class="source-code" id="sourceCode"></div></div>
  </dialog>
  <dialog class="image-dialog" id="imageDialog" aria-labelledby="imageDialogTitle">
    <div class="image-dialog-panel"><div class="image-dialog-header"><h2 id="imageDialogTitle">Example preview</h2><button class="button" type="button" id="closeImageButton">Close</button></div><div class="image-dialog-viewport"><img id="imageDialogImage" alt=""></div></div>
  </dialog>`

export function applySiteShell(template: string, file: string): string {
    return template.replace('{{SITE_HEAD}}', () => siteHead(file))
        .replace('{{SITE_NAV}}', () => siteNav(file))
        .replace('{{SITE_FOOTER}}', () => siteFooter)
        .replace('{{SITE_DIALOGS}}', () => siteDialogs)
}
