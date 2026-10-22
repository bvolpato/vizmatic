import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export { SCENE_BROWSER_FONT_PINS, SCENE_BROWSER_WASM_PINS, SCENE_BROWSER_EMOJI_SHA256 } from './scene-browser-pins'

/** Build-time paths. Copy these assets to your own origin; no runtime CDN is required. */
export function getSceneBrowserAssetPaths() {
    const require = createRequire(import.meta.url)
    const quickjsRequire = createRequire(require.resolve('quickjs-emscripten'))
    const assetDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
    return {
        quickjsWasm: quickjsRequire.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),
        layoutWasm: require.resolve('satori/layout.wasm'),
        resvgWasm: require.resolve('@resvg/resvg-wasm/index_bg.wasm'),
        fonts: {
            interRegular: join(assetDirectory, 'fonts/Inter-Regular.ttf'),
            interSemiBold: join(assetDirectory, 'fonts/Inter-SemiBold.ttf'),
            interBold: join(assetDirectory, 'fonts/Inter-Bold.ttf'),
            jetBrainsMono: join(assetDirectory, 'fonts/JetBrainsMono-Regular.ttf'),
            notoSans: join(assetDirectory, 'fonts/NotoSans-Regular.ttf'),
            notoSansMath: join(assetDirectory, 'fonts/NotoSansMath-Regular.ttf'),
        },
        emojiBrotli: join(assetDirectory, 'emoji.json.br'),
    }
}

export const browserSceneAssetPaths = getSceneBrowserAssetPaths
