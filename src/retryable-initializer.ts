export function createRetryableInitializer<T>(initialize: (input: T) => Promise<unknown> | unknown) {
    let initialized: Promise<void> | undefined

    return (input: T): Promise<void> => {
        if (initialized) return initialized

        const attempt = Promise.resolve()
            .then(() => initialize(input))
            .then(() => undefined)
        const retryable = attempt.catch((error: unknown) => {
            if (initialized === retryable) initialized = undefined
            throw error
        })
        initialized = retryable
        return retryable
    }
}
