import React from 'react'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import satori, { init as initSatori } from 'satori/standalone'
import { transform } from 'sucrase'
import * as primitives from './primitives'
import * as themeApi from './theme'
import {
    preparePlaygroundSource,
    type PlaygroundTheme,
} from './playground-source'
import {
    setPlaygroundRenderBackground,
    type PlaygroundRenderBackground,
} from './playground-render-context'
import interRegular from '../assets/fonts/Inter-Regular.ttf'
import interSemiBold from '../assets/fonts/Inter-SemiBold.ttf'
import interBold from '../assets/fonts/Inter-Bold.ttf'
import jetBrainsMono from '../assets/fonts/JetBrainsMono-Regular.ttf'
import notoSans from '../assets/fonts/NotoSans-Regular.ttf'
import notoSansMath from '../assets/fonts/NotoSansMath-Regular.ttf'
import yogaWasm from 'satori/yoga.wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'

export interface PlaygroundRenderRequest {
    id: number
    source: string
    theme: PlaygroundTheme
    background?: PlaygroundRenderBackground
}

interface PlaygroundRenderResponse {
    id: number
    ok: true
    svg: string
    png: ArrayBuffer
    width: number
    height: number
    warnings: string[]
}

interface PlaygroundErrorResponse {
    id: number
    ok: false
    error: string
}

interface PlaygroundRuntime {
    fonts: Array<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' }>
}

let runtime: Promise<PlaygroundRuntime> | undefined
let capabilitiesDisabled = false
const compileUserFunction = Function
const dynamicFunctionPrototypes = [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
]

function disableUserCodeCapabilities(): void {
    if (capabilitiesDisabled) return
    capabilitiesDisabled = true
    const denied = () => {
        throw new Error('Network, dynamic code, and browser storage APIs are disabled in the Vizmatic playground.')
    }
    const globals = globalThis as unknown as Record<string, unknown>
    for (const name of [
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'WebSocketStream',
        'WebTransport',
        'EventSource',
        'BroadcastChannel',
        'RTCPeerConnection',
        'webkitRTCPeerConnection',
        'importScripts',
        'Worker',
        'SharedWorker',
        'indexedDB',
        'caches',
        'eval',
        'Function',
    ]) {
        try {
            Object.defineProperty(globals, name, {
                configurable: false,
                writable: false,
                value: denied,
            })
        } catch {
            try {
                globals[name] = denied
            } catch {
                // Some browser globals are non-configurable. Shared source still
                // requires an explicit Run action before this worker starts.
            }
        }
    }

    const navigatorApi = globals.navigator as Record<string, unknown> | undefined
    const restrictedNavigatorApis: Array<[unknown, string[]]> = [
        [navigatorApi, ['sendBeacon']],
        [navigatorApi?.storage, ['getDirectory']],
        [navigatorApi?.storageBuckets, ['delete', 'keys', 'open']],
    ]
    for (const [api, methods] of restrictedNavigatorApis) {
        if (!api || typeof api !== 'object') continue
        for (const method of methods) {
            try {
                Object.defineProperty(api, method, {
                    configurable: false,
                    writable: false,
                    value: denied,
                })
            } catch {
                try {
                    (api as Record<string, unknown>)[method] = denied
                } catch {
                    // Browser-owned APIs can be non-configurable.
                }
            }
        }
    }

    for (const prototype of dynamicFunctionPrototypes) {
        try {
            Object.defineProperty(prototype, 'constructor', {
                configurable: false,
                writable: false,
                value: denied,
            })
        } catch {
            // Already locked by this worker runtime.
        }
    }
}

