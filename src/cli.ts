#!/usr/bin/env node

import { existsSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { createRequire, Module } from 'module'
import { tmpdir } from 'os'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { isValidElement } from 'react'
import type { ReactNode } from 'react'
import * as publicApi from './index'
import { renderAnimatedGif, type AnimatedScene } from './animate'
import type { WatermarkImageOptions, WatermarkInput, WatermarkOptions, WatermarkPosition } from './brand'
import { renderToPng } from './render'
import type { ThemeMode } from './theme'

interface FrameModule {
    width?: number
    height?: number
    create?: (theme: ThemeMode) => ReactNode
    createScenes?: (theme: ThemeMode) => AnimatedScene[]
    default?: ReactNode | { create?: (theme: ThemeMode) => ReactNode; default?: ReactNode; width?: number; height?: number }
    watermark?: WatermarkInput
    brand?: boolean | string
}

interface RenderArgs {
    inputs: string[]
    outDir: string
    themes: ThemeMode[]
    watermark?: WatermarkInput
    force: boolean
    crop: boolean
    scale?: number
}

const RENDER_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx'])
const cliRequire = createRequire(import.meta.url)
let frameDependencyAliasesInstalled = false
const BARE_FRAME_EXTRA_EXPORTS = new Set([
    'canvas',
    'colors',
    'defineIllustration',
    'getColor',
    'getGradient',
    'getStyles',
    'getThemeColors',
    'getToneColor',
    'getToneGradient',
    'gradients',
    'heatColor',
    'styles',
    'toneGradients',
    'typography',
])
const BARE_FRAME_EXPORTS = Object.keys(publicApi)
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
    .filter((name) => /^[A-Z]/.test(name) || BARE_FRAME_EXTRA_EXPORTS.has(name))
    .sort()

type ResolveFilename = (request: string, parent: unknown, isMain: boolean, options?: unknown) => string

function usageText() {
    return `Usage:
  vizmatic <file-or-directory...> [--out <dir>] [--theme dark,light] [--watermark Label] [--watermark-image path-or-url] [--watermark-position top-right] [--no-crop] [--force]
  vizmatic render <file-or-directory...> [--out <dir>] [--theme dark,light] [--watermark Label] [--watermark-image path-or-url] [--watermark-position top-right] [--no-crop] [--force]
  vizmatic gif <file-or-directory...> [--out <dir>] [--theme dark] [--watermark Label] [--watermark-image path-or-url] [--watermark-position top-right] [--scale 1]

Examples:
  vizmatic examples/attention-head.tsx --out dist/frames --theme dark,light
  pnpm dlx vizmatic ./frame.tsx --out ./dist/frames --theme dark
  vizmatic render examples --out docs/assets/examples --theme dark --watermark Vizmatic
  vizmatic render frames/attention.tsx --out dist/frames --theme dark,light
  vizmatic gif examples/animated-pipeline.tsx --out docs/assets/examples --theme dark --watermark Vizmatic`
}

function usage(): never {
    console.error(usageText())
    process.exit(1)
}

function help(): never {
    console.log(usageText())
    process.exit(0)
}

const WATERMARK_POSITIONS = new Set<WatermarkPosition>(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
}

function imageMime(source: string): string {
    return IMAGE_MIME_BY_EXT[extname(source).toLowerCase()] ?? 'application/octet-stream'
}

async function imageSourceToDataUri(source: string): Promise<string> {
    if (/^(data:|https?:\/\/)/i.test(source)) return source
    const filePath = resolve(source)
    const data = await readFile(filePath)
    return `data:${imageMime(filePath)};base64,${data.toString('base64')}`
}

async function resolveWatermarkAssets(watermark: WatermarkInput | undefined): Promise<WatermarkInput | undefined> {
    if (watermark == null || typeof watermark !== 'object') return watermark
    if (isValidElement(watermark) || !('image' in watermark) || !watermark.image) return watermark

    if (typeof watermark.image === 'string') {
        return {
            ...watermark,
            image: await imageSourceToDataUri(watermark.image),
        }
    }

    return {
        ...watermark,
        image: {
            ...watermark.image,
            src: await imageSourceToDataUri(watermark.image.src),
        },
    }
}

function resolveSelfEntry(): string | undefined {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const bundledEntry = join(moduleDir, 'index.cjs')
    if (existsSync(bundledEntry)) return bundledEntry

    const sourceEntry = join(moduleDir, 'index.ts')
    if (existsSync(sourceEntry)) return sourceEntry

    try {
        return cliRequire.resolve('vizmatic')
    } catch {
        return undefined
    }
}

function resolveSelfImportSpecifier(): string {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const bundledEntry = join(moduleDir, 'index.js')
    if (existsSync(bundledEntry)) return bundledEntry

    const sourceEntry = join(moduleDir, 'index.ts')
    if (existsSync(sourceEntry)) return sourceEntry

    return 'vizmatic'
}

function resolveFrameDependency(request: string): string | undefined {
    try {
        if (request === 'vizmatic') return resolveSelfEntry()
        if (request === 'react' || request.startsWith('react/')) return cliRequire.resolve(request)
    } catch {
        return undefined
    }
    return undefined
}

function installFrameDependencyAliases() {
    if (frameDependencyAliasesInstalled) return
    frameDependencyAliasesInstalled = true

    const moduleWithResolver = Module as unknown as { _resolveFilename: ResolveFilename }
    const resolveFilename = moduleWithResolver._resolveFilename
    moduleWithResolver._resolveFilename = function resolveFrameDependencyAlias(request, parent, isMain, options) {
        return resolveFrameDependency(request) ?? resolveFilename.call(this, request, parent, isMain, options)
    }
}

function rewriteRelativeImports(line: string, framePath: string): string {
    const frameDir = dirname(framePath)
    return line
        .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, before: string, specifier: string, after: string) =>
            `${before}${resolve(frameDir, specifier)}${after}`,
        )
        .replace(/(^\s*import\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, before: string, specifier: string, after: string) =>
            `${before}${resolve(frameDir, specifier)}${after}`,
        )
}

