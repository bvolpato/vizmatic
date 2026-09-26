declare module 'harfbuzzjs/hb.js' {
    const createHarfBuzz: (options: { wasmBinary: Uint8Array }) => Promise<unknown>
    export default createHarfBuzz
}

declare module 'harfbuzzjs/hbjs.js' {
    const wrapHarfBuzz: (instance: unknown) => unknown
    export default wrapHarfBuzz
}
