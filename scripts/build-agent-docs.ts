import { copyFile, mkdir, readFile, writeFile } from 'fs/promises'
import { catalogComponentCount, componentCatalog } from './component-catalog'
import { buildComponentPropMetadata, type ComponentPropMetadata, type ComponentPropMetadataBundle } from './build-component-props'

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

function buildComponentsMarkdown(
    packageMetadata: PackageMetadata,
    propMetadata: ComponentPropMetadataBundle,
): string {
    const sections = componentCatalog.map((category) => {
        const entries = category.components.map((component) => {
            const fence = markdownCodeFence(component.example)
            const props = propMetadata.propsByComponent[component.name]
            const propLines = props.map((prop: ComponentPropMetadata) => {
                const requirement = prop.required ? 'required' : 'optional'
                const allowedValues = prop.allowedValuesRef
                    ? `; allowed values: \`propEnums.${prop.allowedValuesRef}\``
                    : ''
                const description = prop.description ? `: ${prop.description}` : ''
                return `- \`${prop.name}\`: \`${prop.type}\` (${requirement}${allowedValues})${description}`
            })
            return [
                `### ${component.name}`,
                '',
                component.description,
                '',
                'Props:',
                ...(propLines.length > 0 ? propLines : ['- None.']),
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
        'Each example is a focused, runnable starting point. The generated Props lists mirror exported TypeScript signatures; `type` is TypeScript text, not a JSON schema, and props may accept values that JSON cannot represent. `required` records signature requiredness. Finite literal options are shared in the `propEnums` object in `components.json`. Default values are not inferred.',
        '',
        ...sections,
        '## Shared prop value sets',
        '',
        'Finite allowed values referenced by component props:',
        '',
        ...Object.entries(propMetadata.enums).map(([name, values]) => `- \`propEnums.${name}\`: ${JSON.stringify(values)}`),
        '',
    ].join('\n')
}

function buildComponentsJson(
    packageMetadata: PackageMetadata,
    baseUrl: URL,
    propMetadata: ComponentPropMetadataBundle,
): string {
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
            props: propMetadata.propsByComponent[component.name],
            playgroundUrl: playgroundUrl(baseUrl, component.example),
        })),
    }))

    return JSON.stringify({
        name: packageMetadata.name,
        version: packageMetadata.version,
        count: catalogComponentCount,
        playgroundUrl: absoluteUrl(baseUrl, 'playground.html'),
        propEnums: propMetadata.enums,
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
        ['Component catalog JSON', 'components.json', 'Structured component metadata with compiler-derived prop types, requiredness, finite value sets, runnable examples, and playground links.'],
        ['Component catalog Markdown', 'components.md', 'Category descriptions, typed prop summaries, shared finite value sets, and full runnable TSX examples.'],
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
    const propMetadata = buildComponentPropMetadata(componentCatalog.flatMap((category) =>
        category.components.map((component) => component.name)))
    const componentsMarkdown = buildComponentsMarkdown(packageMetadata, propMetadata)
    const componentsJson = buildComponentsJson(packageMetadata, baseUrl, propMetadata)
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
