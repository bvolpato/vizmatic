import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { cpus } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { transform } from 'sucrase'
import { componentCatalog, type ComponentCatalogItem } from './component-catalog'
import { createPlaygroundApi } from '../src/playground-api'
import { preparePlaygroundSource } from '../src/playground-source'
import { renderToPng } from '../src/render'
import { mergePlaygroundThemeColors } from '../src/frame-theme'
import { withDensity } from '../src/density'
import { withRenderContext } from '../src/renderContext'

const outputDirectory = 'docs/assets/components'
const themes = ['dark', 'light'] as const
const scriptPath = fileURLToPath(import.meta.url)
const rootDir = dirname(dirname(scriptPath))
const tsxLoader = pathToFileURL(join(rootDir, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href

async function renderComponentSlice(components: readonly ComponentCatalogItem[]): Promise<void> {
    for (const component of components) {
        try {
            const prepared = preparePlaygroundSource(component.example)
            if (prepared.metadata.warnings.length) throw new Error(prepared.metadata.warnings.join(' '))
            const compiled = transform(`${prepared.setup}\nreturn (${prepared.jsx});`, {
                transforms: ['typescript', 'jsx'], jsxPragma: 'React.createElement', production: true,
            }).code

            for (const theme of themes) {
                const palette = mergePlaygroundThemeColors(theme, prepared.metadata.preset, prepared.metadata.themeColors)
                const colors = prepared.metadata.density === undefined
                    ? palette : withDensity(palette, prepared.metadata.density)
                const api = createPlaygroundApi(colors)
                api.getThemeColors = (mode = theme, preset = prepared.metadata.preset) => {
                    const result = mergePlaygroundThemeColors(
                        mode as typeof theme,
                        preset as Parameters<typeof mergePlaygroundThemeColors>[1],
                        prepared.metadata.themeColors,
                    )
                    return prepared.metadata.density === undefined ? result : withDensity(result, prepared.metadata.density)
                }
                const create = Function('React', 'c', ...Object.keys(api), compiled) as (...args: unknown[]) => React.ReactNode
                const element = create(React, colors, ...Object.values(api))
                const background = prepared.metadata.background ?? 'transparent'
                await withRenderContext({ background }, () => renderToPng(element, {
                    width: prepared.metadata.width,
                    height: prepared.metadata.height,
                    outputPath: join(outputDirectory, `${component.name}_${theme}.png`),
                    scale: Math.min(0.5, 480 / prepared.metadata.width, 480 / prepared.metadata.height),
                    brand: false,
                    theme,
                    ...(prepared.metadata.density !== undefined ? { density: prepared.metadata.density } : {}),
                }))
            }
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            throw new Error(`Could not render ${component.name} catalog preview: ${detail}`, { cause: error })
        }
    }
}

function runPreviewWorker(workerIndex: number, workerCount: number): Promise<void> {
    return new Promise((done, reject) => {
        const child = spawn(process.execPath, [
            '--import', tsxLoader, scriptPath, '--worker', `${workerIndex}/${workerCount}`,
        ], { cwd: rootDir, stdio: 'inherit' })
        child.once('error', reject)
        child.once('exit', (code, signal) => {
            if (code === 0) done()
            else reject(new Error(`Component preview worker ${workerIndex}/${workerCount} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`))
        })
    })
}

/** Render the same copyable examples used by the component catalog into theme-aware chooser previews. */
export async function buildComponentPreviews(): Promise<void> {
    await mkdir(outputDirectory, { recursive: true })
    const allComponents = componentCatalog.flatMap((category) => category.components)
    const workerCount = Math.min(6, Math.max(1, cpus().length), allComponents.length)
    if (workerCount <= 1) {
        await renderComponentSlice(allComponents)
        return
    }
    await Promise.all(Array.from({ length: workerCount }, (_, index) => runPreviewWorker(index, workerCount)))
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
    const workerFlag = process.argv.indexOf('--worker')
    if (workerFlag >= 0) {
        const [indexText, countText] = (process.argv[workerFlag + 1] ?? '').split('/')
        const workerIndex = Number(indexText)
        const workerCount = Number(countText)
        if (!Number.isSafeInteger(workerIndex) || !Number.isSafeInteger(workerCount) || workerIndex < 0 || workerIndex >= workerCount) {
            throw new Error(`Invalid --worker slice: ${process.argv[workerFlag + 1] ?? ''}`)
        }
        const allComponents = componentCatalog.flatMap((category) => category.components)
        const slice = allComponents.filter((_, idx) => idx % workerCount === workerIndex)
        await renderComponentSlice(slice)
    } else {
        await buildComponentPreviews()
    }
}
