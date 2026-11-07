import { copyFile, mkdir, readFile, readdir, writeFile } from 'fs/promises'
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
                const literalValues = prop.literalValuesRef
                    ? `; literal presets: \`propEnums.${prop.literalValuesRef}\` (other non-literal variants remain TSX-only)`
                    : ''
                const description = prop.description ? `: ${prop.description}` : ''
                return `- \`${prop.name}\`: \`${prop.type}\` (${requirement}${allowedValues}${literalValues})${description}`
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
        'Each example is a focused, runnable starting point. The generated Props lists mirror exported TypeScript signatures; `type` is TypeScript text, not a JSON schema, and props may accept values that JSON cannot represent. `required` records signature requiredness. Exhaustive finite choices use `allowedValuesRef`; mixed unions may use `literalValuesRef` for available JSON literal presets while callback or other non-literal variants remain source-only. Shared values are stored in the `propEnums` object in `components.json`. Default values are not inferred.',
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
            ...(component.searchTerms ? { searchTerms: component.searchTerms } : {}),
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
        ['Website', '', 'Product overview, films, and quick start.'],
        ['Documentation', 'docs/', 'Guides for films, objects, the CLI, exporting, embedding, and figures.'],
        ['Getting started', 'docs/index.html', 'Write, preview, and export a film in about two minutes.'],
        ['Guide for agents', 'docs/agents.html', 'A check, stills, and export loop for films that an agent can run.'],
        ['API reference', 'docs/api.html', 'Every public export of the stage engine, generated from its TypeScript source.'],
        ['Films', 'films.html', 'Finished films with their full source.'],
        ['Agent guide', 'agents.html', 'Installation choices and a verified agent workflow.'],
        ['Task prompt', 'PROMPT.md', 'A short prompt with the film and figure workflows, and links for depth.'],
        ['Portable skill', 'skill.md', 'Installable agent workflow instructions.'],
        ['Film reference', 'references/films.md', 'Engine rules, patterns, and check codes for films.'],
        ['Starter film', 'assets/starter-film.ts', 'A complete film to copy and change.'],
        ['Patterns', 'patterns.md', 'Guidance for choosing figure components and structuring visuals.'],
        ['Component catalog JSON', 'components.json', 'Structured component metadata with compiler-derived prop types, requiredness, finite value sets, runnable examples, and playground links.'],
        ['Component catalog Markdown', 'components.md', 'Category descriptions, typed prop summaries, shared finite value sets, and full runnable TSX examples.'],
        ['Full context bundle', 'llms-full.txt', 'PROMPT.md, every guide, and the complete component catalog.'],
        ['Studio', 'studio.html', 'Build and export a film in the browser.'],
        ['Playground', 'playground.html', 'Edit source and preview a figure in the browser.'],
    ]

    return [
        `# ${packageMetadata.name.replace(/^./, (first) => first.toUpperCase())}`,
        '',
        `> ${packageMetadata.description}`,
        '',
        'Vizmatic makes two kinds of output from code. Films are vector animations written in TypeScript with `vizmatic/stage`. They play live in a browser and export to MP4. Figures are dense technical diagrams and charts written in TSX. The Node.js CLI renders both locally or in CI, and `vizmatic check --json` reports layout defects with locations.',
        '',
        'The CLI requires Node.js 20 or newer. The portable agent skill is separate from the renderer installation.',
        '',
        '## Resources',
        '',
        ...resources.map(([label, path, description]) => `- [${label}](${absoluteUrl(baseUrl, path)}): ${description}`),
        '',
    ].join('\n')
}

/** All guides as one document, with front matter reduced to a heading. The API reference is generated separately. */
async function readGuides(): Promise<string> {
    const names = (await readdir('docs/guides').catch(() => [] as string[])).filter((name) => name.endsWith('.md')).sort()
    const parts: string[] = []
    for (const name of names) {
        const source = await readFile(`docs/guides/${name}`, 'utf8')
        const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
        const title = match ? /^title:\s*(.+)$/m.exec(match[1]!)?.[1] : undefined
        const body = match ? source.slice(match[0].length) : source
        parts.push(`# Guide: ${title ?? name}\n\n${body.trim()}\n`)
    }
    return parts.length > 0 ? `${parts.join('\n')}\n` : ''
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
    const guides = await readGuides()
    const llmsFull = `# Prompt\n\n${prompt}\n${guides}# Component catalog\n\n${componentsMarkdown}`

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
        copyFile('plugins/vizmatic/skills/vizmatic/references/films.md', 'docs/references/films.md'),
        copyFile('plugins/vizmatic/skills/vizmatic/assets/starter-film.ts', 'docs/assets/starter-film.ts'),
        copyFile('plugins/vizmatic/skills/vizmatic/assets/starter-frame.tsx', 'docs/assets/starter-frame.tsx'),
        copyFile('plugins/vizmatic/skills/vizmatic/assets/animated-frame.tsx', 'docs/assets/animated-frame.tsx'),
    ])
}
