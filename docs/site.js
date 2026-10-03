(() => {
  'use strict'

  const $ = (selector, scope = document) => scope.querySelector(selector)
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector))
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
        promptRequest = fetch(new URL('PROMPT.md', document.baseURI))
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
      if (base) return `${base}_${theme}.${extension}`

      const source = image.getAttribute('src') ?? ''
      const match = source.match(/^(.*)_(?:dark|light)\.(png|gif)([?#].*)?$/i)
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

      meta?.setAttribute('content', resolved === 'light' ? '#fafafc' : '#0b0d16')
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
    }

    $$('[data-theme-image]').forEach((image) => {
      const source = image.getAttribute('src') ?? ''
      const match = source.match(/^(.*)_(?:dark|light)\.(?:png|gif)(?:[?#].*)?$/i)
      if (!image.dataset.themeImageBase && match) image.dataset.themeImageBase = match[1]

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
    const url = new URL('playground.html', document.baseURI)
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

    const request = fetch(new URL(`assets/sources/${encodeURIComponent(name)}.json`, document.baseURI))
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

  function installDemoShowcase() {
    const image = $('#demoImage')
    const sourceButton = $('#demoSourceButton')
    const tryLink = $('#demoTryLink')
    const title = $('#demoTitle')
    const choices = $$('[data-demo-choice]')
    if (!image || choices.length === 0) return
    let selectionSequence = 0

    function nameFromImage() {
      const match = (image.getAttribute('src') ?? '').match(/\/([^/]+)_(?:dark|light)\.(?:png|gif)$/i)
      return image.dataset.demoExample ?? match?.[1] ?? 'system-architecture'
    }

    function setDemoImage(name) {
      const animated = name === 'animated-pipeline'
      image.dataset.demoExample = name
      image.dataset.themeImageBase = `assets/examples/${name}`
      if (animated) image.setAttribute('data-animated', '')
      else image.removeAttribute('data-animated')

      const theme = document.documentElement.dataset.siteTheme === 'light' ? 'light' : 'dark'
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const extension = animated && !reduced ? 'gif' : 'png'
      image.src = `${image.dataset.themeImageBase}_${theme}.${extension}`
    }

    function demoTitle(name) {
      const titles = {
        'website-workflow': 'From idea to visual',
        'system-architecture': 'System architecture',
        'eval-dashboard': 'Evaluation dashboard',
        'animated-pipeline': 'Animated pipeline',
      }
      return titles[name] ?? name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    }

    function updateDemoCopy(name) {
      const labels = {
        'website-workflow': 'A prompt becomes a rendered Vizmatic visual.',
        'system-architecture': 'System architecture diagram rendered with Vizmatic.',
        'eval-dashboard': 'Evaluation dashboard rendered with Vizmatic.',
        'animated-pipeline': 'Animated agent pipeline rendered with Vizmatic.',
      }
      if (title) title.textContent = demoTitle(name)
      image.alt = labels[name] ?? `${demoTitle(name)} rendered with Vizmatic.`
    }

    async function choose(name) {
      if (!name) return
      const selectionId = ++selectionSequence
      choices.forEach((choice) => {
        if (choice instanceof HTMLButtonElement) choice.setAttribute('aria-pressed', String(choice.dataset.demoChoice === name))
        else if (choice instanceof HTMLSelectElement) choice.value = name
      })
      setDemoImage(name)
      updateDemoCopy(name)
      if (sourceButton) sourceButton.dataset.source = name
      setLinkAvailability(tryLink, null)

      try {
        const source = await loadSource(name)
        if (selectionId !== selectionSequence) return
        if (title) title.textContent = source.title ?? name
        setLinkAvailability(tryLink, makePlaygroundHref(source.playgroundCode ?? source.code))
      } catch {
        if (selectionId !== selectionSequence) return
        setLinkAvailability(tryLink, null)
      }
    }

    choices.forEach((choice) => {
      const name = choice.dataset.demoChoice ?? (choice instanceof HTMLSelectElement ? choice.value : '')
      if (choice instanceof HTMLSelectElement) choice.addEventListener('change', () => choose(choice.value))
      else choice.addEventListener('click', () => choose(name))
    })

    const initialName = nameFromImage()
    setDemoImage(initialName)
    updateDemoCopy(initialName)
    choices.forEach((choice) => {
      if (choice instanceof HTMLButtonElement) choice.setAttribute('aria-pressed', String(choice.dataset.demoChoice === initialName))
      else if (choice instanceof HTMLSelectElement && !choice.value) choice.value = initialName
    })
    if (sourceButton) sourceButton.dataset.source = initialName
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
      searchIndexRequest = fetch(new URL('search-index.json', document.baseURI))
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
          url = new URL(entry.url, document.baseURI)
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

  function startSite() {
    installCodeCopyButtons()
    installCatalogs()
    installCopyPromptAndSkill()
    installTheme()
    installSourceModal()
    installImageModal()
    installDemoShowcase()
    installGalleryFilters()
    installNavigation()
    installSearchPalette()
    installPlaygroundShortcut()
    installSharedExample()
    installHashDeepLinks()
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
      const oldUrl = window.location.href
      const url = new URL(oldUrl)
      url.searchParams.delete('example')
      url.hash = `vizmatic-playground=${encodeURIComponent(example.playgroundCode ?? example.code)}`
      window.history.replaceState(null, '', url)
      window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: oldUrl, newURL: url.href }))
    }).catch(() => {
      const error = $('#playgroundError')
      if (!error) return
      error.textContent = 'Could not load this example. Choose a template or try again.'
      error.hidden = false
    })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSite, { once: true })
  else startSite()
})()
