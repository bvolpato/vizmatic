import ts from 'typescript'
import { escapeHtml, slugify, type Heading } from './site-markdown'

/**
 * The API reference comes from the TypeScript program, so it cannot drift from
 * the code. It walks the exports of the public entry points and prints each
 * signature and doc comment.
 */
const ENTRIES = [
    { file: 'src/stage/index.ts', module: 'vizmatic/stage' },
    { file: 'src/stage-export.ts', module: 'vizmatic/stage/export' },
    { file: 'src/stage/player.ts', module: 'browser player' },
]

const GROUPS: [RegExp, string][] = [
    [/\/stage\/stage\.ts$/, 'Film and stage'],
    [/\/stage\/anim\.ts$/, 'Animations'],
    [/\/stage\/node\.ts$/, 'Nodes'],
    [/\/stage\/shapes\.ts$/, 'Shapes'],
    [/\/stage\/image\.ts$/, 'Images'],
    [/\/stage\/objects/, 'Objects'],
    [/\/stage\/(three|scene3d|camera3d|view3d)/, '3D'],
    [/\/stage\/(text|tex|font)\.ts$/, 'Text and math'],
    [/\/stage\/ease\.ts$/, 'Easing'],
    [/\/stage\/(color|look)\.ts$/, 'Color and looks'],
    [/\/stage\/geometry\.ts$/, 'Geometry'],
    [/\/stage\/(display)\.ts$/, 'Drawing'],
    [/\/(?:stage\/(?:export|raster)|narration-hold)\.ts$/, 'Export (Node.js)'],
    [/\/stage\/player\.ts$/, 'Browser player'],
]

const FORMAT = ts.TypeFormatFlags.NoTruncation

function docOf(symbol: ts.Symbol, checker: ts.TypeChecker): string {
    return ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().replace(/\s*\n\s*/g, ' ')
}

