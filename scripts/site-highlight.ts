import { createHighlighter, type BundledLanguage, type Highlighter, type ThemeRegistration } from 'shiki'

function theme(name: string, type: 'dark' | 'light', colors: { text: string; comment: string; keyword: string; string: string; constant: string; func: string; type: string; punct: string }): ThemeRegistration {
    return {
        name, type,
        colors: { 'editor.foreground': colors.text, 'editor.background': '#00000000' },
        settings: [
            { settings: { foreground: colors.text } },
            { scope: ['comment', 'punctuation.definition.comment', 'string.comment'], settings: { foreground: colors.comment, fontStyle: 'italic' } },
            { scope: ['keyword', 'storage', 'storage.type', 'keyword.control', 'keyword.operator.new', 'keyword.operator.expression'], settings: { foreground: colors.keyword } },
            { scope: ['string', 'string.quoted', 'string.template', 'punctuation.definition.string'], settings: { foreground: colors.string } },
            { scope: ['constant', 'constant.numeric', 'constant.language', 'variable.language'], settings: { foreground: colors.constant } },
            { scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'], settings: { foreground: colors.func } },
            { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class', 'entity.name.tag'], settings: { foreground: colors.type } },
            { scope: ['keyword.operator', 'punctuation', 'meta.brace'], settings: { foreground: colors.punct } },
        ],
    }
}

const ink = theme('vizmatic-ink', 'dark', { text: '#e9e5da', comment: '#8f8a7d', keyword: '#ffd75e', string: '#8fdccb', constant: '#ff9d57', func: '#9fd3ea', type: '#c7b8ff', punct: '#a5a091' })
const paper = theme('vizmatic-paper', 'light', { text: '#23211b', comment: '#6c685c', keyword: '#815700', string: '#0a6a60', constant: '#a8430a', func: '#1f5f8f', type: '#5a3eb0', punct: '#55514a' })

const PRELOADED_LANGS: BundledLanguage[] = ['ts', 'tsx', 'bash', 'json', 'html', 'css', 'js', 'jsx']
let highlighterPromise: Promise<Highlighter> | undefined
const loadedLangs = new Set<string>(['text', 'plaintext', 'txt', ...PRELOADED_LANGS])
const loadingLangs = new Map<string, Promise<void>>()

async function getHighlighter(lang: string): Promise<Highlighter> {
    highlighterPromise ??= createHighlighter({
        themes: [ink, paper, 'github-dark-high-contrast', 'github-light-high-contrast'],
        langs: PRELOADED_LANGS,
    })
    const highlighter = await highlighterPromise
    if (!loadedLangs.has(lang)) {
        let pending = loadingLangs.get(lang)
        if (!pending) {
            pending = highlighter.loadLanguage(lang as BundledLanguage).then(() => {
                loadedLangs.add(lang)
                loadingLangs.delete(lang)
            }, (error) => {
                loadingLangs.delete(lang)
                throw error
            })
            loadingLangs.set(lang, pending)
        }
        await pending
    }
    return highlighter
}

/** Highlight code for the site in both themes. The result carries a `--shiki-*` color per token. */
export async function highlight(code: string, lang: string, preAttributes = ''): Promise<string> {
    const highlighter = await getHighlighter(lang)
    // No time limit for a line: with the default limit, a busy machine gives up on a long line and colors the
    // rest of the block in another way, so two builds of one source differ.
    const html = highlighter.codeToHtml(code, { lang, themes: { light: 'vizmatic-paper', dark: 'vizmatic-ink' }, defaultColor: false, tokenizeTimeLimit: 0 })
    return html.replace(/^<pre[^>]*>/, `<pre class="shiki" data-shiki="${lang}" tabindex="0"${preAttributes ? ` ${preAttributes}` : ''}>`)
}

/** Highlight a gallery TSX example using the shared high-contrast GitHub themes. */
export async function highlightGalleryExample(code: string, mode: 'dark' | 'light'): Promise<string> {
    const highlighter = await getHighlighter('tsx')
    return highlighter.codeToHtml(code, {
        lang: 'tsx',
        theme: `github-${mode}-high-contrast`,
        // Embedded image strings must retain the same grammar state on slower CI runners.
        tokenizeTimeLimit: 0,
    })
}

export function decodeHtml(value: string): string {
    return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

/** Highlight every `<pre data-shiki="lang"><code>` block in a page. */
export async function highlightPage(page: string): Promise<string> {
    const pattern = /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g
    const matches = Array.from(page.matchAll(pattern))
    const replacements = await Promise.all(matches.map(async ([, before = '', lang = 'text', after = '', , encoded = '']) => {
        const attributes = `${before}${after}`.replace(/\sclass="[^"]*"/, '').replace(/\stabindex="[^"]*"/, '').trim()
        return highlight(decodeHtml(encoded), lang, attributes)
    }))
    let index = 0
    return page.replace(pattern, () => replacements[index++] ?? '')
}