async function loadStaticAsset(path: string): Promise<ArrayBuffer> {
    const url = new URL(path, self.location.href)
    if (url.origin !== self.location.origin) throw new Error('Playground assets must be served from this site.')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not load playground asset: ${url.pathname}`)
    return response.arrayBuffer()
}

function initializeRuntime(): Promise<PlaygroundRuntime> {
    runtime ??= Promise.all([
        loadStaticAsset(yogaWasm),
        loadStaticAsset(resvgWasm),
        loadStaticAsset(interRegular),
        loadStaticAsset(interSemiBold),
        loadStaticAsset(interBold),
        loadStaticAsset(jetBrainsMono),
        loadStaticAsset(notoSans),
        loadStaticAsset(notoSansMath),
    ]).then(async ([yoga, resvg, regular, semiBold, bold, mono, sans, math]) => {
        await Promise.all([initSatori(yoga), initWasm(resvg)])
        const fonts: PlaygroundRuntime['fonts'] = [
            { name: 'Inter', data: regular, weight: 400, style: 'normal' },
            { name: 'Inter', data: semiBold, weight: 600, style: 'normal' },
            { name: 'Inter', data: bold, weight: 700, style: 'normal' },
            { name: 'JetBrains Mono', data: mono, weight: 400, style: 'normal' },
            { name: 'Noto Sans', data: sans, weight: 400, style: 'normal' },
            { name: 'Noto Sans Math', data: math, weight: 400, style: 'normal' },
        ]
        return {
            fonts,
        }
    })
    return runtime
}

type PlaygroundApi = Record<string, unknown>

function withTheme(Component: unknown, c: ReturnType<typeof themeApi.getThemeColors>): unknown {
    if (typeof Component !== 'function') return Component

    return function VizmaticPlaygroundTheme(props: Record<string, unknown> | null) {
        return React.createElement(Component as React.ComponentType<Record<string, unknown>>, props?.c ? props : { ...props, c })
    }
}

function createApi(c: ReturnType<typeof themeApi.getThemeColors>): PlaygroundApi {
    const api: PlaygroundApi = { ...themeApi, ...primitives }
    const scoped: PlaygroundApi = {}

    for (const [name, value] of Object.entries(api)) {
        scoped[name] = /^[A-Z]/.test(name) ? withTheme(value, c) : value
    }

    return scoped
}

async function render(request: PlaygroundRenderRequest): Promise<PlaygroundRenderResponse> {
    const { fonts } = await initializeRuntime()
    const prepared = preparePlaygroundSource(request.source)
    const c = themeApi.getThemeColors(request.theme, prepared.metadata.preset)
    const api = createApi(c)
    const wrapped = `const __vizmaticPlaygroundRender = () => {\n${prepared.setup}\nreturn (${prepared.jsx});\n};`
    const result = transform(wrapped, {
        transforms: ['typescript', 'jsx'],
        jsxPragma: 'React.createElement',
        production: true,
    })

    const argumentNames = ['React', 'c', ...Object.keys(api)]
    const createElement = compileUserFunction(...argumentNames, `'use strict';\n${result.code}\nreturn __vizmaticPlaygroundRender();`) as (...values: unknown[]) => React.ReactNode
    disableUserCodeCapabilities()
    const element = createElement(React, c, ...Object.values(api))

    setPlaygroundRenderBackground(request.background ?? 'transparent')
    const svg = await satori(element as React.ReactElement, {
        width: prepared.metadata.width,
        height: prepared.metadata.height,
        fonts,
    })
    const resvg = new Resvg(svg, { font: { loadSystemFonts: false } })
    try {
        const png = resvg.render().asPng().slice()
        return {
            id: request.id,
            ok: true,
            svg,
            png: png.buffer,
            width: prepared.metadata.width,
            height: prepared.metadata.height,
            warnings: prepared.metadata.warnings,
        }
    } finally {
        resvg.free()
    }
}

// User snippets run only in this dedicated worker. Main thread restarts it on a
// timeout or a superseding edit, so an infinite expression cannot freeze UI.
interface PlaygroundWorkerScope {
    onmessage: ((event: MessageEvent<PlaygroundRenderRequest>) => void) | null
    postMessage(message: unknown, transfer?: Transferable[]): void
}

const workerScope = self as unknown as PlaygroundWorkerScope

workerScope.onmessage = async (event: MessageEvent<PlaygroundRenderRequest>) => {
    const request = event.data
    try {
        const response = await render(request)
        workerScope.postMessage(response, [response.png])
    } catch (error) {
        const response: PlaygroundErrorResponse = {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        }
        workerScope.postMessage(response)
    }
}