function readDimensionLine(line: string): { name: 'width' | 'height'; value: number } | undefined {
    const match = line.match(/^\s*(?:(?:\/\/\s*)?)(?:export\s+)?(?:(?:const|let|var)\s+)?(width|height)\s*[:=]\s*(\d+)\s*;?\s*$/i)
    if (!match?.[1] || !match[2]) return undefined
    return { name: match[1].toLowerCase() as 'width' | 'height', value: Number(match[2]) }
}

function readFrameDimension(jsx: string, name: 'width' | 'height'): number | undefined {
    const frameOpen = jsx.match(/<Frame\b[^>]*>/)?.[0]
    const value = frameOpen?.match(new RegExp(`${name}\\s*=\\s*(?:{(\\d+)}|"(\\d+)"|'(\\d+)'|(\\d+))`))
    const raw = value?.[1] ?? value?.[2] ?? value?.[3] ?? value?.[4]
    return raw ? Number(raw) : undefined
}

function findRootJsxStart(source: string): number {
    const match = source.match(/(^|\n)\s*(?:export\s+default\s+)?<(?:[A-Z]|\>)/)
    if (!match || match.index == null) return -1
    return match.index + (match[1] ? match[1].length : 0)
}

function bareFrameAlias(name: string): string {
    return `__Vizmatic_${name}`
}

function bareFrameExportsForSource(source: string): string[] {
    return BARE_FRAME_EXPORTS.filter((name) => {
        if (name === 'getThemeColors') return true
        if (/^[A-Z]/.test(name)) return new RegExp(`<\\/?${name}(?:\\s|>|/)`).test(source)
        return new RegExp(`\\b${name}\\b`).test(source)
    })
}

function buildAutoImportStatement(names: string[]): string {
    const specifiers = names.map((name) => `${name} as ${bareFrameAlias(name)}`).join(',\n    ')
    return `import {\n    ${specifiers}\n} from '${resolveSelfImportSpecifier()}'`
}

function buildAutoImportDeclarations(names: string[]): string {
    return names.map((name) => {
        if (/^[A-Z]/.test(name)) return `const ${name} = __withTheme(${bareFrameAlias(name)});`
        return `const ${name} = ${bareFrameAlias(name)};`
    }).join('\n')
}

