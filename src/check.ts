import { mkdtemp, rm } from 'fs/promises'
import { AsyncLocalStorage } from 'async_hooks'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ReactNode } from 'react'
import * as primitives from './primitives'
import {
    analyzeContrast,
    analyzeRenderedLayout,
    analyzeWhitespaceBalance,
    diagnosticFromMessage,
    type CheckDiagnostic,
    type DiagnosticSeverity,
} from './diagnostics'
import { CanvasOverflowError, renderToPngWithOutput, type SatoriNode } from './render'
import type { RenderBackground } from './renderContext'
import { getThemeColors, type ThemeMode } from './theme'

export { CHECK_DIAGNOSTIC_CODES } from './diagnostics'
export type {
    CheckDiagnostic,
    CheckDiagnosticCode,
    CheckDiagnosticLocation,
    DiagnosticSeverity,
} from './diagnostics'

const DEFAULT_WIDTH = 960
const DEFAULT_HEIGHT = 540
const MAX_WIDTH = 1920
const MAX_HEIGHT = 1440
const GROWTH = 1.25
const MAX_AUTO_SIZE_ATTEMPTS = 6
const TRUSTED_COMPONENTS = new Set(Object.values(primitives))

export interface CheckAutoSizeAxes {
    width: boolean
    height: boolean
}

export type CheckAutoSize = boolean | Partial<CheckAutoSizeAxes>

type CheckFrameShape = {
    source?: string
    width?: number
    height?: number
    autoSize?: CheckAutoSize
}

/** A frame can be a fixed React scene or a factory that creates a themed scene. */
export type CheckFrameInput = CheckFrameShape & (
    | { scene: ReactNode; create?: never }
    | { create: (theme: ThemeMode) => ReactNode; scene?: never }
)

export type CheckFailurePolicy = DiagnosticSeverity | 'never'

export interface CheckOptions {
    /** Themes to check. Defaults to both Vizmatic themes. */
    themes?: readonly ThemeMode[]
    /** Background passed to Vizmatic primitives and the renderer. Defaults to transparent. */
    background?: RenderBackground
    /** Minimum severity that makes the report fail. Defaults to errors only. */
    failOn?: CheckFailurePolicy
}

export interface CheckThemeReport {
    theme: ThemeMode
    ok: boolean
    dimensions: {
        input: { width: number; height: number }
        resolved?: { width: number; height: number }
        output?: { width: number; height: number }
    }
    diagnostics: CheckDiagnostic[]
}

export interface CheckDiagnosticCounts {
    errors: number
    warnings: number
    info: number
}

export interface CheckFrameReport {
    schemaVersion: 1
    source?: string
    ok: boolean
    /** True when each requested theme completed rendering, regardless of failOn. */
    rendered: boolean
    autoSize: CheckAutoSizeAxes
    themes: CheckThemeReport[]
    summary: CheckDiagnosticCounts
}

interface RenderedFrame {
    width: number
    height: number
    outputWidth: number
    outputHeight: number
    logicalOutputWidth: number
    logicalOutputHeight: number
    contentBounds?: { x: number; y: number; width: number; height: number }
    layoutNodes: SatoriNode[]
}

interface CapturedConsoleMessage {
    severity: 'error' | 'warning'
    message: string
}

type CapturedConsoleSeverity = CapturedConsoleMessage['severity']
type CapturedConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn'
type ConsoleMethods = Record<CapturedConsoleMethod, (...args: unknown[]) => void>

const consoleCaptureContext = new AsyncLocalStorage<CapturedConsoleMessage[]>()
let activeConsoleCaptures = 0
let originalConsoleMethods: ConsoleMethods | undefined

function formatConsoleArgs(args: unknown[]): string {
    return args.map((value) => {
        if (value instanceof Error) return value.message
        if (typeof value === 'string') return value
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }).join(' ')
}

function installConsoleCapture(): () => void {
    if (activeConsoleCaptures === 0) {
        originalConsoleMethods = {
            debug: console.debug,
            error: console.error,
            info: console.info,
            log: console.log,
            warn: console.warn,
        }
        const original = originalConsoleMethods
        const intercept = (method: CapturedConsoleMethod, severity?: CapturedConsoleSeverity) => (...args: unknown[]) => {
            const messages = consoleCaptureContext.getStore()
            if (messages) {
                if (severity) messages.push({ severity, message: formatConsoleArgs(args) })
                return
            }
            Reflect.apply(original[method], console, args)
        }
        console.debug = intercept('debug')
        console.error = intercept('error', 'error')
        console.info = intercept('info')
        console.log = intercept('log')
        console.warn = intercept('warn', 'warning')
    }
    activeConsoleCaptures += 1

    let restored = false
    return () => {
        if (restored) return
        restored = true
        activeConsoleCaptures -= 1
        if (activeConsoleCaptures === 0 && originalConsoleMethods) {
            console.debug = originalConsoleMethods.debug
            console.error = originalConsoleMethods.error
            console.info = originalConsoleMethods.info
            console.log = originalConsoleMethods.log
            console.warn = originalConsoleMethods.warn
            originalConsoleMethods = undefined
        }
    }
}

