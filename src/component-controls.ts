export type ComponentControlType = 'text' | 'number' | 'boolean' | 'select'
export type ComponentControlValue = string | number | boolean

export interface ComponentControl {
    prop: string
    label: string
    type: ComponentControlType
    value: ComponentControlValue
    options?: string[]
    min?: number
    max?: number
    step?: number
    start: number
    end: number
}

export type ComponentControlValues = Record<string, ComponentControlValue>

function invalidValue(control: ComponentControl): never {
    throw new Error(`Invalid value for ${control.prop}.`)
}

function validateValue(control: ComponentControl, value: ComponentControlValue): void {
    if (control.type === 'text') {
        if (typeof value !== 'string') invalidValue(control)
        return
    }
    if (control.type === 'boolean') {
        if (typeof value !== 'boolean') invalidValue(control)
        return
    }
    if (control.type === 'select') {
        if (typeof value !== 'string' || !control.options?.includes(value)) invalidValue(control)
        return
    }

    if (typeof value !== 'number' || !Number.isFinite(value)
        || control.min !== undefined && value < control.min
        || control.max !== undefined && value > control.max) {
        invalidValue(control)
    }
    if (control.step !== undefined && control.min !== undefined) {
        const steps = (value - control.min) / control.step
        if (Math.abs(steps - Math.round(steps)) > 1e-8) invalidValue(control)
    }
}

/** Applies edited scalar values only to the attribute spans discovered at build time. */
export function applyComponentControls(
    source: string,
    controls: readonly ComponentControl[],
    values: ComponentControlValues,
): string {
    const byProp = new Map(controls.map((control) => [control.prop, control]))
    for (const prop of Object.keys(values)) {
        if (!byProp.has(prop)) throw new Error(`Unknown component control ${prop}.`)
    }

    const replacements: Array<{ start: number; end: number; text: string }> = []
    for (const [prop, value] of Object.entries(values)) {
        const control = byProp.get(prop)
        if (!control) continue
        validateValue(control, value)
        if (!Number.isInteger(control.start) || !Number.isInteger(control.end)
            || control.start < 0 || control.end <= control.start || control.end > source.length) {
            throw new Error(`Invalid source span for ${control.prop}.`)
        }

        const originalAttribute = source.slice(control.start, control.end)
        if (!new RegExp(`^${control.prop}(?:\\s|=|$)`).test(originalAttribute)) {
            throw new Error(`Source changed since ${control.prop} controls were generated.`)
        }
        replacements.push({
            start: control.start,
            end: control.end,
            text: `${control.prop}={${JSON.stringify(value)}}`,
        })
    }

    replacements.sort((left, right) => right.start - left.start)
    let result = source
    let lastStart = source.length
    for (const replacement of replacements) {
        if (replacement.end > lastStart) throw new Error('Component control spans overlap.')
        result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end)
        lastStart = replacement.start
    }
    return result
}
