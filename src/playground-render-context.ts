export type PlaygroundRenderBackground = 'transparent' | 'theme' | (string & {})

let background: PlaygroundRenderBackground = 'transparent'

export function getRenderBackground(): PlaygroundRenderBackground {
    return background
}

export function setPlaygroundRenderBackground(value: PlaygroundRenderBackground): void {
    background = value
}

export async function withRenderContext<T>(
    context: { background?: PlaygroundRenderBackground },
    render: () => Promise<T>,
): Promise<T> {
    const previous = background
    background = context.background ?? previous
    try {
        return await render()
    } finally {
        background = previous
    }
}
