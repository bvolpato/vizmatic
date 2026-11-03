/**
 * A small Markdown renderer for the guides. The sources are ours, so it covers
 * what they use: headings, paragraphs, lists, tables, quotes, code fences, and
 * inline code, emphasis, and links. Lines that start with an HTML tag pass through.
 */
export interface FenceBlock {
    lang: string
    info: Record<string, string | true>
    code: string
}

export interface MarkdownOptions {
    /** Render a code fence. Must return HTML. */
    fence: (block: FenceBlock) => string
}

export interface Heading {
    level: number
    text: string
    id: string
}

export interface MarkdownResult {
    html: string
    headings: Heading[]
}

export function escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function slugify(text: string): string {
    return text.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function inline(source: string): string {
    // Links first, because link text can hold code. Code next, so nothing inside it is reinterpreted.
    return source.split(/(\[[^\]]+\]\([^)\s]+\))/g).map((part) => {
        const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part)
        if (link) {
            // The first guide is the docs index, so links to it use that file name.
            const target = link[2]!.replace(/^getting-started\.md/, 'index.md').replace(/^([\w-]+)\.md(#.*)?$/, '$1.html$2')
            return `<a href="${escapeHtml(target)}">${inline(link[1]!)}</a>`
        }
        return part.split(/(`[^`]+`)/g).map((piece) => {
            if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 1) return `<code>${escapeHtml(piece.slice(1, -1))}</code>`
            return escapeHtml(piece)
                .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
        }).join('')
    }).join('')
}

function parseInfo(info: string): { lang: string; options: Record<string, string | true> } {
    const tokens = info.match(/(?:[^\s"]+="[^"]*"|[^\s]+)/g) ?? []
    const lang = tokens.shift() ?? ''
    const options: Record<string, string | true> = {}
    for (const token of tokens) {
        const at = token.indexOf('=')
        if (at < 0) options[token] = true
        else options[token.slice(0, at)] = token.slice(at + 1).replace(/^"|"$/g, '')
    }
    return { lang, options }
}

export function renderMarkdown(source: string, options: MarkdownOptions): MarkdownResult {
    const lines = source.replace(/\r\n/g, '\n').split('\n')
    const out: string[] = []
    const headings: Heading[] = []
    const used = new Set<string>()
    let i = 0
    let paragraph: string[] = []
    const flush = () => {
        if (paragraph.length === 0) return
        out.push(`<p>${inline(paragraph.join(' '))}</p>`)
        paragraph = []
    }
    while (i < lines.length) {
        const line = lines[i]!
        if (line.startsWith('```')) {
            flush()
            const { lang, options: info } = parseInfo(line.slice(3).trim())
            const code: string[] = []
            i++
            while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!)
            i++
            out.push(options.fence({ lang, info, code: code.join('\n') }))
            continue
        }
        const heading = /^(#{2,4})\s+(.*)$/.exec(line)
        if (heading) {
            flush()
            const level = heading[1]!.length
            const text = heading[2]!
            let id = slugify(text)
            let suffix = 2
            while (used.has(id)) id = `${slugify(text)}-${suffix++}`
            used.add(id)
            headings.push({ level, text: text.replace(/`/g, ''), id })
            out.push(`<h${level} id="${id}">${inline(text)}<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`)
            i++
            continue
        }
        if (/^\s*$/.test(line)) {
            flush()
            i++
            continue
        }
        if (/^</.test(line)) {
            flush()
            const block: string[] = []
            while (i < lines.length && !/^\s*$/.test(lines[i]!)) block.push(lines[i++]!)
            out.push(block.join('\n'))
            continue
        }
        if (/^>\s?/.test(line)) {
            flush()
            const quote: string[] = []
            while (i < lines.length && /^>\s?/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^>\s?/, ''))
            out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`)
            continue
        }
        const ordered = /^\d+\.\s+/.test(line)
        if (ordered || /^[-*]\s+/.test(line)) {
            flush()
            const items: string[] = []
            const pattern = ordered ? /^\d+\.\s+/ : /^[-*]\s+/
            while (i < lines.length && (pattern.test(lines[i]!) || /^\s{2,}\S/.test(lines[i]!))) {
                if (pattern.test(lines[i]!)) items.push(lines[i]!.replace(pattern, ''))
                else items[items.length - 1] += ` ${lines[i]!.trim()}`
                i++
            }
            const tag = ordered ? 'ol' : 'ul'
            out.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`)
            continue
        }
        if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
            flush()
            const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
            const head = cells(line)
            i += 2
            const rows: string[][] = []
            while (i < lines.length && /^\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!))
            out.push(`<table><thead><tr>${head.map((cell) => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
            continue
        }
        paragraph.push(line.trim())
        i++
    }
    flush()
    return { html: out.join('\n'), headings }
}

/** Split YAML-like front matter from a guide. Values are plain strings. */
export function splitFrontMatter(source: string): { data: Record<string, string>; body: string } {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
    if (!match) return { data: {}, body: source }
    const data: Record<string, string> = {}
    for (const line of match[1]!.split('\n')) {
        const at = line.indexOf(':')
        if (at > 0) data[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^"|"$/g, '')
    }
    return { data, body: source.slice(match[0].length) }
}
