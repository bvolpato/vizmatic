export type Bloom = (
    pixels: Uint8Array,
    width: number,
    height: number,
    amount: number,
    background: readonly number[],
    dither: boolean,
) => void

export function createBloom(): Bloom
