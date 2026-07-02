declare module 'tsx/esm/api' {
    export function tsImport<T = unknown>(specifier: string, parentUrl: string): Promise<T>
}

declare module 'gifenc' {
    interface GifencModule {
        GIFEncoder(): {
            writeFrame(index: Uint8Array, width: number, height: number, options: {
                palette: unknown
                delay: number
                repeat: number
            }): void
            finish(): void
            bytes(): Uint8Array
        }
        quantize(pixels: Uint8Array, colors: number, options: { format: string }): unknown
        applyPalette(pixels: Uint8Array, palette: unknown, format: string): Uint8Array
    }
    const gifenc: GifencModule
    export default gifenc
    export function GIFEncoder(): {
        writeFrame(index: Uint8Array, width: number, height: number, options: {
            palette: unknown
            delay: number
            repeat: number
        }): void
        finish(): void
        bytes(): Uint8Array
    }
    export function quantize(pixels: Uint8Array, colors: number, options: { format: string }): unknown
    export function applyPalette(pixels: Uint8Array, palette: unknown, format: string): Uint8Array
}