function buildBareFrameModule(framePath: string, source: string): string | undefined {
    const imports: string[] = []
    const bodyLines: string[] = []
    let width: number | undefined
    let height: number | undefined

    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.startsWith('import ')) {
            if (!/['"](?:react|vizmatic)['"]/.test(trimmed)) {
                imports.push(rewriteRelativeImports(line, framePath))
            }
            continue
        }

        const dimension = readDimensionLine(line)
        if (dimension) {
            if (dimension.name === 'width') width = dimension.value
            if (dimension.name === 'height') height = dimension.value
            continue
        }

        bodyLines.push(line)
    }

    const body = bodyLines.join('\n')
    const jsxStart = findRootJsxStart(body)
    if (jsxStart < 0) return undefined

    const setup = body.slice(0, jsxStart).replace(/^\s*export\s+/gm, '')
    const jsx = body.slice(jsxStart).trim()
        .replace(/^export\s+default\s+/, '')
        .replace(/;\s*$/, '')

    width ??= readFrameDimension(jsx, 'width') ?? 960
    height ??= readFrameDimension(jsx, 'height') ?? 540
    const autoImports = bareFrameExportsForSource(body)

    return `import React from 'react'
${buildAutoImportStatement(autoImports)}
${imports.join('\n')}

let __theme = __Vizmatic_getThemeColors('dark')
function __withTheme(Component) {
    return function VizmaticAutoTheme(props) {
        return React.createElement(Component, props?.c ? props : { ...props, c: __theme })
    }
}
const Frame = ({ children }) => React.createElement(React.Fragment, null, children)
${buildAutoImportDeclarations(autoImports)}

export const width = ${width}
export const height = ${height}

export function create(theme = 'dark') {
    __theme = __Vizmatic_getThemeColors(theme)
    const c = __theme
${setup}
    return (${jsx})
}

export default create('dark')
`
}

