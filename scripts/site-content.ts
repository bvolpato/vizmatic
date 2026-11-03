import { access, readdir, readFile } from 'node:fs/promises'
import { escapeHtml } from './site-markdown'

export interface FilmEntry {
    id: string
    title: string
    summary: string
    topic?: string
    duration?: number
    posterTime?: number
    featured?: boolean
    look?: string
}

const exists = (path: string) => access(path).then(() => true, () => false)

/**
 * The film catalog, in its authored order. A film file that is not cataloged yet
 * still appears, with the title and description from its source.
 */
export async function loadFilmCatalog(): Promise<FilmEntry[]> {
    const raw = await readFile('examples/films/catalog.json', 'utf8').catch(() => null)
    const parsed = raw ? JSON.parse(raw) as FilmEntry[] | { films: FilmEntry[] } : []
    const listed = Array.isArray(parsed) ? parsed : parsed.films
    const names = (await readdir('examples/films').catch(() => [] as string[])).filter((name) => /\.tsx?$/.test(name) && !name.startsWith('_') && !name.endsWith('.d.ts')).sort()
    const ids = new Set(names.map((name) => name.replace(/\.tsx?$/, '')))
    const out = listed.filter((film) => ids.has(film.id))
    const known = new Set(listed.map((film) => film.id))
    for (const name of names) {
        const id = name.replace(/\.tsx?$/, '')
        if (known.has(id)) continue
        const source = await readFile(`examples/films/${name}`, 'utf8')
        const title = /\btitle:\s*'([^']+)'/.exec(source)?.[1] ?? id.replace(/-/g, ' ')
        const summary = /\bdescription:\s*'([^']+)'/.exec(source)?.[1] ?? ''
        out.push({ id, title, summary })
    }
    return out
}

export function formatDuration(seconds: number | undefined): string {
    if (!seconds) return ''
    return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
}

/** A wide film spans two rows beside two small ones. Every third row flips sides, so the wall reads as a layout. */
function wideIndexes(count: number): Map<number, 'left' | 'right'> {
    const wide = new Map<number, 'left' | 'right'>()
    for (let i = 0, side = 0; i + 3 <= count; i += 6, side++) wide.set(i, side % 2 === 0 ? 'left' : 'right')
    return wide
}

export async function renderFilmWall(films: readonly FilmEntry[], root: string, options: { limit?: number; emphasize?: boolean } = {}): Promise<string> {
    if (films.length === 0) return '<p class="film-empty">The first films are rendering. Check back soon.</p>'
    // The title film is the hero of the home page, and is not a film to study.
    const ordered = films.filter((film) => film.topic !== 'Brand').sort((a, b) => Number(b.featured ?? false) - Number(a.featured ?? false))
    const shown = options.limit ? ordered.slice(0, options.limit) : ordered
    const wide = options.emphasize === false ? new Map<number, 'left' | 'right'>() : wideIndexes(shown.length)
    const items = await Promise.all(shown.map(async (film, index) => {
        const hasPoster = await exists(`docs/assets/site/posters/${film.id}_dark.webp`)
        const meta = [film.topic, formatDuration(film.duration)].filter(Boolean).join(', ')
        // Posters come from the site's themes. Films follow the same theme unless they have their own look.
        const fixedLook = film.look && film.look !== 'midnight' ? ` data-look="${escapeHtml(film.look)}"` : ''
        const poster = hasPoster ? `<img data-theme-image src="${root}assets/site/posters/${film.id}_dark.webp" alt="" width="960" height="540" loading="lazy" decoding="async">` : ''
        const side = wide.get(index)
        return `<a class="wall-item${side ? ` is-wide is-${side}` : ''}" href="${root}film/${film.id}.html"><span class="wall-frame" data-live-src="assets/stage/films/${film.id}.js"${film.posterTime !== undefined ? ` data-poster-time="${film.posterTime}"` : ''}${fixedLook} data-label="${escapeHtml(film.summary || film.title)}">${poster}</span><h3>${escapeHtml(film.title)}</h3><p>${escapeHtml(film.summary)}</p>${meta ? `<span class="meta">${escapeHtml(meta)}</span>` : ''}</a>`
    }))
    return `<div class="wall">${items.join('')}</div>`
}

interface Measurements {
    export?: { fps: number; width: number; height: number; filmFps: number; threads: number; frames: number; machine?: string }
    legacyVideo?: { fps: number; height: number }
    seek?: { ms: number; film: string; machine?: string }
}

export async function renderClaims(componentCount: number): Promise<string> {
    const raw = await readFile('docs/assets/site/measurements.json', 'utf8').catch(() => null)
    const numbers: Measurements = raw ? JSON.parse(raw) as Measurements : {}
    const seek = numbers.seek
    const exportStats = numbers.export
    const legacy = numbers.legacyVideo
    const rows: [string, string, string][] = [
        ['Every frame is a pure function of time.', 'A film compiles to keys on tracks. Sampling any time needs no replay, so scrubbing runs both ways and a scroll bar can drive it.', seek ? `${seek.ms.toFixed(1)} ms per seek` : ''],
        ['One source. Browser and MP4.', `The same function paints to a canvas and exports frame-exact H.264 on worker threads${exportStats ? `, about ${Math.round(exportStats.fps)} frames per second at ${exportStats.height}p with bloom on ${exportStats.threads} threads` : ''}.${legacy ? ` On the same machine in the same run, the older layout-based video path reaches about ${Math.round(legacy.fps)} at ${legacy.height}p.` : ''}`, exportStats ? `${Math.round(exportStats.fps)} fps export` : ''],
        ['Real math, with no LaTeX install.', 'Equations are typeset with a bundled TeX engine into vector glyphs. Terms keep their identity, so equations morph term by term.', ''],
        ['TypeScript, not Python.', 'Films are typed modules that run on Node.js 20 or in a browser. Your editor knows every property.', ''],
        ['Made for coding agents too.', 'Plain functions, stable output, an installable skill, machine-readable docs, and a check command that reports problems as JSON.', ''],
        ['Diagrams that hold a page of facts.', `${componentCount} typed components for architecture, data, and science, at print density by default and larger when you ask.`, ''],
    ]
    return `<ul class="claims">${rows.map(([title, body, stat]) => `<li><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p><span class="meta">${escapeHtml(stat)}</span></li>`).join('')}</ul>`
}

export interface FigureChoice {
    name: string
    label: string
    alt: string
    caption: string
}

export async function renderFigures(choices: readonly FigureChoice[]): Promise<string> {
    const available = (await Promise.all(choices.map(async (choice) => (await exists(`docs/assets/examples/${choice.name}_dark.png`)) ? choice : null))).filter((choice): choice is FigureChoice => choice !== null)
    if (available.length === 0) return ''
    const first = available[0]!
    const buttons = available.map((choice, index) => `<button type="button" aria-pressed="${index === 0}" data-figure="${choice.name}" data-alt="${escapeHtml(choice.alt)}" data-caption="${escapeHtml(choice.caption)}">${escapeHtml(choice.label)}</button>`).join('')
    return `<div data-figures><div class="figure-tabs" role="group" aria-label="Choose a figure">${buttons}</div><div class="figure-frame"><img data-theme-image src="assets/examples/${first.name}_dark.png" alt="${escapeHtml(first.alt)}" loading="lazy" decoding="async"></div><div class="figure-caption"><span data-figure-caption>${escapeHtml(first.caption)}</span><span class="figure-actions"><button class="text-link" type="button" data-figure-source data-source="${first.name}">View source</button><a class="text-link" href="examples.html">All rendered examples</a></span></div></div>`
}
