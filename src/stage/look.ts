/**
 * A look is a complete art direction for a film: background, ink, a small set
 * of named pigments, and how much light the image gives off. Authors write
 * `color: 'yellow'`, so one film renders correctly in every look.
 */
export interface Look {
    readonly name: string
    readonly dark: boolean
    readonly background: string
    /** Full-frame bloom in the light-emitting looks. 0 turns it off. */
    readonly bloom: number
    readonly colors: Readonly<Record<LookToken, string>>
}

export type LookToken =
    | 'bg' | 'surface' | 'ink' | 'dim' | 'faint' | 'grid' | 'gridStrong'
    | 'blue' | 'teal' | 'green' | 'yellow' | 'gold' | 'orange' | 'red' | 'pink' | 'purple'

/** Deep neutral black with luminous pigments. The default. */
export const midnight: Look = {
    name: 'midnight', dark: true, background: '#0b0c10', bloom: 0.2,
    colors: {
        bg: '#0b0c10', surface: '#15171d', ink: '#f2efe6', dim: '#a5a7ad', faint: '#5c5f68',
        grid: '#23303d', gridStrong: '#3d5266',
        blue: '#5cc4f0', teal: '#4fd8c4', green: '#8fe08a', yellow: '#ffd75e', gold: '#f2b84b',
        orange: '#ff9d57', red: '#ff6b6b', pink: '#ff8fc0', purple: '#b49cff',
    },
}

/** Warm paper and printed ink, for articles and print. */
export const paper: Look = {
    name: 'paper', dark: false, background: '#f7f3ea', bloom: 0,
    colors: {
        bg: '#f7f3ea', surface: '#efe9db', ink: '#1d1b16', dim: '#5e5a50', faint: '#a29c8d',
        grid: '#e2dbca', gridStrong: '#c4bba6',
        blue: '#1f6fb2', teal: '#0d8577', green: '#3f8a35', yellow: '#b98500', gold: '#a8740a',
        orange: '#cf5d12', red: '#c62f2f', pink: '#c2387e', purple: '#6a4bc4',
    },
}

/** Drafting-table navy with cool cyan linework. */
export const blueprint: Look = {
    name: 'blueprint', dark: true, background: '#0b2340', bloom: 0.16,
    colors: {
        bg: '#0b2340', surface: '#123054', ink: '#eaf6ff', dim: '#9cc0dc', faint: '#5d86a8',
        grid: '#1a3f66', gridStrong: '#2c5f8e',
        blue: '#7fd4ff', teal: '#6fe6d6', green: '#9de8a4', yellow: '#ffe27a', gold: '#f5c566',
        orange: '#ffb27a', red: '#ff8d8d', pink: '#ffa8cf', purple: '#c5b4ff',
    },
}

/** Near-black green with warm chalk, for classroom-style lessons. */
export const chalk: Look = {
    name: 'chalk', dark: true, background: '#10201b', bloom: 0.1,
    colors: {
        bg: '#10201b', surface: '#172c25', ink: '#f4f1e4', dim: '#b1b9a9', faint: '#67786d',
        grid: '#20392f', gridStrong: '#355547',
        blue: '#8ccbe8', teal: '#7dd9c1', green: '#a9dc8f', yellow: '#f6dd7c', gold: '#e6bf62',
        orange: '#f2a874', red: '#ee8a80', pink: '#efa2c2', purple: '#bfa9e6',
    },
}

/** Saturated light on pure black, for trailers and hero loops. */
export const neon: Look = {
    name: 'neon', dark: true, background: '#050507', bloom: 0.4,
    colors: {
        bg: '#050507', surface: '#101016', ink: '#ffffff', dim: '#a9a9b8', faint: '#55555f',
        grid: '#1a1f2e', gridStrong: '#2f3a55',
        blue: '#3fb2ff', teal: '#21f0d0', green: '#6dff8e', yellow: '#fff04d', gold: '#ffc22e',
        orange: '#ff8a2e', red: '#ff4560', pink: '#ff5fb0', purple: '#a56bff',
    },
}

export const LOOKS = { midnight, paper, blueprint, chalk, neon } as const
export type LookName = keyof typeof LOOKS

export function resolveLook(look: LookName | Look | undefined): Look {
    if (look === undefined) return midnight
    if (typeof look !== 'string') return look
    const found = LOOKS[look]
    if (!found) throw new Error(`Unknown look: ${JSON.stringify(look)}. Use one of: ${Object.keys(LOOKS).join(', ')}.`)
    return found
}
