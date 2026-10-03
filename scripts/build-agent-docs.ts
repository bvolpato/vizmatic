import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { catalogComponentCount, componentCatalog } from './component-catalog'

interface PackageMetadata {
    name: string
    version: string
    description: string
    homepage: string
}

function absoluteUrl(baseUrl: URL, path: string): string {
    return new URL(path, baseUrl).toString()
}

function playgroundUrl(baseUrl: URL, example: string): string {
    return absoluteUrl(baseUrl, 'playground.html#vizmatic-playground=' + encodeURIComponent(example))
}

function markdownCodeFence(source: string): string {
    const longestRun = Math.max(0, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length))
    return '`'.repeat(Math.max(3, longestRun + 1))
}

function buildComponentsMarkdown(packageMetadata: PackageMetadata): string {
    const sections = componentCatalog.map((category) => {
        const entries = category.components.map((component) => {
            const fence = markdownCodeFence(component.example)
            return [
                `### ${component.name}`,
                '',
                component.description,
                '',
                `${fence}tsx`,
                component.example,
                fence,
            ].join('\n')
        })

        return [`## ${category.label}`, '', category.description, '', ...entries].join('\n\n')
    })

    return [
        '# Vizmatic components',
        '',
        `Package: ${packageMetadata.name}@${packageMetadata.version}. Catalog: ${catalogComponentCount} runnable examples across ${componentCatalog.length} categories.`,
        '',
        'Each example is a focused, runnable starting point. Examples show common usage and are not exhaustive typed prop documentation. Use the package TypeScript definitions and `PROMPT.md` for the complete API contract.',
        '',
        ...sections,
        '',
    ].join('\n')
}

function buildComponentsJson(packageMetadata: PackageMetadata, baseUrl: URL): string {
    const categories = componentCatalog.map((category) => ({
        id: category.id,
        label: category.label,
        description: category.description,
        source: category.source,
        count: category.components.length,
        components: category.components.map((component) => ({
            name: component.name,
            description: component.description,
            example: component.example,
            controls: component.controls,
            playgroundUrl: playgroundUrl(baseUrl, component.example),
        })),
    }))

    return JSON.stringify({
        name: packageMetadata.name,
        version: packageMetadata.version,
        count: catalogComponentCount,
        playgroundUrl: absoluteUrl(baseUrl, 'playground.html'),
        categories,
    }, null, 2) + '\n'
}

function buildLlmsIndex(packageMetadata: PackageMetadata, baseUrl: URL): string {
    const resources = [
        ['Website', '', 'Product overview, examples, and quick start.'],
        ['Agent guide', 'agents.html', 'Installation choices and a verified agent workflow.'],
        ['Full prompt and API guidance', 'PROMPT.md', 'Complete prompt, usage guidance, and API reference.'],
        ['Portable skill', 'skill.md', 'Installable agent workflow instructions.'],
        ['Patterns', 'patterns.md', 'Guidance for choosing components and structuring visuals.'],
        ['Component catalog JSON', 'components.json', 'Structured component metadata with runnable examples and playground links.'],
        ['Component catalog Markdown', 'components.md', 'Category descriptions and full runnable TSX examples.'],
        ['Full context bundle', 'llms-full.txt', 'PROMPT.md followed by the complete component catalog.'],
        ['Playground', 'playground.html', 'Edit source and preview a scene in the browser.'],
    ]

    return [
        `# ${packageMetadata.name.replace(/^./, (first) => first.toUpperCase())}`,
        '',
        `> ${packageMetadata.description}`,
        '',
        'Vizmatic turns editable TSX scenes into diagrams, charts, documentation figures, and animations. The Node.js CLI renders locally or in CI; the browser playground supports interactive editing and preview.',
        '',
        'The CLI requires Node.js 20 or newer. The portable agent skill is separate from the renderer installation.',
        '',
        '## Resources',
        '',
        ...resources.map(([label, path, description]) => `- [${label}](${absoluteUrl(baseUrl, path)}): ${description}`),
        '',
    ].join('\n')
}

export async function buildAgentDocs(): Promise<void> {
    const [packageText, prompt] = await Promise.all([
        readFile('package.json', 'utf8'),
        readFile('PROMPT.md', 'utf8'),
    ])
    const packageMetadata = JSON.parse(packageText) as PackageMetadata
    const baseUrl = new URL(packageMetadata.homepage.endsWith('/') ? packageMetadata.homepage : packageMetadata.homepage + '/')
    const componentsMarkdown = buildComponentsMarkdown(packageMetadata)
    const componentsJson = buildComponentsJson(packageMetadata, baseUrl)
    const llmsIndex = buildLlmsIndex(packageMetadata, baseUrl)
    const llmsFull = `# Prompt\n\n${prompt}\n# Component catalog\n\n${componentsMarkdown}`

    await Promise.all([
        mkdir('docs', { recursive: true }),
        mkdir('docs/references', { recursive: true }),
        mkdir('docs/assets', { recursive: true }),
    ])
    await Promise.all([
        writeFile('docs/llms.txt', llmsIndex),
        writeFile('docs/llms-full.txt', llmsFull),
        writeFile('docs/components.md', componentsMarkdown),
        writeFile('docs/components.json', componentsJson),
        copyFile('plugins/vizmatic/skills/vizmatic/SKILL.md', 'docs/skill.md'),
        copyFile('plugins/vizmatic/skills/vizmatic/references/patterns.md', 'docs/patterns.md'),
        copyFile('plugins/vizmatic/skills/vizmatic/references/patterns.md', 'docs/references/patterns.md'),
        copyFile('plugins/vizmatic/skills/vizmatic/assets/starter-frame.tsx', 'docs/assets/starter-frame.tsx'),
        copyFile('plugins/vizmatic/skills/vizmatic/assets/animated-frame.tsx', 'docs/assets/animated-frame.tsx'),
    ])
}
