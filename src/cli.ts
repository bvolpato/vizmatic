#!/usr/bin/env node

import { mkdir, readdir, writeFile } from 'fs/promises'
import { basename, extname, join, relative, resolve } from 'path'
import { pathToFileURL } from 'url'
import type { ReactNode } from 'react'
import { renderAnimatedGif, type AnimatedScene } from './animate'
import { renderToPng } from './render'
import type { ThemeMode } from './theme'

interface FrameModule {
    width?: number
    height?: number
    create?: (theme: ThemeMode) => ReactNode
    createScenes?: (theme: ThemeMode) => AnimatedScene[]
    default?: ReactNode | { create?: (theme: ThemeMode) => ReactNode; default?: ReactNode; width?: number; height?: number }
    brand?: boolean | string
}

interface RenderArgs {
    inputs: string[]
    outDir: string
    themes: ThemeMode[]
    brand?: boolean | string
    force: boolean
    crop: boolean
    scale?: number
}

const RENDER_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])

function usage(): never {
    console.error(`Usage:
  vizmatic render <file-or-directory...> --out <dir> [--theme dark,light] [--brand Label] [--no-crop] [--force]
  vizmatic gif <file-or-directory...> --out <dir> [--theme dark] [--brand Label] [--scale 1]

Examples:
  vizmatic render examples --out docs/assets/examples --theme dark --brand Vizmatic
  vizmatic render frames/attention.tsx --out dist/frames --theme dark,light
  vizmatic gif examples/animated-pipeline.tsx --out docs/assets/examples --theme dark --brand Vizmatic`)
    process.exit(1)
}

function parseRenderArgs(argv: string[]): RenderArgs {
    const inputs: string[] = []
    let outDir = 'dist/frames'
    let themes: ThemeMode[] = ['dark', 'light']
    let brand: boolean | string | undefined
    let force = false
    let crop = true
    let scale: number | undefined

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (!arg) continue

        if (arg === '--out') {
            outDir = argv[++index] ?? usage()
        } else if (arg === '--theme') {
            const raw = argv[++index] ?? usage()
            themes = raw.split(',').map((theme) => theme.trim()).filter(Boolean) as ThemeMode[]
            if (themes.some((theme) => theme !== 'dark' && theme !== 'light')) usage()
        } else if (arg === '--brand') {
            brand = argv[++index] ?? 'Vizmatic'
        } else if (arg === '--no-brand') {
            brand = false
        } else if (arg === '--force') {
            force = true
        } else if (arg === '--no-crop') {
            crop = false
        } else if (arg === '--scale') {
            const rawScale = Number(argv[++index])
            if (!Number.isFinite(rawScale) || rawScale <= 0) usage()
            scale = rawScale
        } else if (arg.startsWith('-')) {
            usage()
        } else {
            inputs.push(arg)
        }
    }

    if (inputs.length === 0) usage()
    return { inputs, outDir, themes, brand, force, crop, scale }
}

async function findFrameFiles(inputs: string[]): Promise<string[]> {
    const files: string[] = []

    async function walk(path: string) {
        const resolved = resolve(path)
        const entries = await readdir(resolved, { withFileTypes: true }).catch(() => undefined)
        if (!entries) {
            if (RENDER_EXTENSIONS.has(extname(resolved)) && !resolved.endsWith('.d.ts')) {
                files.push(resolved)
            }
            return
        }

        for (const entry of entries) {
            const next = join(resolved, entry.name)
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === 'dist') continue
                await walk(next)
            } else if (RENDER_EXTENSIONS.has(extname(entry.name)) && !entry.name.endsWith('.d.ts')) {
                files.push(next)
            }
        }
    }

    for (const input of inputs) {
        await walk(input)
    }

    return files.sort()
}

