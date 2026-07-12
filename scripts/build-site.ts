import { readFile, writeFile } from 'fs/promises'
import { codeToHtml } from 'shiki'

const templatePath = 'docs/index.template.html'
const outPath = 'docs/index.html'
const promptPath = 'PROMPT.md'
const docsPromptPath = 'docs/PROMPT.md'
const generatedNotice = '<!-- Generated from docs/index.template.html by pnpm site:build. Edit template. -->'

function encodeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function decodeHtml(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
}

function getAttribute(attrs: string, name: string): string | undefined {
    return attrs.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

function removeAttribute(attrs: string, name: string): string {
    return attrs.replace(new RegExp(`\\s${name}="[^"]*"`, 'g'), '')
}

function formatAttributes(attrs: string): string {
    const trimmed = attrs.trim()
    return trimmed ? ` ${trimmed}` : ''
}

async function highlightCodeBlock(_match: string, beforeDataAttr: string, lang: string, afterDataAttr: string, codeAttrs: string, encodedCode: string): Promise<string> {
    const rawPreAttrs = `${beforeDataAttr}${afterDataAttr}`
    const originalClass = getAttribute(rawPreAttrs, 'class')
    const preAttrs = removeAttribute(removeAttribute(rawPreAttrs, 'class'), 'tabindex')
    const classes = ['shiki', 'github-dark', originalClass].filter(Boolean).join(' ')
    const code = decodeHtml(encodedCode)
    const highlighted = await codeToHtml(code, {
        lang,
        theme: 'github-dark',
    })

    return highlighted
        .replace(/^<pre[^>]*>/, `<pre${formatAttributes(preAttrs)} data-shiki="${lang}" class="${classes}" tabindex="0">`)
        .replace('<code>', `<code${codeAttrs}>`)
}

async function replaceAsync(input: string, pattern: RegExp): Promise<string> {
    const replacements = await Promise.all(
        Array.from(input.matchAll(pattern), ([match, beforeDataAttr, lang, afterDataAttr, codeAttrs, encodedCode]) =>
            highlightCodeBlock(match, beforeDataAttr, lang, afterDataAttr, codeAttrs, encodedCode),
        ),
    )
    let index = 0
    return input.replace(pattern, () => replacements[index++] ?? '')
}

const prompt = await readFile(promptPath, 'utf8')
const template = (await readFile(templatePath, 'utf8'))
    .replace('{{PROMPT_MD}}', () => encodeHtml(prompt))
const highlighted = await replaceAsync(template, /<pre([^>]*)\sdata-shiki="([^"]+)"([^>]*)><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g)
const output = highlighted.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${generatedNotice}\n`)

await Promise.all([
    writeFile(outPath, output),
    writeFile(docsPromptPath, prompt),
])
console.log(`built ${outPath} and ${docsPromptPath} from ${templatePath} and ${promptPath}`)
