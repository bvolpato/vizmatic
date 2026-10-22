import { newQuickJSWASMModule, newVariant, RELEASE_SYNC, type QuickJSWASMModule } from 'quickjs-emscripten'

let modulePromise: Promise<QuickJSWASMModule> | undefined

export function initializeBrowserQuickJS(wasmBinary: ArrayBuffer): Promise<QuickJSWASMModule> {
    modulePromise ??= newQuickJSWASMModule(newVariant(RELEASE_SYNC, { wasmBinary }))
        .catch((error: unknown) => { modulePromise = undefined; throw error })
    return modulePromise
}

/** The scene-runtime import is replaced with this adapter only in the browser bundle. */
export function getQuickJS(): Promise<QuickJSWASMModule> {
    if (!modulePromise) throw new Error('Initialize the browser scene renderer before preparing a scene.')
    return modulePromise
}
