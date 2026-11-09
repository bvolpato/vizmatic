import { codeToHtml, type ThemeRegistration } from 'shiki'

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

/** Highlight code for the site in both themes. The result carries a `--shiki-*` color per token. */
export async function highlight(code: string, lang: string, preAttributes = ''): Promise<string> {
    // No time limit for a line: with the default limit, a busy machine gives up on a long line and colors the
    // rest of the block in another way, so two builds of one source differ.
    const html = await codeToHtml(code, { lang, themes: { light: paper, dark: ink }, defaultColor: false, tokenizeTimeLimit: 0 })
    return html.replace(/^<pre[^>]*>/, `<pre class="shiki" data-shiki="${lang}" tabindex="0"${preAttributes ? ` ${preAttributes}` : ''}>`)
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
