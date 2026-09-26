import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'
import ready, { initializeHarfbuzzRuntime } from '../src/playground-harfbuzz'

it('publishes the shaping API only after successful initialization and recovers from invalid WASM', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
        await expect(initializeHarfbuzzRuntime(new ArrayBuffer(0))).rejects.toThrow()
        const wasm = await readFile(createRequire(import.meta.url).resolve('harfbuzzjs/hb.wasm'))
        const bytes = Uint8Array.from(wasm).buffer
        await initializeHarfbuzzRuntime(bytes)
        const api = await ready
        expect(api).toMatchObject({ createBlob: expect.any(Function), shape: expect.any(Function) })
        await initializeHarfbuzzRuntime(new ArrayBuffer(0))
        expect(await ready).toBe(api)
    } finally {
        error.mockRestore()
    }
})
