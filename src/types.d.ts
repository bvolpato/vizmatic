declare module 'tsx/esm/api' {
    export function tsImport<T = unknown>(specifier: string, parentUrl: string): Promise<T>
}

declare module 'gifenc' {
    interface GifencModule {
        GIFEncoder(): {
            writeFrame(index: Uint8Array, width: number, height: number, options: {
                palette: number[][]
                delay: number
                repeat: number
                transparent?: boolean
                transparentIndex?: number
            }): void
            finish(): void
            bytes(): Uint8Array
        }
        quantize(pixels: Uint8Array, colors: number, options: { format: string; oneBitAlpha?: boolean | number }): number[][]
        applyPalette(pixels: Uint8Array, palette: number[][], format: string): Uint8Array
    }
    const gifenc: GifencModule
    export default gifenc
    export function GIFEncoder(): {
        writeFrame(index: Uint8Array, width: number, height: number, options: {
            palette: number[][]
            delay: number
            repeat: number
            transparent?: boolean
            transparentIndex?: number
        }): void
        finish(): void
        bytes(): Uint8Array
    }
    export function quantize(pixels: Uint8Array, colors: number, options: { format: string; oneBitAlpha?: boolean | number }): number[][]
    export function applyPalette(pixels: Uint8Array, palette: number[][], format: string): Uint8Array
}