async function importFrame(filePath: string): Promise<FrameModule> {
    const url = pathToFileURL(filePath).href
    try {
        return await import(url) as FrameModule
    } catch (error) {
        if (!/\.[tj]sx?$/.test(filePath)) throw error
        const { tsImport } = await import('tsx/esm/api')
        return await tsImport<FrameModule>(url, import.meta.url)
    }
}

function normalizeFrameModule(mod: FrameModule): Required<Pick<FrameModule, 'width' | 'height'>> & FrameModule {
    const defaultObject = typeof mod.default === 'object' && mod.default && 'create' in mod.default
        ? mod.default as Exclude<FrameModule['default'], ReactNode>
        : undefined

    return {
        ...mod,
        ...(defaultObject ?? {}),
        width: mod.width ?? defaultObject?.width ?? 960,
        height: mod.height ?? defaultObject?.height ?? 540,
    }
}

function frameElement(mod: FrameModule, theme: ThemeMode): ReactNode {
    if (mod.create) return mod.create(theme)
    if (mod.default && !(typeof mod.default === 'object' && 'create' in mod.default)) return mod.default as ReactNode
    throw new Error('frame module must export create(theme) or default React element')
}

async function renderCommand(argv: string[]) {
    const args = parseRenderArgs(argv)
    const files = await findFrameFiles(args.inputs)
    if (files.length === 0) throw new Error('no frame files found')

    await mkdir(args.outDir, { recursive: true })
    const manifest: Array<{ name: string; source: string; width: number; height: number; outputs: string[] }> = []

    for (const file of files) {
        const rawMod = await importFrame(file)
        const mod = normalizeFrameModule(rawMod)
        const name = basename(file).replace(/\.[^.]+$/, '')
        const outputs: string[] = []

        for (const theme of args.themes) {
            const outputName = `${name}_${theme}.png`
            const outputPath = join(args.outDir, outputName)
            await renderToPng(frameElement(mod, theme), {
                width: mod.width,
                height: mod.height,
                outputPath,
                brand: args.brand ?? mod.brand,
                crop: args.crop,
                scale: args.scale,
            }, mod.create, theme)
            outputs.push(outputName)
            console.log(`rendered ${relative(process.cwd(), outputPath)}`)
        }

        manifest.push({
            name,
            source: relative(process.cwd(), file),
            width: mod.width,
            height: mod.height,
            outputs,
        })
    }

    await writeFile(join(args.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function gifCommand(argv: string[]) {
    const args = parseRenderArgs(argv)
    const files = await findFrameFiles(args.inputs)
    if (files.length === 0) throw new Error('no frame files found')

    await mkdir(args.outDir, { recursive: true })
    const manifest: Array<{ name: string; source: string; width: number; height: number; outputs: string[] }> = []

    for (const file of files) {
        const rawMod = await importFrame(file)
        const mod = normalizeFrameModule(rawMod)
        const name = basename(file).replace(/\.[^.]+$/, '')
        const outputs: string[] = []

        if (!mod.createScenes) {
            throw new Error(`${relative(process.cwd(), file)} must export createScenes(theme) for GIF rendering`)
        }

        for (const theme of args.themes) {
            const outputName = `${name}_${theme}.gif`
            const outputPath = join(args.outDir, outputName)
            await renderAnimatedGif(mod.createScenes(theme), {
                width: mod.width,
                height: mod.height,
                outputPath,
                brand: args.brand ?? mod.brand,
                scale: args.scale ?? 1,
                theme,
            })
            outputs.push(outputName)
            console.log(`rendered ${relative(process.cwd(), outputPath)}`)
        }

        manifest.push({
            name,
            source: relative(process.cwd(), file),
            width: mod.width,
            height: mod.height,
            outputs,
        })
    }

    await writeFile(join(args.outDir, 'gif-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

async function main() {
    const [command, ...rest] = process.argv.slice(2)
    if (command === 'render') {
        await renderCommand(rest)
    } else if (command === 'gif') {
        await gifCommand(rest)
    } else {
        usage()
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
