import type { ThemeMode } from 'vizmatic'
import { createAt } from './engineering-dashboard'

// The same source as engineering-dashboard.tsx, scaled for a room. Only the density changes.
export const density = 'presentation'
export const width = 2500
export const height = 1760

export function create(theme: ThemeMode = 'dark') {
    return createAt(theme, 'presentation')
}

export default create('dark')
