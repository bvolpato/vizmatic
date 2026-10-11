import type { PlaygroundTheme } from './playground-source'

export interface PlaygroundProject {
    format: 'vizmatic'
    version: 1
    name: string
    source: string
    theme: PlaygroundTheme
    background: 'transparent' | 'theme'
}

export function readPlaygroundProject(text: string): PlaygroundProject {
    if (text.length > 600_000 || new TextEncoder().encode(text).byteLength > 600_000) throw new Error('Project files must be smaller than 600 KB.')
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new Error('The project file is not valid JSON.') }
    if (!value || typeof value !== 'object') throw new Error('Choose a Vizmatic project file.')
    const project = value as Partial<PlaygroundProject>
    if (project.format !== 'vizmatic' || project.version !== 1) throw new Error('This Vizmatic project format is not supported.')
    if (typeof project.name !== 'string' || project.name.length > 120
        || typeof project.source !== 'string' || !project.source.trim() || project.source.length > 500_000
        || !['dark', 'light'].includes(project.theme ?? '') || !['transparent', 'theme'].includes(project.background ?? '')) {
        throw new Error('The project must include a name, source, theme, and canvas background.')
    }
    return { format: 'vizmatic', version: 1, name: project.name, source: project.source, theme: project.theme!, background: project.background! }
}

export function writePlaygroundProject(project: PlaygroundProject): string {
    const text = JSON.stringify(project, null, 2) + '\n'
    readPlaygroundProject(text)
    return text
}

export function projectFilename(name: string): string {
    return (name.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vizmatic-project') + '.vizmatic.json'
}
