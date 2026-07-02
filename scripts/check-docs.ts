import { access, readFile } from 'fs/promises'
import { dirname, join } from 'path'
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
