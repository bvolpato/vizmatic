import createHarfBuzz from 'harfbuzzjs/hb.js'
import wrapHarfBuzz from 'harfbuzzjs/hbjs.js'
import { createRetryableInitializer } from './retryable-initializer'

let publish: (api: unknown) => void
const ready = new Promise<unknown>((resolve) => {
    publish = resolve
})

export const initializeHarfbuzzRuntime = createRetryableInitializer(async (bytes: ArrayBuffer) => {
    const instance = await createHarfBuzz({ wasmBinary: new Uint8Array(bytes) })
    publish(wrapHarfBuzz(instance))
})

// Satori awaits this API; failed initialization remains retryable before user code runs.
export default ready
