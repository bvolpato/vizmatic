let capabilitiesDisabled = false

const dynamicFunctionPrototypes = [
    Function.prototype,
    Object.getPrototypeOf(async function () {}),
    Object.getPrototypeOf(function* () {}),
    Object.getPrototypeOf(async function* () {}),
]

export interface DisableCapabilitiesOptions {
    lockFunctionPrototypes?: boolean
}

export function disableUserCodeCapabilities(
    targetGlobal: unknown = globalThis,
    options: DisableCapabilitiesOptions = {},
): void {
    const isRealGlobal = targetGlobal === globalThis
    if (isRealGlobal) {
        if (capabilitiesDisabled) return
        capabilitiesDisabled = true
    }
    const denied = () => {
        throw new Error('Network, dynamic code, and browser storage APIs are disabled in the Vizmatic playground.')
    }
    const lockProperty = (target: unknown, name: string): void => {
        if (!target || (typeof target !== 'object' && typeof target !== 'function')) return
        try {
            Object.defineProperty(target, name, {
                configurable: false,
                enumerable: false,
                get: denied,
                set: denied,
            })
            return
        } catch {
            // Fall through to non-accessor property lock or assignment.
        }
        try {
            Object.defineProperty(target, name, {
                configurable: false,
                writable: false,
                value: denied,
            })
        } catch {
            try {
                (target as Record<string, unknown>)[name] = denied
            } catch {
                // Non-configurable browser-owned intrinsic; prototype and instance locks cover reachable paths.
            }
        }
    }
    const lockChain = (root: unknown, names: readonly string[]): void => {
        for (let cursor = root; cursor && cursor !== Object.prototype; cursor = Object.getPrototypeOf(cursor)) {
            for (const name of names) lockProperty(cursor, name)
        }
    }

    const globals = targetGlobal as Record<string, unknown>
    const navigatorApi = globals.navigator as Record<string, unknown> | undefined
    const storageApi = navigatorApi?.storage
    const storageBucketsApi = navigatorApi?.storageBuckets
    const locksApi = navigatorApi?.locks
    const fontsApi = globals.fonts

    // Capture nested objects before locking their getters on navigator / globalThis.
    lockChain(storageApi, ['getDirectory', 'estimate', 'persist', 'persisted'])
    lockChain(storageBucketsApi, ['delete', 'keys', 'open'])
    lockChain(locksApi, ['request', 'query'])
    lockChain(fontsApi, ['add', 'load', 'clear', 'delete'])
    lockChain(navigatorApi, ['sendBeacon', 'storage', 'storageBuckets', 'locks', 'serviceWorker'])

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
        'ServiceWorkerContainer',
        'indexedDB',
        'IDBFactory',
        'IDBDatabase',
        'caches',
        'CacheStorage',
        'Cache',
        'StorageManager',
        'FontFace',
        'FontFaceSet',
        'fonts',
        'postMessage',
        'close',
        'eval',
        'Function',
    ]) {
        lockProperty(globals, name)
    }

    // WebIDL exposes indexedDB, caches, fetch, postMessage, and importScripts on
    // WorkerGlobalScope / DedicatedWorkerGlobalScope prototypes; lock the whole chain.
    lockChain(Object.getPrototypeOf(globals), [
        'fetch',
        'indexedDB',
        'caches',
        'importScripts',
        'postMessage',
        'close',
        'fonts',
        'webkitRequestFileSystem',
        'webkitRequestFileSystemSync',
        'webkitResolveLocalFileSystemURL',
        'webkitResolveLocalFileSystemSyncURL',
    ])

    if (options.lockFunctionPrototypes ?? isRealGlobal) {
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
}
