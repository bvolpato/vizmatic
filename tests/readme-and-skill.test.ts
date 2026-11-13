import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import React from 'react'
import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import { checkFrame } from '../src/check'
import { createPlaygroundApi } from '../src/playground-api'
import { preparePlaygroundSource } from '../src/playground-source'
import * as stage from '../src/stage'
import { getThemeColors } from '../src/theme'

const root = resolve(import.meta.dirname, '..')

async function listFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(entries.map(async (entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return listFiles(path)
        if (entry.isFile()) return [path]
        return []
    }))
    return nested.flat()
}

describe('README and bundled skill', () => {
    it('keeps plugin and portable skill copies synced, portable, and free of em dashes', async () => {
        const pluginDir = join(root, 'plugins', 'vizmatic', 'skills', 'vizmatic')
        const portableDir = join(root, '.agents', 'skills', 'vizmatic')
        const pluginFiles = (await listFiles(pluginDir)).map((path) => relative(pluginDir, path)).sort()
        const portableFiles = (await listFiles(portableDir)).map((path) => relative(portableDir, path)).sort()
        expect(portableFiles).toEqual(pluginFiles)

        for (const rel of pluginFiles) {
            const pluginContent = await readFile(join(pluginDir, rel), 'utf8')
            const portableContent = await readFile(join(portableDir, rel), 'utf8')
            expect(portableContent).toBe(pluginContent)
            if (rel.endsWith('.md')) {
                expect(pluginContent).not.toContain('\u2014')
            }
        }

        const skillMd = await readFile(join(pluginDir, 'SKILL.md'), 'utf8')
        const frontmatterMatch = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)
        expect(frontmatterMatch).not.toBeNull()
        const frontmatter = frontmatterMatch![1]!
        expect(frontmatter).toContain('name: vizmatic')
        const descMatch = /^description:\s*(.+)$/m.exec(frontmatter)
        expect(descMatch).not.toBeNull()
        expect(descMatch![1]!.trim()).toContain('Create and render theme-aware diagrams')
        expect(descMatch![1]!.trim().length).toBeLessThanOrEqual(240)
        expect(skillMd).not.toContain('TODO')

        const openaiYaml = await readFile(join(pluginDir, 'agents', 'openai.yaml'), 'utf8')
        expect(openaiYaml).toContain('display_name:')
        expect(openaiYaml).toContain('short_description:')
        expect(openaiYaml).toContain('default_prompt:')
    })

    it('keeps README links valid and compiles and checks its quick-start film and TSX figure', async () => {
        const readme = await readFile(join(root, 'README.md'), 'utf8')
        expect(readme).not.toContain('\u2014')

        for (const match of readme.matchAll(/\]\((?!https?:\/\/|#)([^)]+)\)/g)) {
            const relPath = match[1]!.split('#')[0]!
            expect(existsSync(join(root, relPath)), `missing README path: ${relPath}`).toBe(true)
        }

        const tsBlocks = Array.from(readme.matchAll(/```ts\n([\s\S]*?)```/g), (match) => match[1]!)
        expect(tsBlocks.length).toBeGreaterThanOrEqual(1)
        const introSource = tsBlocks[0]!
        const body = introSource
            .replace(/^import\s+\{[^}]+\}\s+from\s+'vizmatic\/stage'\s*$/m, '')
            .replace(/export\s+default\s+/, 'return ')
        const compiledFilm = transform(body, { transforms: ['typescript'] }).code
        const buildFilm = Function(...Object.keys(stage), compiledFilm) as (...args: unknown[]) => stage.FilmDefinition
        const introFilm = buildFilm(...Object.values(stage))
        const filmReport = await stage.checkFilm(introFilm, {
            motion: true,
            textGap: 0.3,
            textSize: 26,
            emptySpace: 0.5,
        })
        expect(filmReport.diagnostics).toEqual([])
        expect(filmReport.ok).toBe(true)

        const tsxBlocks = Array.from(readme.matchAll(/```tsx\n([\s\S]*?)```/g), (match) => match[1]!)
        expect(tsxBlocks.length).toBeGreaterThanOrEqual(1)
        const prepared = preparePlaygroundSource(tsxBlocks[0]!)
        const compiledFrame = transform(`${prepared.setup}\nreturn (${prepared.jsx});`, {
            transforms: ['typescript', 'jsx'],
            jsxPragma: 'React.createElement',
            production: true,
        }).code
        const frameReport = await checkFrame({
            autoSize: { width: true, height: true },
            create(theme) {
                const c = getThemeColors(theme)
                const api = createPlaygroundApi(c)
                const render = Function('React', 'c', ...Object.keys(api), compiledFrame) as (...args: unknown[]) => React.ReactNode
                return render(React, c, ...Object.values(api))
            },
        }, { themes: ['dark', 'light'], failOn: 'warning' })
        expect(frameReport.ok).toBe(true)
    })
})