async function captureConsole<T>(run: () => Promise<T>): Promise<{
    value?: T
    error?: unknown
    messages: CapturedConsoleMessage[]
}> {
    const messages: CapturedConsoleMessage[] = []
    const uninstall = installConsoleCapture()

    try {
        const value = await consoleCaptureContext.run(messages, run)
        return { value, messages }
    } catch (error) {
        return { error, messages }
    } finally {
        uninstall()
    }
}

function normalizeAutoSize(value: CheckAutoSize | undefined, defaults: CheckAutoSizeAxes): CheckAutoSizeAxes {
    if (value === true) return { width: true, height: true }
    if (value === false) return { width: false, height: false }
    if (value) return { width: value.width ?? defaults.width, height: value.height ?? defaults.height }
    return defaults
}

function overflowEdges(error: unknown): Array<'top' | 'right' | 'bottom' | 'left'> | undefined {
    if (!(error instanceof CanvasOverflowError)) return undefined
    return (Object.entries(error.overflow.edges) as Array<['top' | 'right' | 'bottom' | 'left', boolean]>)
        .filter(([, overflows]) => overflows)
        .map(([edge]) => edge)
}

function nextDimension(value: number, maximum: number): number {
    return Math.min(maximum, Math.ceil((value * GROWTH) / 10) * 10)
}

function nextAutoSize(
    width: number,
    height: number,
    autoSize: CheckAutoSizeAxes,
    edges: Array<'top' | 'right' | 'bottom' | 'left'>,
): { width: number; height: number } | undefined {
    const growWidth = autoSize.width && (edges.includes('left') || edges.includes('right'))
    const growHeight = autoSize.height && (edges.includes('top') || edges.includes('bottom'))
    const nextWidth = growWidth ? nextDimension(width, MAX_WIDTH) : width
    const nextHeight = growHeight ? nextDimension(height, MAX_HEIGHT) : height
    if (nextWidth === width && nextHeight === height) return undefined
    return { width: nextWidth, height: nextHeight }
}

async function renderFrame(
    create: (theme: ThemeMode) => ReactNode,
    theme: ThemeMode,
    options: {
        width: number
        height: number
        autoSize: CheckAutoSizeAxes
        background?: RenderBackground
        outputPath: string
    },
): Promise<RenderedFrame> {
    let width = options.width
    let height = options.height

    for (let attempt = 0; attempt < MAX_AUTO_SIZE_ATTEMPTS; attempt += 1) {
        try {
            const layoutNodes: SatoriNode[] = []
            const output = await renderToPngWithOutput(create(theme), {
                width,
                height,
                outputPath: options.outputPath,
                crop: true,
                scale: 1,
                background: options.background,
                onNodeDetected: (node) => layoutNodes.push(node),
            }, create, theme)
            return {
                width,
                height,
                outputWidth: output.pixelWidth,
                outputHeight: output.pixelHeight,
                logicalOutputWidth: output.width,
                logicalOutputHeight: output.height,
                contentBounds: output.contentBounds,
                layoutNodes,
            }
        } catch (error) {
            const edges = overflowEdges(error)
            const next = edges ? nextAutoSize(width, height, options.autoSize, edges) : undefined
            if (!next || attempt === MAX_AUTO_SIZE_ATTEMPTS - 1) throw error
            width = next.width
            height = next.height
        }
    }

    return {
        width,
        height,
        outputWidth: width,
        outputHeight: height,
        logicalOutputWidth: width,
        logicalOutputHeight: height,
        layoutNodes: [],
    }
}

function counts(themes: CheckThemeReport[]): CheckDiagnosticCounts {
    const diagnostics = themes.flatMap(({ diagnostics: themeDiagnostics }) => themeDiagnostics)
    return {
        errors: diagnostics.filter(({ severity }) => severity === 'error').length,
        warnings: diagnostics.filter(({ severity }) => severity === 'warning').length,
        info: diagnostics.filter(({ severity }) => severity === 'info').length,
    }
}

function fails(diagnostics: CheckDiagnostic[], policy: CheckFailurePolicy): boolean {
    if (policy === 'never') return false
    const threshold = { error: 0, warning: 1, info: 2 }[policy]
    const levels: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 }
    return diagnostics.some(({ severity }) => levels[severity] <= threshold)
}

function messageDiagnostics(messages: CapturedConsoleMessage[], theme: ThemeMode): CheckDiagnostic[] {
    return messages.map(({ message, severity }) => diagnosticFromMessage(message, severity, theme))
}

function rootBackground(background: RenderBackground | undefined, theme: ThemeMode): string | undefined {
    if (background === 'theme') return getThemeColors(theme).bg
    if (background === 'transparent' || background === undefined) return undefined
    return background
}

/**
 * Check a React scene or themed frame by rendering each requested theme and
 * returning structured diagnostics. This function does not write an artifact.
 */
