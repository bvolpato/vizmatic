import { applyComponentControls, type ComponentControl } from './component-controls'

interface ExplorerComponent {
    name: string
    description: string
    example: string
    controls?: ComponentControl[]
    category: string
}

interface ExplorerApi {
    getSource(): string
    loadSource(source: string, immediate?: boolean): void
}

export interface ComponentExplorerController {
    sourceChanged(): void
}

let catalogRequest: Promise<ExplorerComponent[]> | undefined

function loadCatalog(): Promise<ExplorerComponent[]> {
    catalogRequest ??= fetch(new URL('components.json', document.baseURI))
        .then(async (response) => {
            if (!response.ok) throw new Error(`Could not load components (${response.status}).`)
            const catalog = await response.json() as { categories: Array<{ label: string; components: Omit<ExplorerComponent, 'category'>[] }> }
            return catalog.categories.flatMap((category) => category.components.map((component) => ({ ...component, category: category.label })))
        }).catch((error) => {
            catalogRequest = undefined
            throw error
        })
    return catalogRequest
}

export function mountComponentExplorer(root: HTMLElement, api: ExplorerApi): ComponentExplorerController | undefined {
    if (!root.hasAttribute('data-component-explorer')) return
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
    const search = find<HTMLInputElement>('#componentExplorerSearch')
    const select = find<HTMLSelectElement>('#componentExplorerSelect')
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-explore-component]')]
    const title = find<HTMLElement>('#explorerTitle')
    const category = find<HTMLElement>('#explorerCategory')
    const description = find<HTMLElement>('#explorerDescription')
    const controls = find<HTMLElement>('#explorerControls')
    const note = find<HTMLElement>('#explorerControlsNote')
    const reset = find<HTMLButtonElement>('#explorerReset')
    let selected: ExplorerComponent | undefined
    let currentSource = ''
    let selectionId = 0
    let values: Record<string, string | number | boolean> = {}
    const hasSharedSource = location.hash.startsWith('#vizmatic-playground=') || new URLSearchParams(location.search).has('example')

    function componentFromHash(): string | undefined {
        if (!location.hash.startsWith('#component-')) return
        try { return decodeURIComponent(location.hash.slice('#component-'.length)) } catch { return }
    }

    function sourceChanged() {
        const edited = api.getSource() !== currentSource
        controls.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach((input) => { input.disabled = edited })
        if (!selected) {
            select.value = 'custom'
            title.textContent = 'Your scene'
            category.textContent = 'Editable TSX'
            description.textContent = 'Choose a component to explore its settings, or open the source and build on this scene.'
            note.textContent = 'Open the TSX below to edit this scene.'
            reset.disabled = true
        } else if (edited) {
            select.value = 'custom'
            choices.forEach((button) => button.setAttribute('aria-pressed', 'false'))
            title.textContent = 'Your edited scene'
            category.textContent = 'Custom TSX'
            description.textContent = `Started from ${selected.name}. Keep editing the scene, or reset to explore its settings.`
            note.textContent = 'You changed the scene. Reset the example to use its visual controls again.'
        } else {
            const name = selected.name
            select.value = name
            choices.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.exploreComponent === name)))
            title.textContent = name
            category.textContent = selected.category
            description.textContent = selected.description
            note.textContent = selected.controls?.length
                ? `Controls change the first ${selected.name} in this scene. Open the TSX to edit the rest.`
                : 'This component uses structured data. Open the TSX below to change its content and layout.'
        }
    }

    function renderControls(component: ExplorerComponent) {
        controls.replaceChildren()
        const controlNote = `Controls change the first ${component.name} in this scene. Open the TSX to edit the rest.`
        values = Object.fromEntries((component.controls ?? []).map((control) => [control.prop, control.value]))
        for (const control of component.controls ?? []) {
            const label = document.createElement('label')
            label.className = `explorer-control explorer-control-${control.type}`
            const caption = document.createElement('span')
            caption.textContent = control.label
            let input: HTMLInputElement | HTMLSelectElement
            if (control.type === 'select') {
                input = document.createElement('select')
                for (const value of control.options ?? []) {
                    const option = document.createElement('option')
                    option.value = value
                    option.textContent = value
                    input.append(option)
                }
                input.value = String(control.value)
            } else {
                input = document.createElement('input')
                input.type = control.type === 'boolean' ? 'checkbox' : control.type === 'number' ? 'range' : 'text'
                if (control.type === 'boolean') input.checked = Boolean(control.value)
                if (control.type === 'number') {
                    if (control.min !== undefined) input.min = String(control.min)
                    if (control.max !== undefined) input.max = String(control.max)
                    if (control.step !== undefined) input.step = String(control.step)
                }
                if (control.type !== 'boolean') input.value = String(control.value)
            }
            input.dataset.controlProp = control.prop
            input.setAttribute('aria-label', control.label)
            const output = document.createElement('output')
            output.textContent = String(control.value)
            if (control.type === 'number') caption.append(' ', output)
            label.append(caption, input)
            input.addEventListener('input', () => {
                const value = control.type === 'boolean' ? (input as HTMLInputElement).checked
                    : control.type === 'number' ? (input as HTMLInputElement).valueAsNumber : input.value
                try {
                    values[control.prop] = value
                    const source = applyComponentControls(component.example, component.controls ?? [], values)
                    currentSource = source
                    output.textContent = String(value)
                    note.textContent = controlNote
                    api.loadSource(source, false)
                } catch (error) {
                    note.textContent = error instanceof Error ? error.message : 'Check this setting.'
                }
            })
            controls.append(label)
        }
        note.textContent = component.controls?.length ? controlNote : 'This component uses structured data. Open the TSX below to change its content and layout.'
    }

    async function choose(name: string, updateUrl = true) {
        const id = ++selectionId
        try {
            const component = (await loadCatalog()).find((entry) => entry.name === name)
            if (!component || id !== selectionId) return
            selected = component
            currentSource = component.example
            title.textContent = component.name
            category.textContent = component.category
            description.textContent = component.description
            select.value = component.name
            reset.disabled = false
            choices.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.exploreComponent === component.name)))
            const active = choices.find((button) => button.dataset.exploreComponent === component.name)!
            const list = find<HTMLElement>('.explorer-choices')
            if (list.getClientRects().length && !active.hidden) {
                const offset = active.getBoundingClientRect().top - list.getBoundingClientRect().top
                if (offset < 0 || offset > list.clientHeight - active.clientHeight) list.scrollTop += offset - 80
            }
            renderControls(component)
            api.loadSource(component.example)
            if (updateUrl) {
                const url = new URL(location.href)
                url.searchParams.delete('example')
                url.hash = 'component-' + component.name
                history.replaceState(null, '', url)
            }
        } catch (error) {
            note.textContent = `${error instanceof Error ? error.message : 'Could not load components.'} Choose a component to retry.`
            find<HTMLElement>('#playgroundStatus').textContent = 'Component loading failed'
        }
    }

    choices.forEach((button) => button.addEventListener('click', () => { void choose(button.dataset.exploreComponent!) }))
    select.addEventListener('change', () => { void choose(select.value) })
    reset.addEventListener('click', () => { void choose(selected?.name ?? 'GraphDiagram') })
    search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase()
        choices.forEach((button) => { button.hidden = !button.dataset.explorerSearch?.includes(query) })
        root.querySelectorAll<HTMLElement>('[data-explorer-category]').forEach((group) => {
            group.hidden = !group.querySelector('[data-explore-component]:not([hidden])')
        })
        find<HTMLElement>('.explorer-empty').hidden = choices.some((button) => !button.hidden)
    })
    root.querySelector('.explorer-choices')?.addEventListener('keydown', (event) => {
        if (!(event instanceof KeyboardEvent) || !['ArrowDown', 'ArrowUp'].includes(event.key)) return
        const visible = choices.filter((button) => !button.hidden)
        const index = visible.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
    })
    window.addEventListener('hashchange', () => {
        const name = componentFromHash()
        if (name && choices.some((button) => button.dataset.exploreComponent === name)) void choose(name, false)
    })
    if (hasSharedSource) sourceChanged()
    else {
        const name = componentFromHash() ?? 'GraphDiagram'
        void choose(choices.some((button) => button.dataset.exploreComponent === name) ? name : 'GraphDiagram', false)
    }
    return { sourceChanged }
}
