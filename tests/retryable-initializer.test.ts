import { describe, expect, it, vi } from 'vitest'
import { createRetryableInitializer } from '../src/retryable-initializer'

describe('retryable initializer', () => {
    it('retries only the initializer that failed', async () => {
        const first = vi.fn()
            .mockRejectedValueOnce(new Error('first initialization failed'))
            .mockResolvedValue(undefined)
        const second = vi.fn().mockResolvedValue(undefined)
        const initializeFirst = createRetryableInitializer(first)
        const initializeSecond = createRetryableInitializer(second)

        await expect(Promise.all([
            initializeFirst('first.wasm'),
            initializeSecond('second.wasm'),
        ])).rejects.toThrow('first initialization failed')

        await expect(Promise.all([
            initializeFirst('first.wasm'),
            initializeSecond('second.wasm'),
        ])).resolves.toEqual([undefined, undefined])
        expect(first).toHaveBeenCalledTimes(2)
        expect(second).toHaveBeenCalledTimes(1)
    })
})
