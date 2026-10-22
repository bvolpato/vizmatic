import satori, { init } from 'satori/standalone'
import { renderWithCanvasChartFit } from './canvas-chart-fit'
import { createRetryableInitializer } from './retryable-initializer'

const initialize = createRetryableInitializer(init)

/** Kept in a separate browser chunk so native SVG never loads the layout engine. */
export async function initializeBrowserLayout(wasm: ArrayBuffer): Promise<typeof satori> {
    await initialize(wasm)
    return (element, options) => renderWithCanvasChartFit(satori, element, options)
}
