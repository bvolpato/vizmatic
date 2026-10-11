import type { SceneJsonValue, StructuredSceneControl } from './playground-data'

type CommitData = (prop: string, value: SceneJsonValue, group?: string) => string | undefined

function button(text: string, action: () => void): HTMLButtonElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.textContent = text
    element.addEventListener('click', action)
    return element
}

/** Builds plain form controls. Source parsing and shape validation remain in the lazy scene model. */
export function mountStructuredDataEditor(container: HTMLElement, controls: StructuredSceneControl[], commit: CommitData): void {
    container.replaceChildren()
    container.hidden = !controls.length
    for (const control of controls) {
        const section = document.createElement('section')
        section.className = 'explorer-data'
        const title = document.createElement('h4')
        title.textContent = control.label
        const error = document.createElement('p')
        error.className = 'explorer-data-error'
        error.setAttribute('role', 'status')
        error.setAttribute('aria-live', 'polite')
        const apply = (value: SceneJsonValue, group?: string) => {
            const message = commit(control.prop, value, group)
            error.textContent = message ?? ''
        }
        section.append(title)
        const data = control.value
        if (Array.isArray(data) && control.kind !== 'json' && data.length <= 200) {
            const rows = document.createElement('div')
            rows.className = 'explorer-data-rows'
            const fields = control.kind === 'values' ? ['label', 'value', 'color', 'valueLabel'] : ['x', 'y', 'label', 'color', 'size']
            data.forEach((item, index) => {
                const row = document.createElement('fieldset')
                row.className = 'explorer-data-row'
                const legend = document.createElement('legend')
                legend.textContent = `Row ${index + 1}`
                row.append(legend)
                const cells = document.createElement('div')
                cells.className = 'explorer-data-fields'
                const editableRow = control.kind === 'rows' ? Array.isArray(item) : item && typeof item === 'object' && !Array.isArray(item)
                if (editableRow) {
                    const rowFields = control.kind === 'rows' ? (item as SceneJsonValue[]).map((_, column) => String(column)) : fields
                    rowFields.forEach((field) => {
                        const value = (item as Record<string, SceneJsonValue>)[field]
                        if (control.kind === 'rows' && value !== null && typeof value === 'object') return
                        const label = document.createElement('label')
                        const caption = document.createElement('span')
                        caption.textContent = control.kind === 'rows' ? `Column ${Number(field) + 1}` : field === 'valueLabel' ? 'Display value' : field
                        const input = document.createElement('input')
                        const numeric = control.kind !== 'rows' ? ['value', 'x', 'y', 'size'].includes(field) : typeof value === 'number'
                        input.type = numeric ? 'number' : 'text'
                        if (numeric) input.step = 'any'
                        input.value = value === undefined || value === null ? '' : String(value)
                        input.setAttribute('aria-label', `${control.label} row ${index + 1} ${caption.textContent}`)
                        input.dataset.dataProp = control.prop
                        input.dataset.dataRow = String(index)
                        input.dataset.dataField = field
                        input.addEventListener('change', () => {
                            const next = structuredClone(data)
                            const nextRow = next[index] as Record<string, SceneJsonValue>
                            const optional = control.kind !== 'rows' && ['color', 'valueLabel', 'label', 'size'].includes(field) && !(control.kind === 'values' && field === 'label')
                            if (optional && input.value === '') delete nextRow[field]
                            else if (numeric) {
                                if (input.value === '' || !Number.isFinite(input.valueAsNumber)) { error.textContent = `${caption.textContent} must be a finite number.`; return }
                                nextRow[field] = input.valueAsNumber
                            } else if (control.kind === 'rows' && typeof value === 'boolean') {
                                if (!['true', 'false'].includes(input.value)) { error.textContent = 'Boolean cells must be true or false.'; return }
                                nextRow[field] = input.value === 'true'
                            } else nextRow[field] = input.value
                            apply(next, `data:${control.prop}:${index}:${field}`)
                        })
                        label.append(caption, input)
                        cells.append(label)
                    })
                }
                const remove = button('Remove row', () => apply(data.filter((_, at) => at !== index)))
                remove.setAttribute('aria-label', `Remove ${control.label.toLowerCase()} row ${index + 1}`)
                row.append(cells, remove)
                rows.append(row)
            })
            const actions = document.createElement('div')
            actions.className = 'explorer-data-actions'
            const add = button('Add row', () => {
                const item: SceneJsonValue = control.kind === 'values' ? { label: `Item ${data.length + 1}`, value: 1 }
                    : control.kind === 'points' ? { x: 0, y: 0, label: `Point ${data.length + 1}` }
                        : Array.from({ length: Math.max(1, Array.isArray(data[0]) ? data[0].length : 2) }, () => '')
                apply([...data, item])
            })
            add.disabled = data.length >= 200
            add.setAttribute('aria-label', `Add ${control.label.toLowerCase()} row`)
            actions.append(add)
            if (control.kind === 'rows') actions.append(button('Add column', () => apply(data.length ? data.map((row) => [...row as SceneJsonValue[], '']) : [['']])))
            section.append(rows, actions)
        }
        const details = document.createElement('details')
        details.className = 'explorer-data-json'
        details.open = control.kind === 'json'
        const summary = document.createElement('summary')
        summary.textContent = 'Edit JSON data'
        const textarea = document.createElement('textarea')
        textarea.rows = control.kind === 'json' ? 8 : 5
        textarea.spellcheck = false
        textarea.value = JSON.stringify(data, null, 2)
        textarea.setAttribute('aria-label', `${control.label} JSON data`)
        textarea.dataset.dataJson = control.prop
        const applyJson = button('Apply JSON', () => {
            try { apply(JSON.parse(textarea.value) as SceneJsonValue) }
            catch (cause) { error.textContent = `Enter valid JSON. ${cause instanceof Error ? cause.message : ''}` }
        })
        details.append(summary, textarea, applyJson)
        section.append(details, error)
        container.append(section)
    }
}
