import { AsyncLocalStorage } from 'async_hooks'

export type RenderBackground = 'transparent' | 'theme' | (string & {})

interface RenderContext {
    background?: RenderBackground
}

const RENDER_CONTEXT_KEY = Symbol.for('vizmatic.renderContext')
const globalRenderContext = globalThis as typeof globalThis & Record<symbol, AsyncLocalStorage<RenderContext> | undefined>
const renderContext = globalRenderContext[RENDER_CONTEXT_KEY] ??= new AsyncLocalStorage<RenderContext>()

export function getRenderBackground(): RenderBackground {
    return renderContext.getStore()?.background ?? 'transparent'
}

export async function withRenderContext<T>(context: RenderContext, render: () => Promise<T>): Promise<T> {
    const parent = renderContext.getStore()
    return renderContext.run({ ...parent, ...context }, render)
}