function isBareFrameSource(source: string): boolean {
    if (/\bdefineIllustration\s*\(/.test(source)) return false
    if (/\bcreateScenes\s*\(/.test(source)) return false
    if (/\bexport\s+(?:const|function)\s+create\b/.test(source)) return false

    const body = source.split(/\r?\n/)
        .filter((line) => !line.trim().startsWith('import '))
        .filter((line) => !readDimensionLine(line))
        .join('\n')

    return findRootJsxStart(body) >= 0
}

async function importBareFrame(filePath: string, source?: string): Promise<FrameModule | undefined> {
    source ??= await readFile(filePath, 'utf8')
    const moduleSource = buildBareFrameModule(filePath, source)
    if (!moduleSource) return undefined

    const tempDir = await mkdtemp(join(tmpdir(), 'vizmatic-frame-'))
    const tempPath = join(tempDir, `${basename(filePath).replace(/\.[^.]+$/, '')}.generated.tsx`)
    await writeFile(tempPath, `${moduleSource}\n`)

    try {
        const { tsImport } = await import('tsx/esm/api')
        return await tsImport<FrameModule>(pathToFileURL(tempPath).href, import.meta.url)
    } finally {
        await rm(tempDir, { recursive: true, force: true })
    }
}

function parseRenderArgs(argv: string[]): RenderArgs {
    const inputs: string[] = []
    let outDir = 'dist/frames'
    let themes: ThemeMode[] = ['dark', 'light']
    let watermark: WatermarkInput | undefined
    let watermarkOptions: WatermarkOptions | undefined
    let force = false
    let crop = true
    let scale: number | undefined

    function mutableWatermark(): WatermarkOptions {
        if (!watermarkOptions) {
            watermarkOptions = typeof watermark === 'object' && watermark !== null && !isValidElement(watermark)
                ? { ...watermark }
                : {}
            if (typeof watermark === 'string') watermarkOptions.text = watermark
            watermark = watermarkOptions
        }
        return watermarkOptions
    }

    function readOptionalValue(index: number): string | undefined {
        const next = argv[index + 1]
        if (!next || next.startsWith('-')) return undefined
        return next
    }

    function setWatermarkImageSource(src: string) {
        const current = mutableWatermark().image
        if (current && typeof current === 'object') {
            current.src = src
        } else {
            mutableWatermark().image = src
        }
    }

    function mutableWatermarkImage(): WatermarkImageOptions {
        const watermarkConfig = mutableWatermark()
        if (!watermarkConfig.image || typeof watermarkConfig.image === 'string') {
            watermarkConfig.image = { src: watermarkConfig.image ?? '' }
        }
        return watermarkConfig.image
    }

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
            const label = argv[++index] ?? 'Vizmatic'
            mutableWatermark().text = label
        } else if (arg === '--watermark') {
            const label = readOptionalValue(index)
            if (label) {
                mutableWatermark().text = label
                index += 1
            } else {
                watermark = true
                watermarkOptions = undefined
            }
        } else if (arg === '--watermark-text') {
            const rawText = argv[++index] ?? usage()
            mutableWatermark().text = rawText === 'false' || rawText === 'none' ? false : rawText
        } else if (arg === '--watermark-icon') {
            const rawIcon = argv[++index] ?? usage()
            mutableWatermark().icon = rawIcon === 'false' || rawIcon === 'none' ? false : rawIcon
        } else if (arg === '--watermark-image') {
            setWatermarkImageSource(argv[++index] ?? usage())
        } else if (arg === '--watermark-image-width') {
            const width = Number(argv[++index])
            if (!Number.isFinite(width) || width <= 0) usage()
            mutableWatermarkImage().width = width
        } else if (arg === '--watermark-image-height') {
            const height = Number(argv[++index])
            if (!Number.isFinite(height) || height <= 0) usage()
            mutableWatermarkImage().height = height
        } else if (arg === '--watermark-position') {
            const position = argv[++index] as WatermarkPosition | undefined
            if (!position || !WATERMARK_POSITIONS.has(position)) usage()
            mutableWatermark().position = position
        } else if (arg === '--no-brand') {
            watermark = false
            watermarkOptions = undefined
        } else if (arg === '--no-watermark') {
            watermark = false
            watermarkOptions = undefined
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
    return { inputs, outDir, themes, watermark, force, crop, scale }
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
    installFrameDependencyAliases()
    const url = pathToFileURL(filePath).href
    try {
        return await import(url) as FrameModule
    } catch (nativeError) {
        if (!RENDER_EXTENSIONS.has(extname(filePath))) throw nativeError
        const source = await readFile(filePath, 'utf8')
        const isBareFrame = isBareFrameSource(source)
        if (isBareFrame) {
            const bareFrame = await importBareFrame(filePath, source)
            if (bareFrame) return bareFrame
        }

        const { tsImport } = await import('tsx/esm/api')
        try {
            return await tsImport<FrameModule>(url, import.meta.url)
        } catch (tsxError) {
            if (!isBareFrame) {
                const bareFrame = await importBareFrame(filePath, source)
                if (bareFrame) return bareFrame
            }
            throw tsxError
        }
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
    const cliWatermark = await resolveWatermarkAssets(args.watermark)
    const files = await findFrameFiles(args.inputs)
    if (files.length === 0) throw new Error('no frame files found')

    await mkdir(args.outDir, { recursive: true })
    const manifest: Array<{ name: string; source: string; width: number; height: number; outputs: string[] }> = []

    for (const file of files) {
        const rawMod = await importFrame(file)
        const mod = normalizeFrameModule(rawMod)
        const name = basename(file).replace(/\.[^.]+$/, '')
        const outputs: string[] = []
        const moduleWatermark = await resolveWatermarkAssets(mod.watermark ?? mod.brand)

        for (const theme of args.themes) {
            const outputName = `${name}_${theme}.png`
            const outputPath = join(args.outDir, outputName)
            await renderToPng(frameElement(mod, theme), {
                width: mod.width,
                height: mod.height,
                outputPath,
                watermark: cliWatermark ?? moduleWatermark,
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
    const cliWatermark = await resolveWatermarkAssets(args.watermark)
    const files = await findFrameFiles(args.inputs)
    if (files.length === 0) throw new Error('no frame files found')

    await mkdir(args.outDir, { recursive: true })
    const manifest: Array<{ name: string; source: string; width: number; height: number; outputs: string[] }> = []

    for (const file of files) {
        const rawMod = await importFrame(file)
        const mod = normalizeFrameModule(rawMod)
        const name = basename(file).replace(/\.[^.]+$/, '')
        const outputs: string[] = []
        const moduleWatermark = await resolveWatermarkAssets(mod.watermark ?? mod.brand)

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
                watermark: cliWatermark ?? moduleWatermark,
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
    const args = process.argv.slice(2)
    const [command, ...rest] = args
    if (command === 'render') {
        await renderCommand(rest)
    } else if (command === 'gif') {
        await gifCommand(rest)
    } else if (!command || command === 'help' || command === '--help' || command === '-h') {
        help()
    } else if (!command.startsWith('-')) {
        await renderCommand(args)
    } else {
        usage()
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