/** Doc comments use backticks for code. */
function docHtml(doc: string): string {
    return escapeHtml(doc).replace(/`([^`]+)`/g, '<code>$1</code>')
}

function cleanType(text: string): string {
    return text.replace(/import\("[^"]+"\)\./g, '')
}

interface Entry {
    name: string
    kind: string
    signature: string
    doc: string
    group: string
    members: { text: string; doc: string }[]
}

function memberEntries(type: ts.Type, checker: ts.TypeChecker, at: ts.Node): { text: string; doc: string }[] {
    const out: { text: string; doc: string }[] = []
    for (const prop of checker.getPropertiesOfType(type)) {
        const name = prop.getName()
        if (name.startsWith('_')) continue
        const declaration = prop.valueDeclaration ?? prop.declarations?.[0]
        if (!declaration) continue
        const flags = ts.getCombinedModifierFlags(declaration)
        if (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue
        const fromLib = declaration.getSourceFile().isDeclarationFile
        if (fromLib) continue
        const memberType = checker.getTypeOfSymbolAtLocation(prop, at)
        const signatures = memberType.getCallSignatures()
        const text = signatures.length && (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration))
            ? signatures.map((signature) => `${name}${cleanType(checker.signatureToString(signature, undefined, FORMAT))}`).join('\n')
            : `${name}${prop.flags & ts.SymbolFlags.Optional ? '?' : ''}: ${cleanType(checker.typeToString(memberType, undefined, FORMAT))}`
        out.push({ text, doc: docOf(prop, checker) })
    }
    return out
}

function describe(symbol: ts.Symbol, checker: ts.TypeChecker): Entry | null {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    const declaration = target.valueDeclaration ?? target.declarations?.[0]
    if (!declaration) return null
    const path = declaration.getSourceFile().fileName
    if (!path.includes('/src/')) return null
    const group = GROUPS.find(([pattern]) => pattern.test(path))?.[1] ?? 'Objects'
    const name = symbol.getName()
    const doc = docOf(target, checker)
    if (target.flags & ts.SymbolFlags.Function) {
        const type = checker.getTypeOfSymbolAtLocation(target, declaration)
        const signature = type.getCallSignatures().map((item) => `function ${name}${cleanType(checker.signatureToString(item, undefined, FORMAT))}`).join('\n')
        return { name, kind: 'function', signature, doc, group, members: [] }
    }
    if (target.flags & ts.SymbolFlags.Class) {
        const instance = checker.getDeclaredTypeOfSymbol(target)
        const constructors = checker.getTypeOfSymbolAtLocation(target, declaration).getConstructSignatures()
        const signature = constructors.map((item) => `new ${name}${cleanType(checker.signatureToString(item, undefined, FORMAT)).replace(/: \w+.*$/s, '')}`).join('\n')
        return { name, kind: 'class', signature, doc, group, members: memberEntries(instance, checker, declaration) }
    }
    if (target.flags & ts.SymbolFlags.Interface) {
        return { name, kind: 'interface', signature: '', doc, group, members: memberEntries(checker.getDeclaredTypeOfSymbol(target), checker, declaration) }
    }
    if (target.flags & ts.SymbolFlags.TypeAlias) {
        const type = checker.getDeclaredTypeOfSymbol(target)
        const shown = cleanType(checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias))
        return { name, kind: 'type', signature: `type ${name} = ${shown}`, doc, group, members: [] }
    }
    if (target.flags & ts.SymbolFlags.Variable) {
        const type = checker.getTypeOfSymbolAtLocation(target, declaration)
        const shown = cleanType(checker.typeToString(type, undefined, FORMAT))
        return { name, kind: 'const', signature: `const ${name}: ${shown}`, doc, group, members: [] }
    }
    return null
}

export interface ApiReference {
    html: string
    headings: Heading[]
    search: { title: string; description: string; category: string; anchor: string }[]
    names: string[]
}

export async function buildApiReference(): Promise<ApiReference> {
    const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json')
    if (!configPath) throw new Error('tsconfig.json not found.')
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, '.')
    const program = ts.createProgram(ENTRIES.map((entry) => entry.file), { ...parsed.options, noEmit: true })
    const checker = program.getTypeChecker()
    const seen = new Map<string, Entry>()
    for (const entry of ENTRIES) {
        const source = program.getSourceFile(entry.file)
        if (!source) continue
        const moduleSymbol = checker.getSymbolAtLocation(source)
        if (!moduleSymbol) continue
        for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
            if (seen.has(symbol.getName())) continue
            const described = describe(symbol, checker)
            if (described) seen.set(symbol.getName(), described)
        }
    }
    const order = [...new Set(GROUPS.map(([, label]) => label))]
    const entries = [...seen.values()]
    const headings: Heading[] = []
    const search: ApiReference['search'] = []
    const sections = order.filter((group) => entries.some((entry) => entry.group === group)).map((group) => {
        const id = `api-${slugify(group)}`
        headings.push({ level: 2, text: group, id })
        const items = entries.filter((entry) => entry.group === group).sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
            const anchor = `api-entry-${slugify(entry.name)}-${entry.kind}`
            search.push({ title: entry.name, description: entry.doc.replace(/`/g, '') || `${entry.kind} in ${group}`, category: 'API', anchor })
            const members = entry.members.length
                ? `<ul class="api-members">${entry.members.map((member) => `<li><code>${escapeHtml(member.text)}</code>${member.doc ? `<span>${docHtml(member.doc)}</span>` : ''}</li>`).join('')}</ul>`
                : ''
            return `<section class="api-entry" id="${anchor}" data-api-entry="${escapeHtml(`${entry.name} ${entry.doc}`.toLowerCase())}"><h3>${escapeHtml(entry.name)}<small>${entry.kind}</small></h3>${entry.doc ? `<p>${docHtml(entry.doc)}</p>` : ''}${entry.signature ? `<pre class="api-signature">${escapeHtml(entry.signature)}</pre>` : ''}${members}</section>`
        }).join('')
        return `<section data-api-group><h2 id="${id}">${escapeHtml(group)}</h2>${items}</section>`
    }).join('')
    return {
        html: `<input class="api-filter" type="search" placeholder="Filter ${entries.length} exports" aria-label="Filter the API reference" data-api-filter>${sections}`,
        headings,
        search,
        names: entries.map((entry) => entry.name),
    }
}
