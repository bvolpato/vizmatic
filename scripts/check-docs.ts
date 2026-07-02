import { access, readFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const htmlPath = join(root, 'docs', 'index.html')
const html = await readFile(htmlPath, 'utf8')

function fail(message: string): never {
    throw new Error(message)
}

const refs = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
    .map((match) => match[1])
    .filter((ref): ref is string => Boolean(ref))
    .filter((ref) => !ref.startsWith('http') && !ref.startsWith('#') && !ref.startsWith('mailto:'))

const missing: string[] = []
for (const ref of refs) {
    const cleanRef = ref.split('#')[0]?.split('?')[0]
    if (!cleanRef || cleanRef === 'style.css') continue
    const target = join(root, 'docs', cleanRef)
    await access(target).catch(() => missing.push(ref))
}

if (missing.length > 0) {
    fail(`missing docs assets:\n${missing.map((ref) => `- ${ref}`).join('\n')}`)
}

const rootPrompt = await readFile(join(root, 'PROMPT.md'), 'utf8')
const docsPrompt = await readFile(join(root, 'docs', 'PROMPT.md'), 'utf8')
if (rootPrompt !== docsPrompt) {
    fail('docs/PROMPT.md must match root PROMPT.md')
}

if (!html.includes('code-copy-button')) {
    fail('homepage code blocks must install copy buttons')
}

if (!html.includes('id="imageDialog"')) {
    fail('homepage gallery must include image preview dialog')
}

if (html.includes('Fallback before npm publish')) {
    fail('homepage prompt preview should not mention pre-publish fallback')
}

const titleWords: Record<string, string> = {
    gif: 'GIF',
    rag: 'RAG',
}

function titleFor(name: string): string {
    return name
        .split('-')
        .map((part) => titleWords[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

function previewFor(outputs: string[], theme: 'dark' | 'light'): string {
    return outputs.find((output) => output.endsWith(`_${theme}.gif`))
        ?? outputs.find((output) => output.endsWith(`_${theme}.png`))
        ?? outputs[0]
        ?? ''
}

const manifestRaw = await readFile(join(root, 'docs', 'assets', 'examples', 'manifest.json'), 'utf8')
const manifest = JSON.parse(manifestRaw) as Array<{ name?: string; source?: string; outputs?: string[] }>
if (manifest.length === 0) {
    fail('manifest.json must include example outputs')
}

const examplesReadme = await readFile(join(root, 'examples', 'README.md'), 'utf8')
for (const entry of manifest) {
    if (!entry.name) fail('every manifest entry must have a name')
    if (!entry.source) fail(`${entry.name} manifest entry missing source`)
    if (!entry.outputs?.length) fail(`${entry.name} manifest entry missing outputs`)

    const title = titleFor(entry.name)
    if (!examplesReadme.includes(`[${title}](${basename(entry.source)})`)) {
        fail(`examples README missing ${entry.name} source link`)
    }

    for (const theme of ['dark', 'light'] as const) {
        const preview = previewFor(entry.outputs, theme)
        if (!preview) fail(`${entry.name} missing ${theme} preview`)
        if (!examplesReadme.includes(`../docs/assets/examples/${preview}`)) {
            fail(`examples README missing ${entry.name} ${theme} preview`)
        }
    }

    for (const output of entry.outputs) {
        await access(join(root, 'docs', 'assets', 'examples', output)).catch(() => fail(`${entry.name} output missing: ${output}`))
    }
}

const sourcesRaw = await readFile(join(root, 'docs', 'assets', 'examples', 'sources.json'), 'utf8')
const sources = JSON.parse(sourcesRaw) as Array<{ name?: string; html?: { dark?: string; light?: string } | string }>
if (sources.length === 0) {
    fail('sources.json must include example sources')
}

for (const source of sources) {
    if (!source.name) fail('every source entry must have a name')
    if (typeof source.html === 'string') {
        fail(`${source.name} source html must include dark and light variants`)
    }
    if (!source.html?.dark?.includes('github-dark')) {
        fail(`${source.name} source html missing github-dark`)
    }
    if (!source.html.light?.includes('github-light')) {
        fail(`${source.name} source html missing github-light`)
    }
}

console.log(`docs ok: ${refs.length} local references checked`)
