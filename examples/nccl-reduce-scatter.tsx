import type { ThemeMode } from 'vizmatic'
import { createNcclAnimation, createNcclFrame } from './_shared/nccl-collective'

export { height, width } from './_shared/nccl-collective'

export function createAnimation(theme: ThemeMode) {
    return createNcclAnimation(theme, 'reduce-scatter')
}

export function create(theme: ThemeMode = 'dark') {
    return createNcclFrame(theme, 'reduce-scatter')
}

export default create('dark')
