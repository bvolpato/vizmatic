/** The preview page. It has no dependencies beyond the engine it imports from the server. */
export function previewPage(fileName: string): string {
    const safeName = fileName.replace(/[<>&"]/g, '')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} | vizmatic preview</title>
<style>
:root { color-scheme: dark; --bg: #0b0c10; --panel: #101218; --line: #252832; --ink: #f2efe6; --dim: #a5a7ad; --faint: #5c5f68; --accent: #ffd75e; --err: #ff8d8d; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--ink); font: 13px/1.45 ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace; }
body { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
button, select { font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 9px; cursor: pointer; }
button:hover, select:hover { border-color: var(--faint); }
button:focus-visible, select:focus-visible, .timeline:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
header { display: flex; align-items: center; gap: 14px; padding: 9px 16px; border-bottom: 1px solid var(--line); min-width: 0; }
header .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .file { color: var(--faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
header .spacer { flex: 1; }
header .state { color: var(--dim); white-space: nowrap; }
header .state[data-kind="busy"] { color: var(--accent); }
header .state[data-kind="error"] { color: var(--err); }
main { position: relative; display: grid; place-items: center; min-height: 0; padding: 18px; overflow: hidden; }
.frame { position: relative; line-height: 0; box-shadow: 0 0 0 1px var(--line); }
canvas { display: block; width: 100%; height: 100%; }
.overlay { position: absolute; inset: 0; pointer-events: none; }
.overlay div { position: absolute; border: 1.5px solid var(--err); background: rgba(255, 90, 90, .08); }
.overlay div[data-severity="warning"] { border-color: var(--accent); background: rgba(255, 215, 94, .06); }
.error { position: absolute; inset: 18px; overflow: auto; padding: 18px 20px; white-space: pre-wrap; color: var(--err); background: rgba(16, 8, 10, .95); border: 1px solid #5a2a2e; border-radius: 8px; }
footer { border-top: 1px solid var(--line); background: var(--panel); padding: 10px 16px 12px; display: grid; gap: 8px; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.time { font-variant-numeric: tabular-nums; min-width: 12ch; }
.chapters { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.chapters button { border-color: transparent; color: var(--dim); padding: 2px 7px; }
.chapters button[aria-current="true"] { color: var(--ink); border-color: var(--line); }
.timeline { position: relative; height: 34px; border-radius: 4px; background: #0b0c10; box-shadow: inset 0 0 0 1px var(--line); cursor: pointer; touch-action: none; overflow: hidden; }
.clip { position: absolute; top: 5px; height: 16px; border-radius: 2px; background: #27303c; overflow: hidden; color: var(--dim); font-size: 10px; line-height: 16px; padding: 0 4px; white-space: nowrap; }
.tick { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--faint); }
.issue { position: absolute; bottom: 3px; height: 4px; border-radius: 2px; background: var(--err); }
.issue[data-severity="warning"] { background: var(--accent); }
.playhead { position: absolute; top: 0; bottom: 0; width: 1.5px; background: var(--accent); }
.issues { color: var(--dim); max-height: 84px; overflow: auto; display: grid; gap: 2px; }
.issues button { all: unset; cursor: pointer; display: block; }
.issues button:hover, .issues button:focus-visible { color: var(--ink); }
.issues b { font-weight: 400; color: var(--err); }
.issues b[data-severity="warning"] { color: var(--accent); }
.keys { color: var(--faint); margin-left: auto; white-space: nowrap; }
kbd { font: inherit; color: var(--dim); }
</style>
</head>
<body>
<header>
  <span class="title" id="title">Loading</span>
  <span class="file">${safeName}</span>
  <span class="spacer"></span>
  <span class="state" id="state">Compiling</span>
</header>
<main id="main">
  <div class="frame" id="frame"><canvas id="canvas" role="img" aria-label="Film preview"></canvas><div class="overlay" id="overlay"></div></div>
  <div class="error" id="error" role="alert" hidden></div>
</main>
<footer>
  <div class="timeline" id="timeline" tabindex="0" role="slider" aria-label="Timeline" aria-valuemin="0" aria-valuenow="0"><div class="playhead" id="playhead"></div></div>
  <div class="row">
    <button id="toggle" type="button">Play</button>
    <span class="time" id="time">0:00.00</span>
    <label>Look <select id="look"></select></label>
    <label>Speed <select id="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option></select></label>
    <label><input type="checkbox" id="loop" checked> Loop</label>
    <label><input type="checkbox" id="show-issues" checked> Issues</label>
    <div class="chapters" id="chapters"></div>
    <span class="keys"><kbd>space</kbd> play <kbd>left/right</kbd> 1s <kbd>,/.</kbd> frame <kbd>[/]</kbd> chapter <kbd>0-9</kbd> seek</span>
  </div>
  <div class="issues" id="issues" hidden></div>
</footer>
<script type="module">
import { FilmPlayer, checkFilm, isFilm, LOOKS } from '/stage/stage.js'

const el = (id) => document.getElementById(id)
const params = new URLSearchParams(location.search)
const remembered = { time: Number(params.get('t')) || 0, playing: false, look: params.get('look') || '' }
const state = { player: null, film: null, definition: null, report: null, version: 0, loading: 0 }

for (const name of Object.keys(LOOKS)) el('look').append(new Option(name, name))
el('look').prepend(new Option('Film default', ''))
el('look').value = remembered.look

function setState(text, kind) {
  el('state').textContent = text
  el('state').dataset.kind = kind || ''
}

function showError(message) {
  el('error').textContent = message
  el('error').hidden = false
  setState('Error', 'error')
}

function clearError() {
  el('error').hidden = true
}

function clock(t) {
  const m = Math.floor(t / 60)
  return m + ':' + (t - m * 60).toFixed(2).padStart(5, '0')
}

function report(kind, message) {
  fetch('/log', { method: 'POST', body: JSON.stringify({ kind, message }) }).catch(() => {})
}

function sizeFrame() {
  const film = state.film
  if (!film) return
  const box = el('main').getBoundingClientRect()
  const scale = Math.min((box.width - 36) / film.width, (box.height - 36) / film.height)
  el('frame').style.width = Math.max(64, Math.floor(film.width * scale)) + 'px'
  el('frame').style.height = Math.max(36, Math.floor(film.height * scale)) + 'px'
  state.player?.resize()
}
addEventListener('resize', sizeFrame)

function drawTimeline() {
  const film = state.film
  const track = el('timeline')
  track.querySelectorAll('.clip,.tick,.issue').forEach((node) => node.remove())
  track.setAttribute('aria-valuemax', String(film.duration))
  const at = (t) => (t / film.duration) * 100 + '%'
  for (const clip of film.clips) {
    const block = document.createElement('div')
    block.className = 'clip'
    block.style.left = at(clip.t0)
    block.style.width = 'calc(' + ((clip.t1 - clip.t0) / film.duration) * 100 + '% - 1px)'
    block.textContent = clip.labels.join(' ')
    block.title = clip.labels.join(', ') + ' ' + clip.t0.toFixed(2) + 's to ' + clip.t1.toFixed(2) + 's'
    track.append(block)
  }
  for (const chapter of film.chapters) {
    const tick = document.createElement('div')
    tick.className = 'tick'
    tick.style.left = at(chapter.time)
    tick.title = chapter.title
    track.append(tick)
  }
  for (const issue of state.report?.diagnostics ?? []) {
    const mark = document.createElement('div')
    mark.className = 'issue'
    mark.dataset.severity = issue.severity
    mark.style.left = at(issue.time)
    mark.style.width = 'max(3px, ' + ((issue.until - issue.time) / film.duration) * 100 + '%)'
    mark.title = issue.message
    track.append(mark)
  }
  const chapters = el('chapters')
  chapters.replaceChildren(...film.chapters.map((chapter) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = chapter.title
    button.dataset.time = chapter.time
    button.addEventListener('click', () => state.player.seek(chapter.time))
    return button
  }))
}

function drawIssues() {
  const issues = state.report?.diagnostics ?? []
  const list = el('issues')
  list.hidden = issues.length === 0 || !el('show-issues').checked
  list.replaceChildren(...issues.map((issue) => {
    const button = document.createElement('button')
    button.type = 'button'
    const severity = document.createElement('b')
    severity.dataset.severity = issue.severity
    severity.textContent = issue.severity
    button.append(severity, ' ' + clock(issue.time) + ' ' + issue.message)
    button.addEventListener('click', () => state.player.seek(issue.time))
    return button
  }))
}

function onTime(time) {
  const film = state.film
  el('time').textContent = clock(time) + ' / ' + clock(film.duration)
  el('playhead').style.left = (time / film.duration) * 100 + '%'
  el('timeline').setAttribute('aria-valuenow', time.toFixed(2))
  history.replaceState(null, '', '?t=' + time.toFixed(2) + (el('look').value ? '&look=' + el('look').value : ''))
  for (const button of el('chapters').children) {
    const next = button.nextElementSibling
    const active = time >= Number(button.dataset.time) && (!next || time < Number(next.dataset.time))
    button.setAttribute('aria-current', active ? 'true' : 'false')
  }
  const overlay = el('overlay')
  overlay.replaceChildren()
  if (!el('show-issues').checked) return
  for (const issue of state.report?.diagnostics ?? []) {
    if (time < issue.time - 0.05 || time > issue.until + 0.05) continue
    const box = document.createElement('div')
    box.dataset.severity = issue.severity
    box.title = issue.message
    box.style.left = (issue.box.x / film.width) * 100 + '%'
    box.style.top = (issue.box.y / film.height) * 100 + '%'
    box.style.width = (issue.box.width / film.width) * 100 + '%'
    box.style.height = (issue.box.height / film.height) * 100 + '%'
    overlay.append(box)
  }
}

async function compile() {
  const ticket = ++state.loading
  setState('Compiling', 'busy')
  const started = performance.now()
  try {
    const film = await state.definition.compile(el('look').value ? { look: el('look').value } : {})
    if (ticket !== state.loading) return
    const previous = state.player
    if (previous) {
      remembered.time = previous.time
      remembered.playing = previous.isPlaying
      previous.destroy()
    }
    // A canvas keeps its 2D context settings, so a replacement avoids alpha mismatches between films.
    const fresh = document.createElement('canvas')
    fresh.id = 'canvas'
    fresh.setAttribute('role', 'img')
    fresh.setAttribute('aria-label', 'Film preview')
    el('canvas').replaceWith(fresh)
    state.film = film
    el('title').textContent = film.title || 'Untitled film'
    document.title = (film.title || 'Untitled film') + ' | vizmatic preview'
    sizeFrame()
    state.report = await checkFilm(film)
    if (ticket !== state.loading) return
    drawTimeline()
    drawIssues()
    state.player = new FilmPlayer(fresh, film, {
      loop: el('loop').checked,
      speed: Number(el('speed').value),
      onTime,
      onState: ({ playing }) => { el('toggle').textContent = playing ? 'Pause' : 'Play' },
    })
    sizeFrame()
    state.player.seek(Math.min(film.duration, remembered.time))
    if (remembered.playing) state.player.play()
    fresh.addEventListener('click', () => state.player.toggle())
    clearError()
    const ms = Math.round(performance.now() - started)
    const errors = state.report.summary.errors, warnings = state.report.summary.warnings
    const issues = errors + warnings ? ', ' + errors + ' error(s), ' + warnings + ' warning(s)' : ''
    setState('Ready in ' + ms + ' ms' + issues, errors ? 'error' : '')
    report('compiled', { ms, errors, warnings, duration: film.duration })
  } catch (error) {
    if (ticket !== state.loading) return
    const message = error && error.stack ? error.stack : String(error)
    showError('The film failed while compiling.\\n\\n' + message)
    report('error', message)
  }
}

async function load(version) {
  try {
    const module = await import('/film.js?v=' + version)
    if (!isFilm(module.default)) throw new Error('The file must export a film as its default export: export default film({ title: "Intro" }, (s) => { ... })')
    state.definition = module.default
    await compile()
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error)
    showError('The film could not load.\\n\\n' + message)
    report('error', message)
  }
}

const events = new EventSource('/events')
events.addEventListener('build', (event) => {
  const data = JSON.parse(event.data)
  if (data.version === state.version) return
  state.version = data.version
  void load(data.version)
})
events.addEventListener('build-error', (event) => {
  showError(JSON.parse(event.data).message)
})
events.onerror = () => setState('Disconnected from the preview server', 'error')

el('toggle').addEventListener('click', () => state.player?.toggle())
el('look').addEventListener('change', () => { if (state.definition) void compile() })
el('speed').addEventListener('change', () => { if (state.player) state.player.speed = Number(el('speed').value) })
el('loop').addEventListener('change', () => { if (state.definition) void compile() })
el('show-issues').addEventListener('change', () => { drawIssues(); if (state.player) onTime(state.player.time) })

const timeline = el('timeline')
const seekFrom = (event) => {
  const rect = timeline.getBoundingClientRect()
  state.player?.seek(((event.clientX - rect.left) / rect.width) * state.film.duration)
}
timeline.addEventListener('pointerdown', (event) => {
  timeline.setPointerCapture(event.pointerId)
  seekFrom(event)
  const move = (next) => seekFrom(next)
  timeline.addEventListener('pointermove', move)
  timeline.addEventListener('pointerup', () => timeline.removeEventListener('pointermove', move), { once: true })
})

addEventListener('keydown', (event) => {
  const player = state.player
  if (!player || event.target.matches('select, input')) return
  const frame = 1 / state.film.fps
  const key = event.key
  if (key === ' ' || key === 'k') player.toggle()
  else if (key === 'ArrowRight') player.seek(player.time + (event.shiftKey ? 5 : 1))
  else if (key === 'ArrowLeft') player.seek(player.time - (event.shiftKey ? 5 : 1))
  else if (key === '.') { player.pause(); player.seek(player.time + frame) }
  else if (key === ',') { player.pause(); player.seek(player.time - frame) }
  else if (key === ']') player.next()
  else if (key === '[') player.previous()
  else if (key === 'Home') player.seek(0)
  else if (key === 'End') player.seek(state.film.duration)
  else if (/^[0-9]$/.test(key)) player.seek((Number(key) / 10) * state.film.duration)
  else return
  event.preventDefault()
})
</script>
</body>
</html>
`
}
