import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import React from 'react'
import { transform } from 'sucrase'
import { componentCatalog } from './component-catalog'
import { createPlaygroundApi } from '../src/playground-api'
import { preparePlaygroundSource } from '../src/playground-source'
import { renderToPng } from '../src/render'
import { mergePlaygroundThemeColors } from '../src/frame-theme'
import { withDensity } from '../src/density'
import { withRenderContext } from '../src/renderContext'

const outputDirectory = 'docs/assets/components'
const themes = ['dark', 'light'] as const

/** Render the same copyable examples used by the component catalog into theme-aware chooser previews. */
export async function buildComponentPreviews(): Promise<void> {
    await mkdir(outputDirectory, { recursive: true })

    for (const category of componentCatalog) {
        for (const component of category.components) {
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
}