export async function checkFrame(input: CheckFrameInput, options: CheckOptions = {}): Promise<CheckFrameReport> {
    const themes = options.themes ?? ['dark', 'light']
    if (themes.length === 0) throw new TypeError('checkFrame requires at least one theme')

    const width = input.width ?? DEFAULT_WIDTH
    const height = input.height ?? DEFAULT_HEIGHT
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new TypeError('checkFrame width and height must be positive finite numbers')
    }

    const autoSize = normalizeAutoSize(input.autoSize, {
        width: input.width == null,
        height: input.height == null,
    })
    const create = input.create ?? (() => input.scene)
    const failOn = options.failOn ?? 'error'
    const tempDir = await mkdtemp(join(tmpdir(), 'vizmatic-check-'))
    const reports: CheckThemeReport[] = []

    try {
        for (const [themeIndex, theme] of themes.entries()) {
            const inputDimensions = { width, height }
            const diagnostics: CheckDiagnostic[] = []
            const prepared = await captureConsole(async () => {
                const element = create(theme)
                const background = rootBackground(options.background, theme)
                return analyzeContrast(element, theme, TRUSTED_COMPONENTS, background)
            })
            diagnostics.push(...messageDiagnostics(prepared.messages, theme))

            if (!prepared.value) {
                diagnostics.push(diagnosticFromMessage(
                    prepared.error instanceof Error ? prepared.error.message : String(prepared.error),
                    'error',
                    theme,
                ))
                reports.push({
                    theme,
                    ok: !fails(diagnostics, failOn),
                    dimensions: { input: inputDimensions },
                    diagnostics,
                })
                continue
            }
            diagnostics.push(...prepared.value)

            const rendered = await captureConsole(() => renderFrame(create, theme, {
                width,
                height,
                autoSize,
                background: options.background,
                outputPath: join(tempDir, `${themeIndex}.png`),
            }))
            diagnostics.push(...messageDiagnostics(rendered.messages, theme))

            if (rendered.value) {
                diagnostics.push(...analyzeRenderedLayout(rendered.value.layoutNodes, theme))
                if (rendered.value.contentBounds) {
                    diagnostics.push(...analyzeWhitespaceBalance(
                        rendered.value.contentBounds,
                        rendered.value.logicalOutputWidth,
                        rendered.value.logicalOutputHeight,
                        theme,
                    ))
                }
                if (rendered.value.width !== width || rendered.value.height !== height) {
                    diagnostics.push({
                        code: 'layout.auto_size',
                        severity: 'info',
                        theme,
                        message: `Canvas auto-sized from ${width}×${height} to ${rendered.value.width}×${rendered.value.height}.`,
                        suggestedDimensions: { width: rendered.value.width, height: rendered.value.height },
                    })
                }
                reports.push({
                    theme,
                    ok: !fails(diagnostics, failOn),
                    dimensions: {
                        input: inputDimensions,
                        resolved: { width: rendered.value.width, height: rendered.value.height },
                        output: { width: rendered.value.outputWidth, height: rendered.value.outputHeight },
                    },
                    diagnostics,
                })
                continue
            }

            const edges = overflowEdges(rendered.error)
            if (edges) {
                const suggestion = await captureConsole(() => renderFrame(create, theme, {
                    width,
                    height,
                    autoSize: { width: true, height: true },
                    background: options.background,
                    outputPath: join(tempDir, `${themeIndex}-suggestion.png`),
                }))
                const suggestedDimensions = suggestion.value
                    ? { width: suggestion.value.width, height: suggestion.value.height }
                    : undefined
                diagnostics.push({
                    code: 'layout.overflow',
                    severity: 'error',
                    theme,
                    edges,
                    message: rendered.error instanceof Error ? rendered.error.message : String(rendered.error),
                    suggestion: suggestedDimensions
                        ? `Increase the canvas to at least ${suggestedDimensions.width}×${suggestedDimensions.height}, or remove fixed dimensions to enable auto-sizing.`
                        : 'Increase the canvas dimensions or remove fixed dimensions to enable auto-sizing.',
                    suggestedDimensions,
                })
            } else {
                diagnostics.push(diagnosticFromMessage(
                    rendered.error instanceof Error ? rendered.error.message : String(rendered.error),
                    'error',
                    theme,
                ))
            }

            reports.push({
                theme,
                ok: !fails(diagnostics, failOn),
                dimensions: { input: inputDimensions },
                diagnostics,
            })
        }
    } finally {
        await rm(tempDir, { recursive: true, force: true })
    }

    const summary = counts(reports)
    const diagnostics = reports.flatMap(({ diagnostics: themeDiagnostics }) => themeDiagnostics)
    return {
        schemaVersion: 1,
        source: input.source,
        ok: !fails(diagnostics, failOn),
        rendered: reports.every(({ dimensions }) => dimensions.resolved !== undefined),
        autoSize,
        themes: reports,
        summary,
    }
}
