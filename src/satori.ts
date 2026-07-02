import * as satoriModule from 'satori'

export type { Font } from 'satori'

type SatoriFn = typeof import('satori').default

function resolveSatori(api: unknown): SatoriFn {
    if (typeof api === 'function') return api as SatoriFn

    if (api && typeof api === 'object') {
        const fallback = (api as { default?: unknown }).default
        if (typeof fallback === 'function') return fallback as SatoriFn

        if (fallback && typeof fallback === 'object') {
            const nestedFallback = (fallback as { default?: unknown }).default
            if (typeof nestedFallback === 'function') return nestedFallback as SatoriFn
        }
    }

    throw new Error('satori export could not be resolved')
}

export const satori = resolveSatori(satoriModule)
