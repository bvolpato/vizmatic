(() => {
  'use strict'

  const $ = (selector, scope = document) => scope.querySelector(selector)
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector))
  const siteRoot = document.documentElement.dataset.siteRoot ?? ''
  const fromRoot = (path) => new URL(siteRoot + path, document.baseURI)
  const copyTimers = new WeakMap()
  const sources = new Map()
  const catalogControllers = new WeakMap()
  let promptRequest
  let searchIndexRequest
  let revealGalleryCard

  function focusableTextEntry(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    )
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }

    const input = document.createElement('textarea')
    input.value = text
    input.setAttribute('readonly', '')
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.append(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    if (!copied) throw new Error('Clipboard access is unavailable.')
  }

  function showButtonState(button, label, duration = 1400) {
    if (!button) return
    const current = copyTimers.get(button)
    if (current) window.clearTimeout(current.timer)
    const original = current?.original ?? {
      html: button.innerHTML,
      ariaLabel: button.getAttribute('aria-label'),
    }
    button.textContent = label
    button.setAttribute('aria-label', label)
    const timer = window.setTimeout(() => {
      button.innerHTML = original.html
      if (original.ariaLabel === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', original.ariaLabel)
      copyTimers.delete(button)
    }, duration)
    copyTimers.set(button, { original, timer })
  }

  async function copyFromButton(button, value) {
    try {
      await copyText(value)
      showButtonState(button, 'Copied')
    } catch {
      showButtonState(button, 'Copy failed')
    }
  }

  function installCodeCopyButtons(scope = document) {
    $$('main pre.shiki, #sourceCode pre.shiki', scope).forEach((pre) => {
      if (pre.dataset.siteCopyInstalled === 'true') return
      pre.dataset.siteCopyInstalled = 'true'

      const button = document.createElement('button')
      button.className = 'code-copy-button'
      button.type = 'button'
      button.textContent = 'Copy'
      button.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        copyFromButton(button, $('code', pre)?.innerText ?? '')
      })
      pre.append(button)
    })
  }

  function installCatalogs() {
    $$('[data-component-browser]').forEach((browser) => {
      const search = $('[data-component-search], #catalogSearch', browser)
      const count = $('.catalog-count', browser)
      const empty = $('.catalog-empty', browser)
      const clear = $('.catalog-search button', browser)
      const filters = $$('[data-catalog-filter]', browser)
      const groups = $$('[data-catalog-group]', browser)
      const items = $$('[data-catalog-item]', browser)
      let activeFilter = filters.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.catalogFilter ?? 'all'

      const update = () => {
        const query = search?.value.trim().toLocaleLowerCase() ?? ''
        let visibleCount = 0

        items.forEach((item) => {
          const group = item.closest('[data-catalog-group]')
          const category = group?.dataset.catalogGroup ?? item.dataset.catalogGroup ?? item.dataset.catalogCategory ?? ''
          const searchText = (item.dataset.catalogSearch ?? item.textContent ?? '').toLocaleLowerCase()
          const categoryMatches = activeFilter === 'all' || category === activeFilter
          const matches = categoryMatches && (!query || searchText.includes(query))
          item.hidden = !matches
          if (matches) visibleCount += 1
        })

        groups.forEach((group) => {
          group.hidden = !$$('[data-catalog-item]', group).some((item) => !item.hidden)
        })

        if (count) count.textContent = `${visibleCount} component${visibleCount === 1 ? '' : 's'}`
        if (empty) empty.hidden = visibleCount !== 0
        if (clear) clear.hidden = query.length === 0
      }

      search?.addEventListener('input', update)
      clear?.addEventListener('click', () => {
        if (search) {
          search.value = ''
          search.focus()
        }
        update()
      })
      filters.forEach((button) => button.addEventListener('click', () => {
        activeFilter = button.dataset.catalogFilter ?? 'all'
        filters.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)))
        update()
      }))
      catalogControllers.set(browser, {
        reveal() {
          activeFilter = 'all'
          if (search) search.value = ''
          filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.catalogFilter === 'all')))
          let ancestor = browser
          while (ancestor) {
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true
            ancestor = ancestor.parentElement
          }
          update()
        },
      })
      update()
    })

    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-copy-component][data-component-source]') : null
      if (!button) return
      event.preventDefault()
      copyFromButton(button, button.dataset.componentSource ?? '')
    })
  }

  function installCopyPromptAndSkill() {
    const preview = $('#promptPreview')
    const skillCommand = $('#skillCommand')

    async function getPrompt() {
      const current = preview?.textContent ?? ''
      if (current.trim() && !current.includes('{{PROMPT_MD}}')) return current
      if (!promptRequest) {
        promptRequest = fetch(fromRoot('PROMPT.md'))
          .then((response) => {
            if (!response.ok) throw new Error(`Could not load PROMPT.md (${response.status}).`)
            return response.text()
          })
          .then((prompt) => {
            if (preview) preview.textContent = prompt
            return prompt
          })
          .catch((error) => {
            promptRequest = undefined
            throw error
          })
      }
      return promptRequest
    }

    $$('[data-copy-prompt]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await copyText(await getPrompt())
          showButtonState(button, 'Copied')
        } catch {
          showButtonState(button, 'Copy failed')
        }
      })
    })

    const skillButton = $('#copySkillButton')
    skillButton?.addEventListener('click', () => copyFromButton(skillButton, skillCommand?.textContent ?? ''))
  }

  function installTheme() {
    const meta = $('meta[name="theme-color"]')
    const buttons = $$('[data-theme-choice]')
    const systemTheme = window.matchMedia('(prefers-color-scheme: light)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    function savedChoice() {
      try {
        return localStorage.getItem('vizmatic-theme')
      } catch {
        return null
      }
    }

    function normalizeChoice(choice) {
      return choice === 'light' || choice === 'dark' ? choice : 'system'
    }

    function resolvedChoice(choice) {
      return choice === 'system' ? (systemTheme.matches ? 'light' : 'dark') : choice
    }

    function imageSource(image, theme) {
      const animated = image.hasAttribute('data-animated')
      const extension = animated && !reducedMotion.matches ? 'gif' : 'png'
      const base = image.dataset.themeImageBase
      if (base) return `${base}_${theme}.${animated ? extension : image.dataset.themeImageExt ?? 'png'}`

      const source = image.getAttribute('src') ?? ''
      const match = source.match(/^(.*)_(?:dark|light)\.(png|gif|webp)([?#].*)?$/i)
      if (!match) return source
      const selectedExtension = animated ? extension : match[2]
      return `${match[1]}_${theme}.${selectedExtension}${match[3] ?? ''}`
    }

    function renderImage(image, theme) {
      const source = imageSource(image, theme)
      if (!source || image.getAttribute('src') === source) return
      delete image.dataset.animationFallback
      image.setAttribute('src', source)
    }

    function setTheme(choice) {
      const normalized = normalizeChoice(choice)
      const resolved = resolvedChoice(normalized)
      document.documentElement.dataset.siteTheme = resolved
      document.documentElement.dataset.themeMode = normalized
      try {
        localStorage.setItem('vizmatic-theme', normalized)
      } catch {}

      meta?.setAttribute('content', resolved === 'light' ? '#f7f3ea' : '#0c0b09')
      buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === normalized)))
      $$('[data-theme-image]').forEach((image) => renderImage(image, resolved))

      const playgrounds = new Set([
        ...$$('[data-vizmatic-playground]'),
        ...$$('#playground, #vizmatic-playground'),
      ])
      playgrounds.forEach((playground) => {
        const changed = playground.dataset.vizmaticPlaygroundTheme !== resolved
        playground.dataset.vizmaticPlaygroundTheme = resolved
        if (changed) {
          playground.dispatchEvent(new CustomEvent('vizmatic-playground-theme', { detail: { theme: resolved } }))
        }
      })

      if ($('#sourceDialog')?.open) renderActiveSource()
      if ($('#imageDialog')?.open) renderActiveImage()
      document.dispatchEvent(new CustomEvent('vizmatic-site-theme', { detail: { theme: resolved } }))
    }

    $$('[data-theme-image]').forEach((image) => {
      const source = image.getAttribute('src') ?? ''
      const match = source.match(/^(.*)_(?:dark|light)\.(png|gif|webp)(?:[?#].*)?$/i)
      if (!image.dataset.themeImageBase && match) image.dataset.themeImageBase = match[1]
      if (!image.dataset.themeImageExt && match && match[2] !== 'gif') image.dataset.themeImageExt = match[2]

      image.addEventListener('load', () => {
        const wrapper = image.closest('.media-wrap')
        if (wrapper && image.naturalWidth && image.naturalHeight) {
          wrapper.style.setProperty('--media-ratio', `${image.naturalWidth} / ${image.naturalHeight}`)
        }
      })
      image.addEventListener('error', () => {
        const sourceNow = image.getAttribute('src') ?? ''
        if (!image.hasAttribute('data-animated') || !sourceNow.endsWith('.gif') || image.dataset.animationFallback === sourceNow) return
        image.dataset.animationFallback = sourceNow
        image.setAttribute('src', sourceNow.replace(/\.gif([?#].*)?$/i, '.png$1'))
      })
    })

    buttons.forEach((button) => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)))
    const onSystemThemeChange = () => {
      if (document.documentElement.dataset.themeMode === 'system') setTheme('system')
    }
    systemTheme.addEventListener?.('change', onSystemThemeChange)
    reducedMotion.addEventListener?.('change', () => setTheme(document.documentElement.dataset.themeMode))
    if (!systemTheme.addEventListener && systemTheme.addListener) systemTheme.addListener(onSystemThemeChange)

    setTheme(savedChoice())
    return { reducedMotion, setTheme }
  }

  function makePlaygroundHref(code) {
    const url = fromRoot('playground.html')
    url.hash = `vizmatic-playground=${encodeURIComponent(code)}`
    return url.href
  }

  function setLinkAvailability(link, href) {
    if (!link) return
    if (href) {
      link.href = href
      link.hidden = false
      link.removeAttribute('aria-disabled')
      link.removeAttribute('tabindex')
    } else {
      link.hidden = true
      link.setAttribute('aria-disabled', 'true')
      link.setAttribute('tabindex', '-1')
    }
  }

  function loadSource(name) {
    if (!name) return Promise.reject(new Error('No source was selected.'))
    if (sources.has(name)) return sources.get(name)

    const request = fetch(fromRoot(`assets/sources/${encodeURIComponent(name)}.json`))
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load source ${name} (${response.status}).`)
        return response.json()
      })
      .then((source) => {
        if (!source || typeof source.code !== 'string') throw new Error(`Source ${name} has no code.`)
        return source
      })
      .catch((error) => {
        sources.delete(name)
        throw error
      })

    sources.set(name, request)
    return request
  }

  let activeSource

  function renderActiveSource() {
    const dialog = $('#sourceDialog')
    const sourceCode = $('#sourceCode')
    if (!activeSource || !sourceCode) return
    const theme = document.documentElement.dataset.siteTheme === 'light' ? 'light' : 'dark'
    const html = activeSource.html?.[theme] ?? activeSource.html?.dark
    if (typeof html === 'string') sourceCode.innerHTML = html
    else {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = activeSource.code
      pre.append(code)
      sourceCode.replaceChildren(pre)
    }
    installCodeCopyButtons(dialog ?? document)
  }

  function closeDialog(dialog) {
    if (!dialog) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  function openDialog(dialog) {
    if (!dialog) return
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal()
    else dialog.setAttribute('open', '')
  }

  function installSourceModal() {
    const dialog = $('#sourceDialog')
    const title = $('#sourceTitle')
    const sourceCode = $('#sourceCode')
    const copyButton = $('#copySourceButton')
    const closeButton = $('#closeSourceButton')
    const tryLink = $('#trySourceLink')
    let requestSequence = 0

    async function showSource(name) {
      if (!dialog) return
      const requestId = ++requestSequence
      activeSource = undefined
      if (title) title.textContent = 'Loading source…'
      if (sourceCode) sourceCode.textContent = ''
      if (copyButton) copyButton.disabled = true
      setLinkAvailability(tryLink, null)
      openDialog(dialog)

      try {
        const source = await loadSource(name)
        if (requestId !== requestSequence) return
        activeSource = source
        if (title) title.textContent = activeSource.title ?? name
        if (copyButton) copyButton.disabled = false
        setLinkAvailability(tryLink, makePlaygroundHref(activeSource.playgroundCode ?? activeSource.code))
        renderActiveSource()
      } catch {
        if (requestId !== requestSequence) return
        if (title) title.textContent = 'Source unavailable'
        if (sourceCode) sourceCode.textContent = 'This example source could not be loaded.'
        if (copyButton) copyButton.disabled = true
        setLinkAvailability(tryLink, null)
      }
    }

    document.addEventListener('click', (event) => {
      const trigger = event.target instanceof Element ? event.target.closest('[data-source]') : null
      if (!trigger) return
      event.preventDefault()
      showSource(trigger.dataset.source)
    })

    copyButton?.addEventListener('click', () => {
      if (activeSource?.code) copyFromButton(copyButton, activeSource.code)
    })
    closeButton?.addEventListener('click', () => closeDialog(dialog))
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog)
    })
  }

  let activeImage

  function renderActiveImage() {
    const imageDialogImage = $('#imageDialogImage')
    if (!activeImage || !imageDialogImage) return
    imageDialogImage.src = activeImage.image.getAttribute('src') || activeImage.image.src
    imageDialogImage.alt = activeImage.image.alt
  }

  function installImageModal() {
    const dialog = $('#imageDialog')
    const title = $('#imageDialogTitle')
    const dialogImage = $('#imageDialogImage')
    const closeButton = $('#closeImageButton')

    document.addEventListener('click', (event) => {
      const button = event.target instanceof Element ? event.target.closest('.gallery-card .image-button') : null
      if (!button || !dialog) return
      const card = button.closest('.gallery-card')
      const image = $('img', button)
      if (!image) return
      activeImage = { card, image }
      const heading = $('h3', card)?.textContent?.trim() ?? image.alt ?? 'Example preview'
      if (title) title.textContent = heading
      if (dialogImage) {
        dialogImage.alt = image.alt
        dialogImage.src = image.getAttribute('src') || image.src
      }
      openDialog(dialog)
    })

    closeButton?.addEventListener('click', () => closeDialog(dialog))
    dialog?.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog)
    })
  }

  function installGalleryFilters() {
    const filters = $$('[data-gallery-filter]')
    const cards = $$('.gallery-card[data-gallery-category]')
    const more = $('[data-gallery-more]')
    const count = $('#galleryCount')
    const empty = $('#galleryEmpty')
    if (cards.length === 0 || filters.length === 0) return

    let activeFilter = filters.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.galleryFilter ?? 'all'
    let expanded = false

    function update() {
      const matching = cards.filter((card) => {
        if (activeFilter === 'all') return true
        const categories = (card.dataset.galleryCategory ?? '').split(/[\s,]+/).filter(Boolean)
        return categories.includes(activeFilter)
      })
      const limit = activeFilter === 'all' && !expanded ? 6 : matching.length
      let visibleCount = 0
      const visibleCards = new Set(matching.slice(0, limit))
      cards.forEach((card) => {
        const visible = visibleCards.has(card)
        card.hidden = !visible
        if (visible) visibleCount += 1
      })

      if (count) count.textContent = visibleCount === matching.length
        ? `${matching.length} example${matching.length === 1 ? '' : 's'}`
        : `Showing ${visibleCount} of ${matching.length} examples`
      if (empty) empty.hidden = matching.length !== 0
      if (more) {
        const remaining = matching.length - visibleCount
        more.hidden = remaining <= 0
        more.textContent = `Show all ${matching.length} examples`
        more.setAttribute('aria-label', `Show all ${matching.length} matching examples`)
      }
    }

    revealGalleryCard = (card) => {
      activeFilter = 'all'
      expanded = true
      filters.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.galleryFilter === 'all')))
      update()
      return card
    }

    filters.forEach((button) => button.addEventListener('click', () => {
      activeFilter = button.dataset.galleryFilter ?? 'all'
      expanded = false
      filters.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)))
      update()
    }))
    more?.addEventListener('click', () => {
      expanded = true
      update()
    })
    update()
  }

  function targetFromHash(hash = window.location.hash) {
    if (!hash || hash === '#') return null
    let id
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      id = hash.slice(1)
    }
    return document.getElementById(id)
  }

  function revealHashTarget(target) {
    const item = target?.closest('[data-catalog-item]')
    if (item) {
      const browser = item.closest('[data-component-browser]')
      catalogControllers.get(browser)?.reveal()
      return item
    }

    const card = target?.closest('.gallery-card[data-gallery-category]')
    if (card && revealGalleryCard) return revealGalleryCard(card)
    return null
  }

  function scrollToHashTarget(target) {
    const revealTarget = revealHashTarget(target)
    if (!revealTarget) return false
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    revealTarget.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
    return true
  }

  function installHashDeepLinks() {
    const pathKey = (pathname) => {
      const normalized = pathname.replace(/\/index\.html$/i, '/')
      return normalized.endsWith('/') ? normalized : `${normalized}/`
    }

    function handleCurrentHash() {
      const target = targetFromHash()
      if (target) scrollToHashTarget(target)
    }

    document.addEventListener('click', (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!anchor) return
      let url
      try {
        url = new URL(anchor.href, document.baseURI)
      } catch {
        return
      }
      if (url.origin !== window.location.origin || pathKey(url.pathname) !== pathKey(window.location.pathname) || !url.hash) return
      const target = targetFromHash(url.hash)
      if (!target || !revealHashTarget(target)) return

      event.preventDefault()
      if (url.href !== window.location.href) window.history.pushState(null, '', url.href)
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.closest('[data-catalog-item], .gallery-card[data-gallery-category]')?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
      })
    })
    window.addEventListener('hashchange', handleCurrentHash)
    handleCurrentHash()
  }

  function installNavigation() {
    const toggles = $$('[data-menu-toggle]')
    if (toggles.length === 0) return

    function controlledNavigation(toggle) {
      const targetId = toggle.getAttribute('aria-controls')
      return (targetId && document.getElementById(targetId)) || $('[data-site-navigation]')
    }

    function setOpen(toggle, open) {
      const navigation = controlledNavigation(toggle)
      toggle.setAttribute('aria-expanded', String(open))
      if (navigation) {
        navigation.dataset.open = String(open)
        navigation.classList.toggle('is-open', open)
      }
    }

    toggles.forEach((toggle) => {
      const navigation = controlledNavigation(toggle)
      const initiallyOpen = toggle.getAttribute('aria-expanded') === 'true'
      if (navigation) {
        navigation.dataset.open = String(initiallyOpen)
        navigation.classList.toggle('is-open', initiallyOpen)
      }
      toggle.addEventListener('click', () => setOpen(toggle, toggle.getAttribute('aria-expanded') !== 'true'))
      navigation?.addEventListener('click', (event) => {
        const link = event.target instanceof Element ? event.target.closest('a') : null
        if (link) setOpen(toggle, false)
      })
    })

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return
      if ($$('dialog[open]').length > 0) return
      toggles.forEach((toggle) => {
        if (toggle.getAttribute('aria-expanded') === 'true') {
          setOpen(toggle, false)
          toggle.focus()
        }
      })
    })
  }

  function loadSearchIndex() {
    if (!searchIndexRequest) {
      searchIndexRequest = fetch(fromRoot('search-index.json'))
        .then((response) => {
          if (!response.ok) throw new Error(`Search index unavailable (${response.status}).`)
          return response.json()
        })
        .then((entries) => {
          if (!Array.isArray(entries)) throw new Error('Search index has an invalid format.')
          return entries.filter((entry) => entry && typeof entry.title === 'string' && typeof entry.url === 'string')
        })
        .catch((error) => {
          searchIndexRequest = undefined
          throw error
        })
    }
    return searchIndexRequest
  }

  function installSearchPalette() {
    const dialog = $('#searchDialog')
    const input = $('#siteSearch')
    const results = $('#siteSearchResults')
    const status = $('#siteSearchStatus')
    if (!dialog || !input || !results || !status) return

    let entries = []
    let hasLoaded = false

    function resultLinks() {
      return $$('a[data-search-result]', results)
    }

    function renderResults() {
      const query = input.value.trim().toLocaleLowerCase()
      if (!hasLoaded) return
      if (!query) {
        results.replaceChildren()
        status.textContent = 'Start typing to search Vizmatic.'
        return
      }

      const tokens = query.split(/\s+/).filter(Boolean)
      const matches = entries.map((entry) => {
        const fields = [entry.title, entry.description, entry.category].filter(Boolean).join(' ').toLocaleLowerCase()
        if (!tokens.every((token) => fields.includes(token))) return null
        const title = entry.title.toLocaleLowerCase()
        const score = (title === query ? 0 : title.startsWith(query) ? 1 : title.includes(query) ? 2 : 3)
        return { entry, score }
      }).filter(Boolean).sort((left, right) => left.score - right.score || left.entry.title.localeCompare(right.entry.title)).slice(0, 12)

      const fragment = document.createDocumentFragment()
      matches.forEach(({ entry }) => {
        let url
        try {
          url = fromRoot(entry.url)
        } catch {
          return
        }
        if (!['http:', 'https:'].includes(url.protocol)) return

        const link = document.createElement('a')
        link.href = url.href
        link.dataset.searchResult = ''
        const heading = document.createElement('span')
        heading.className = 'site-search-result-title'
        heading.textContent = entry.title
        link.append(heading)
        if (typeof entry.description === 'string' && entry.description) {
          const description = document.createElement('span')
          description.className = 'site-search-result-description'
          description.textContent = entry.description
          link.append(description)
        }
        if (typeof entry.category === 'string' && entry.category) {
          const category = document.createElement('span')
          category.className = 'site-search-result-category'
          category.textContent = entry.category
          link.append(category)
        }
        fragment.append(link)
      })
      results.replaceChildren(fragment)
      const count = resultLinks().length
      status.textContent = count === 0 ? 'No results found.' : `${count} result${count === 1 ? '' : 's'}. Use the arrow keys to navigate.`
    }

    async function openSearch() {
      if (!dialog.open) openDialog(dialog)
      input.focus()
      if (hasLoaded) {
        renderResults()
        return
      }
      status.textContent = 'Loading search…'
      try {
        entries = await loadSearchIndex()
        hasLoaded = true
        renderResults()
      } catch {
        status.textContent = 'Search is unavailable right now.'
      }
    }

    $$('[data-open-search]').forEach((button) => button.addEventListener('click', (event) => {
      event.preventDefault()
      openSearch()
    }))
    $$('[data-close-search]').forEach((button) => button.addEventListener('click', () => closeDialog(dialog)))

    input.addEventListener('input', renderResults)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        const first = resultLinks()[0]
        if (first) {
          event.preventDefault()
          first.focus()
        }
      } else if (event.key === 'Enter') {
        const first = resultLinks()[0]
        if (first) {
          event.preventDefault()
          first.click()
        }
      }
    })
    results.addEventListener('keydown', (event) => {
      const links = resultLinks()
      const current = links.indexOf(event.target)
      if (event.key === 'ArrowDown' && links.length) {
        event.preventDefault()
        links[Math.min(current + 1, links.length - 1)].focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (current <= 0) input.focus()
        else links[current - 1].focus()
      }
    })
    results.addEventListener('click', (event) => {
      const result = event.target instanceof Element ? event.target.closest('a[data-search-result]') : null
      if (result) closeDialog(dialog)
    })

    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || focusableTextEntry(event.target)) return
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        openSearch()
      }
    })
  }


  // ── Films ──────────────────────────────────────────────────────────────────

  const FILM_THEMES = { dark: { look: 'midnight', background: '#0c0b09' }, light: { look: 'paper', background: '#f7f3ea' } }

  function filmTheme() {
    return FILM_THEMES[document.documentElement.dataset.siteTheme === 'light' ? 'light' : 'dark']
  }

  function applyFilmTheme(film) {
    if (film.hasAttribute('data-fixed-look')) return
    const { look, background } = filmTheme()
    film.setAttribute('look', look)
    film.setAttribute('background', background)
  }

  /** The engine loads once, and only on pages that show a film. */
  let stageModule
  function loadStage() {
    stageModule ??= import(fromRoot('assets/stage/stage.js').href)
    return stageModule
  }

  function installFilms() {
    const films = $$('vz-film')
    if (films.length === 0 && !$('[data-live-src]')) return
    films.forEach(applyFilmTheme)
    // The hero fades in when it is ready, so the page never shows an empty frame popping into a full one.
    const revealHero = (film) => film.addEventListener('ready', () => film.classList.add('is-ready'), { once: true })
    $$('.hero-film').forEach(revealHero)
    if (films.length > 0) loadStage().catch((error) => console.error('Could not load the film engine.', error))
    document.addEventListener('vizmatic-site-theme', () => {
      // Replacing the element recompiles the film in the new look and keeps its place.
      $$('vz-film').forEach((film) => {
        const { look } = filmTheme()
        if (film.hasAttribute('data-fixed-look') || film.getAttribute('look') === look) return
        const next = film.cloneNode(false)
        const player = film.controller
        applyFilmTheme(next)
        if (player) next.setAttribute('start', String(player.time))
        if (next.classList.contains('hero-film')) {
          next.classList.remove('is-ready')
          revealHero(next)
        }
        film.replaceWith(next)
        next.dispatchEvent(new CustomEvent('vizmatic-film-replaced', { bubbles: true, detail: { film: next } }))
      })
    })
  }

  function whenFilmReady(film, callback) {
    if (film.controller) callback(film.controller)
    else film.addEventListener('ready', (event) => callback(event.detail.player), { once: true })
  }

  /** Scroll position is the timeline. */
  function installScrub() {
    const section = $('[data-scrub]')
    if (!section) return
    const clock = $('[data-scrub-clock]', section)
    const notes = $$('[data-scrub-notes] li', section)
    const bar = $('.scrub-progress', section)
    let player = null
    let queued = false

    function progress() {
      const rect = section.getBoundingClientRect()
      const travel = rect.height - window.innerHeight
      return travel > 0 ? Math.max(0, Math.min(1, -rect.top / travel)) : 0
    }

    function render() {
      queued = false
      const amount = progress()
      section.style.setProperty('--scrub', amount.toFixed(4))
      if (!player) return
      const film = player.film
      const time = amount * film.duration
      player.seek(time)
      if (clock) clock.textContent = `t = ${time.toFixed(2)} s, frame ${Math.round(time * film.fps)}`
      let index = 0
      film.chapters.forEach((chapter, i) => {
        if (time >= chapter.time) index = i
      })
      notes.forEach((note, i) => note.classList.toggle('is-active', i === index))
    }

    function request() {
      if (queued) return
      queued = true
      requestAnimationFrame(render)
    }

    function attach(film) {
      whenFilmReady(film, (next) => {
        player = next
        if (bar && $$('.scrub-mark', bar).length === 0) {
          player.film.chapters.forEach((chapter) => {
            if (chapter.time <= 0) return
            const mark = document.createElement('i')
            mark.className = 'scrub-mark'
            mark.style.left = `${(chapter.time / player.film.duration) * 100}%`
            bar.append(mark)
          })
        }
        render()
      })
    }

    // This film uses TeX, so it and the math engine load only once the reader heads toward it.
    const holder = $('[data-scrub-src]', section)
    let mounted = false
    function mountWhenNear() {
      if (mounted || !holder || section.getBoundingClientRect().top > window.innerHeight * 0.75) return
      mounted = true
      const film = document.createElement('vz-film')
      film.setAttribute('src', fromRoot(holder.dataset.scrubSrc).href)
      film.setAttribute('nocontrols', '')
      film.setAttribute('tabindex', '-1')
      film.setAttribute('label', holder.dataset.label ?? '')
      film.style.pointerEvents = 'none'
      applyFilmTheme(film)
      holder.append(film)
      attach(film)
      loadStage().catch((error) => console.error('Could not load the film engine.', error))
    }

    section.addEventListener('vizmatic-film-replaced', (event) => {
      player = null
      attach(event.detail.film)
    })
    window.addEventListener('scroll', () => {
      mountWhenNear()
      request()
    }, { passive: true })
    window.addEventListener('resize', request)
    mountWhenNear()
    render()
  }

  /** Highlight the source line of the animation that is playing. */
  function installCodeSync() {
    $$('[data-code-sync]').forEach((root) => {
      const pre = $('pre[data-play-lines]', root)
      if (!pre) return
      const lines = $$('.line', pre)
      const playLines = (pre.dataset.playLines ?? '').split(',').filter(Boolean).map(Number)

      function attach(film) {
        whenFilmReady(film, (player) => {
          const clips = player.film.clips
          let active = -1
          const paint = (time) => {
            let index = -1
            clips.forEach((clip, i) => {
              if (time >= clip.t0) index = i
            })
            if (index === active) return
            active = index
            lines.forEach((line) => line.classList.remove('is-active'))
            const line = lines[playLines[index]]
            if (line) line.classList.add('is-active')
          }
          film.addEventListener('timeupdate', (event) => paint(event.detail.time))
          paint(player.time)
        })
      }

      const film = $('vz-film', root)
      if (film) attach(film)
      root.addEventListener('vizmatic-film-replaced', (event) => attach(event.detail.film))
    })
  }

  /** Posters become live on hover or focus. Touch devices keep the poster and the link. */
  function installFilmWall() {
    const frames = $$('[data-live-src]')
    if (frames.length === 0) return
    const canHover = window.matchMedia('(hover: hover)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    frames.forEach((frame) => {
      const item = frame.closest('.wall-item') ?? frame
      const poster = $('img', frame)
      const start = () => {
        if (frame.querySelector('vz-film')) return
        const film = document.createElement('vz-film')
        film.setAttribute('src', fromRoot(frame.dataset.liveSrc).href)
        film.setAttribute('nocontrols', '')
        film.setAttribute('autoplay', '')
        film.setAttribute('loop', '')
        film.setAttribute('tabindex', '-1')
        film.setAttribute('start', frame.dataset.posterTime ?? '0')
        film.setAttribute('label', frame.dataset.label ?? 'Film preview')
        if (frame.dataset.look) {
          film.setAttribute('data-fixed-look', '')
          film.setAttribute('look', frame.dataset.look)
        }
        applyFilmTheme(film)
        loadStage().catch(() => {})
        frame.append(film)
        film.addEventListener('ready', () => {
          if (poster) poster.style.opacity = '0'
        }, { once: true })
      }
      const stop = () => {
        frame.querySelector('vz-film')?.remove()
        if (poster) poster.style.opacity = ''
      }
      if (canHover && !reduced) {
        item.addEventListener('pointerenter', start)
        item.addEventListener('pointerleave', stop)
        item.addEventListener('focusin', start)
        item.addEventListener('focusout', stop)
      }
      // A film without a poster shows its own frame, compiled when it scrolls near.
      if (!poster) {
        const observer = new IntersectionObserver((entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return
          observer.disconnect()
          const film = document.createElement('vz-film')
          film.setAttribute('src', fromRoot(frame.dataset.liveSrc).href)
          film.setAttribute('nocontrols', '')
          film.setAttribute('tabindex', '-1')
          film.setAttribute('label', frame.dataset.label ?? 'Film preview')
          if (frame.dataset.look) {
            film.setAttribute('data-fixed-look', '')
            film.setAttribute('look', frame.dataset.look)
          }
          applyFilmTheme(film)
          film.addEventListener('ready', (event) => {
            const { player, film: compiled } = event.detail
            const time = frame.dataset.posterTime ? Number(frame.dataset.posterTime) : compiled.duration * 0.66
            player.seek(time)
          }, { once: true })
          loadStage().catch(() => {})
          frame.append(film)
        }, { rootMargin: '200px' })
        observer.observe(frame)
      }
    })
  }

  function installFilmPage() {
    const root = $('[data-film-page]')
    if (!root) return
    const film = $('vz-film', root)
    const list = $('[data-chapters]', root)
    if (!film || !list) return

    function attach(current) {
      whenFilmReady(current, (player) => {
        const chapters = player.film.chapters
        const format = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
        list.replaceChildren(...chapters.map((chapter, index) => {
          const item = document.createElement('li')
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = chapter.title
          const stamp = document.createElement('span')
          stamp.textContent = format(chapter.time)
          button.append(stamp)
          button.addEventListener('click', () => {
            player.seek(chapter.time)
            player.play()
          })
          button.dataset.index = String(index)
          item.append(button)
          return item
        }))
        const buttons = $$('button', list)
        current.addEventListener('timeupdate', (event) => {
          let active = -1
          chapters.forEach((chapter, i) => {
            if (event.detail.time >= chapter.time) active = i
          })
          buttons.forEach((button, i) => button.classList.toggle('is-active', i === active))
        })
        list.hidden = chapters.length === 0
      })
    }
    attach(film)
    root.addEventListener('vizmatic-film-replaced', (event) => attach(event.detail.film))
  }

  function installLab() {
    const lab = $('[data-lab]')
    if (!lab) return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      Promise.all([loadStage(), import(fromRoot('assets/stage/site/lab.js').href)])
        .then(([, module]) => module.mountLab(lab, filmTheme))
        .catch((error) => console.error('Could not start the live laboratory.', error))
    }, { rootMargin: '400px' })
    observer.observe(lab)
  }

  function installFigures() {
    $$('[data-figures]').forEach((root) => {
      const buttons = $$('[data-figure]', root)
      const image = $('img', root)
      const caption = $('[data-figure-caption]', root)
      const size = $('[data-figure-size]', root)
      buttons.forEach((button) => button.addEventListener('click', () => {
        buttons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)))
        const theme = document.documentElement.dataset.siteTheme === 'light' ? 'light' : 'dark'
        image.dataset.themeImageBase = `${siteRoot}assets/examples/${button.dataset.figure}`
        image.src = `${image.dataset.themeImageBase}_${theme}.png`
        image.alt = button.dataset.alt ?? ''
        if (caption) caption.textContent = button.dataset.caption ?? ''
        if (size) size.textContent = button.dataset.source ?? ''
      }))
    })
  }

  function installInstallCopy() {
    $$('[data-copy-install]').forEach((button) => {
      button.addEventListener('click', () => copyFromButton(button, button.parentElement?.querySelector('code')?.textContent ?? ''))
    })
  }

  /** On-page navigation that follows the reader. */
  function installDocsToc() {
    const links = $$('[data-toc] a')
    if (links.length === 0) return
    const targets = links.map((link) => document.getElementById(link.getAttribute('href').slice(1))).filter(Boolean)
    const observer = new IntersectionObserver(() => {
      let current = targets[0]
      for (const target of targets) {
        if (target.getBoundingClientRect().top < 140) current = target
      }
      links.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${current?.id}`))
    }, { rootMargin: '-10% 0px -70% 0px', threshold: [0, 1] })
    targets.forEach((target) => observer.observe(target))
  }

  function installApiFilter() {
    const input = $('[data-api-filter]')
    if (!input) return
    const entries = $$('[data-api-entry]')
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase()
      entries.forEach((entry) => {
        entry.hidden = Boolean(query) && !(entry.dataset.apiEntry ?? '').includes(query)
      })
      $$('[data-api-group]').forEach((group) => {
        group.hidden = $$('[data-api-entry]', group).every((entry) => entry.hidden)
      })
    })
  }

  /** Old links to the landing page sections still arrive at the right place. */
  function installLegacyAnchors() {
    if (!$('.hero')) return
    const hash = window.location.hash
    if (!hash) return
    const moved = (target) => window.location.replace(fromRoot(target).href)
    if (/^#(gallery|science|example-)/.test(hash)) moved(`examples.html${hash}`)
    else if (/^#(component-browser|components|category-|component-|reference-component-)/.test(hash)) moved(`components.html${hash}`)
    else if (hash === '#video') moved('films.html')
    else if (hash === '#agent-prompt' || hash === '#onboarding') moved('agents.html')
  }

  function startSite() {
    installLegacyAnchors()
    installCodeCopyButtons()
    installCatalogs()
    installCopyPromptAndSkill()
    installTheme()
    installSourceModal()
    installImageModal()
    installGalleryFilters()
    installNavigation()
    installSearchPalette()
    installPlaygroundShortcut()
    installSharedExample()
    installHashDeepLinks()
    installFilms()
    installScrub()
    installCodeSync()
    installFilmWall()
    installFilmPage()
    installLab()
    installFigures()
    installInstallCopy()
    installDocsToc()
    installApiFilter()
    document.documentElement.classList.add('js')
  }

  function installPlaygroundShortcut() {
    const source = $('#playgroundSource')
    const run = $('#playgroundRunButton')
    source?.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === 'Enter') {
        event.preventDefault()
        run?.click()
      }
    })
  }

  function installSharedExample() {
    const source = $('#playgroundSource')
    if (!source || window.location.hash) return
    const name = new URLSearchParams(window.location.search).get('example')
    if (!name || !/^[a-z0-9-]+$/.test(name)) return

    loadSource(name).then((example) => {
      if (new URLSearchParams(window.location.search).get('example') !== name) return
      const oldUrl = window.location.href
      const url = new URL(oldUrl)
      url.searchParams.delete('example')
      url.hash = `vizmatic-playground=${encodeURIComponent(example.playgroundCode ?? example.code)}`
      window.history.replaceState(null, '', url)
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: oldUrl, newURL: url.href }))
    }).catch(() => {
      if (new URLSearchParams(window.location.search).get('example') !== name) return
      const error = $('#playgroundError')
      if (!error) return
      error.textContent = 'Could not load this example. Choose a template or try again.'
      error.hidden = false
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSite, { once: true })
  else startSite()
})()
