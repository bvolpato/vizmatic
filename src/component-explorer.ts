import type { ComponentControl } from './component-controls'
import type { SceneSnapshot, SceneInstance } from './playground-scene'
import { mountStructuredDataEditor } from './playground-data-editor'
type SceneModel = typeof import('./playground-scene')

interface ExplorerComponent {
    name: string
    description: string
    example: string
    category: string
}

interface ExplorerApi {
    getSource(): string
    loadSource(source: string, immediate?: boolean, options?: { history?: boolean; group?: string }): void
    preserveSource?: boolean
}

export interface ComponentExplorerController {
    sourceChanged(): void
    selectText(start: number, end: number): void
    getSelectedInstance(): SceneInstance | undefined
    selectInstanceByStart(start: number): void
    setInstanceProps(start: number, values: Record<string, string | number | boolean>, group?: string): boolean
}

let sceneRequest: Promise<SceneModel> | undefined
function loadSceneModel(): Promise<SceneModel> {
    sceneRequest ??= import(new URL('playground-scene.js', document.baseURI).href).catch((error) => { sceneRequest = undefined; throw error })
    return sceneRequest
}

let catalogRequest: Promise<ExplorerComponent[]> | undefined

function loadCatalog(): Promise<ExplorerComponent[]> {
    catalogRequest ??= fetch(new URL('components.json', document.baseURI))
        .then(async (response) => {
            if (!response.ok) throw new Error(`Could not load components (${response.status}).`)
            const catalog = await response.json() as { categories: Array<{ label: string; components: Omit<ExplorerComponent, 'category'>[] }> }
            return catalog.categories.flatMap((category) => category.components.map((component) => ({ ...component, category: category.label })))
        }).catch((error) => { catalogRequest = undefined; throw error })
    return catalogRequest
}

export function mountComponentExplorer(root: HTMLElement, api: ExplorerApi): ComponentExplorerController | undefined {
    if (!root.hasAttribute('data-component-explorer')) return
    const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!
    const search = find<HTMLInputElement>('#componentExplorerSearch')
    const select = find<HTMLSelectElement>('#componentExplorerSelect')
    const instanceSelect = find<HTMLSelectElement>('#explorerInstance')
    const insertSelect = find<HTMLSelectElement>('#explorerInsert')
    insertSelect?.querySelector('option[value="custom"]')?.remove()
    const choices = [...root.querySelectorAll<HTMLButtonElement>('[data-explore-component]')]
    const title = find<HTMLElement>('#explorerTitle')
    const category = find<HTMLElement>('#explorerCategory')
    const description = find<HTMLElement>('#explorerDescription')
    const controls = find<HTMLElement>('#explorerControls')
    let dataControls = find<HTMLElement>('#explorerDataControls')
    if (!dataControls) {
        dataControls = document.createElement('div')
        dataControls.id = 'explorerDataControls'
        controls.after(dataControls)
    }
    const note = find<HTMLElement>('#explorerControlsNote')
    const reset = find<HTMLButtonElement>('#explorerReset')
    const add = find<HTMLButtonElement>('#explorerAdd')
    const duplicate = find<HTMLButtonElement>('#explorerDuplicate')
    const remove = find<HTMLButtonElement>('#explorerRemove')
    const moveUp = find<HTMLButtonElement>('#explorerMoveUp')
    const moveDown = find<HTMLButtonElement>('#explorerMoveDown')
    let model: SceneModel | undefined
    let catalog: ExplorerComponent[] = []
    let selectedExample: ExplorerComponent | undefined
    let snapshot: SceneSnapshot | undefined
    let selectedIndex = 0
    let selectionId = 0
    let changingControl = false
    let activeControls: ComponentControl[] = []

    function componentFromHash(): string | undefined {
        if (!location.hash.startsWith('#component-')) return
        try { return decodeURIComponent(location.hash.slice('#component-'.length)) } catch { return }
    }

    function selectedInstance(): SceneInstance | undefined { return snapshot?.instances[selectedIndex] }
    function selectedStructuralInstance(): SceneInstance | undefined {
        const selected = selectedInstance()
        return selected && snapshot && model ? model.sceneStructuralTarget(snapshot.source, snapshot, selected.id) : selected
    }

    function renderControls(instance: SceneInstance | undefined) {
        const next = instance?.controls ?? []
        if (changingControl && next.length === activeControls.length
            && next.every((control, index) => control.prop === activeControls[index].prop)) {
            activeControls = next
            return
        }
        activeControls = next
        controls.replaceChildren()
        for (const control of next) {
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
                const current = selectedInstance()
                if (!snapshot || !current) return
                const value = control.type === 'boolean' ? (input as HTMLInputElement).checked
                    : control.type === 'number' ? (input as HTMLInputElement).valueAsNumber : input.value
                try {
                    const source = model!.updateSceneControls(api.getSource(), snapshot, current.id, { [control.prop]: value })
                    changingControl = true
                    output.textContent = String(value)
                    api.loadSource(source, false, { group: `control:${selectedIndex}:${control.prop}` })
                } catch (error) { note.textContent = error instanceof Error ? error.message : 'Check this setting.' }
                finally { changingControl = false }
            })
            controls.append(label)
        }
    }

    function sourceChanged() {
        if (!model) return
        const source = api.getSource()
        try {
            snapshot = model!.analyzeScene(source)
            selectedIndex = Math.min(selectedIndex, snapshot.instances.length - 1)
        } catch {
            snapshot = undefined
            note.textContent = 'Finish the TSX syntax to use the element inspector. Your source is still editable.'
        }
        const instance = selectedInstance()
        if (instanceSelect) {
            const counts = new Map<string, number>()
            instanceSelect.replaceChildren(...(snapshot?.instances ?? []).map((entry, index) => {
                const option = document.createElement('option')
                const count = (counts.get(entry.name) ?? 0) + 1
                counts.set(entry.name, count)
                option.value = String(index)
                option.textContent = `${'\u00a0'.repeat(Math.min(entry.depth, 5) * 2)}${entry.name || 'Fragment'} ${count}`
                return option
            }))
            instanceSelect.value = String(selectedIndex)
            instanceSelect.disabled = !instance
        }
        const structural = selectedStructuralInstance()
        if (duplicate) duplicate.disabled = !structural?.canDuplicate
        if (remove) remove.disabled = !structural?.canRemove
        if (moveUp) moveUp.disabled = !structural?.canMoveUp
        if (moveDown) moveDown.disabled = !structural?.canMoveDown
        if (add) add.disabled = !snapshot || !catalog.length
        renderControls(instance)
        mountStructuredDataEditor(dataControls, instance?.structuredControls ?? [], (prop, value, group) => {
            const current = selectedInstance()
            if (!snapshot || !current || !model) return 'Refresh the scene before editing its data.'
            try {
                const source = model.updateStructuredSceneProp(api.getSource(), snapshot, current.id, prop, value)
                api.loadSource(source, false, { group })
                sourceChanged()
            } catch (error) { return error instanceof Error ? error.message : 'Check this data.' }
        })
        if (snapshot) note.textContent = instance && (instance.controls.length || instance.structuredControls.length)
            ? `Settings edit the selected ${instance.name}. Computed values stay in the TSX.`
            : 'Select a component with literal settings or data to edit it here. Computed values stay in the TSX.'
        const example = selectedExample
        const edited = !example || source !== example.example
        if (edited && example && location.hash === `#component-${example.name}`) {
            const url = new URL(location.href)
            url.hash = ''
            history.replaceState(null, '', url)
        }
        select.value = !edited && example ? example.name : 'custom'
        choices.forEach((button) => button.setAttribute('aria-pressed', String(!edited && button.dataset.exploreComponent === selectedExample?.name)))
        title.textContent = !edited && example ? example.name : 'Your scene'
        category.textContent = !edited && example ? example.category : 'Editable TSX'
        description.textContent = !edited && example ? example.description : 'Select an element to change its settings, or add another component.'
        reset.disabled = !selectedExample
        root.dispatchEvent(new CustomEvent('vizmatic-builder-selection', { detail: { start: instance?.start, name: instance?.name } }))
    }

    async function choose(name: string, updateUrl = true, initial = false) {
        const id = ++selectionId
        try {
            [catalog, model] = await Promise.all([loadCatalog(), loadSceneModel()])
            const component = catalog.find((entry) => entry.name === name)
            if (!component || id !== selectionId) return
            selectedExample = component
            const scene = model!.analyzeScene(component.example)
            selectedIndex = Math.max(0, scene.instances.findIndex((entry) => entry.name === name))
            if (insertSelect) insertSelect.value = name
            if (updateUrl) {
                const url = new URL(location.href)
                url.searchParams.delete('example')
                url.hash = 'component-' + name
                history.replaceState(null, '', url)
            }
            api.loadSource(component.example, true, { history: !initial })
            sourceChanged()
        } catch (error) {
            note.textContent = `${error instanceof Error ? error.message : 'Could not load components.'} Choose a component to retry.`
        }
    }

    function mutate(operation: (source: string, scene: SceneSnapshot, instance: SceneInstance) => string, nextIndex = selectedIndex) {
        const instance = selectedInstance()
        if (!snapshot || !instance) return
        try {
            const source = operation(api.getSource(), snapshot, instance)
            selectedIndex = Math.max(0, nextIndex)
            api.loadSource(source)
            sourceChanged()
        } catch (error) { note.textContent = error instanceof Error ? error.message : 'Could not change this element.' }
    }

    instanceSelect?.addEventListener('change', () => { selectedIndex = Number(instanceSelect.value); sourceChanged() })
    function subtreeSize(instance: SceneInstance): number {
        return snapshot?.instances.filter((entry) => entry.start >= instance.start && entry.end <= instance.end).length ?? 1
    }
    duplicate?.addEventListener('click', () => {
        const instance = selectedStructuralInstance()
        if (instance && snapshot) mutate((source, scene, entry) => model!.duplicateSceneInstance(source, scene, entry.id), snapshot.instances.indexOf(instance) + subtreeSize(instance))
    })
    remove?.addEventListener('click', () => {
        const instance = selectedStructuralInstance()
        if (instance && snapshot) mutate((source, scene, entry) => model!.removeSceneInstance(source, scene, entry.id), snapshot.instances.indexOf(instance))
    })
    function move(direction: 'up' | 'down') {
        const instance = selectedStructuralInstance()
        if (!snapshot || !instance) return
        const siblings = snapshot.instances.filter((entry) => entry.parentID === instance.parentID && !entry.unsafeReason)
        const sibling = siblings[siblings.indexOf(instance) + (direction === 'up' ? -1 : 1)]
        if (!sibling) return
        const index = direction === 'up' ? snapshot.instances.indexOf(sibling) : snapshot.instances.indexOf(instance) + subtreeSize(sibling)
        mutate((source, scene, entry) => model!.moveSceneInstance(source, scene, entry.id, direction), index)
    }
    moveUp?.addEventListener('click', () => move('up'))
    moveDown?.addEventListener('click', () => move('down'))
    add?.addEventListener('click', () => {
        if (!snapshot) return
        const component = catalog.find((entry) => entry.name === insertSelect.value)
        if (!component) return
        try {
            const selected = selectedInstance()
            const targetID = selected && ['Scene', 'Canvas', 'Board', 'Row', 'Column', 'Stack', 'Fragment', ''].includes(selected.name) ? selected.id : undefined
            const source = model!.appendSceneComponent(api.getSource(), snapshot, component.example, component.name, targetID)
            const scene = model!.analyzeScene(source)
            scene.instances.forEach((entry, index) => { if (entry.name === component.name) selectedIndex = index })
            api.loadSource(source)
            sourceChanged()
        } catch (error) { note.textContent = error instanceof Error ? error.message : 'Could not add this component.' }
    })
    choices.forEach((button) => button.addEventListener('click', () => { void choose(button.dataset.exploreComponent!) }))
    select.addEventListener('change', () => { if (select.value !== 'custom') void choose(select.value) })
    reset.addEventListener('click', () => { if (selectedExample) void choose(selectedExample.name) })
    search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase()
        choices.forEach((button) => { button.hidden = !button.dataset.explorerSearch?.includes(query) })
        root.querySelectorAll<HTMLElement>('[data-explorer-category]').forEach((group) => { group.hidden = !group.querySelector('[data-explore-component]:not([hidden])') })
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
    if (api.preserveSource) {
        sourceChanged()
        void Promise.all([loadCatalog(), loadSceneModel()]).then(([entries, sceneModel]) => { catalog = entries; model = sceneModel; sourceChanged() }).catch((error) => { note.textContent = String(error) })
    } else {
        const name = componentFromHash() ?? 'GraphDiagram'
        void choose(choices.some((button) => button.dataset.exploreComponent === name) ? name : 'GraphDiagram', false, true)
    }
    return { sourceChanged, getSelectedInstance: selectedInstance, selectInstanceByStart(start) {
        const index = snapshot?.instances.findIndex((entry) => entry.start === start) ?? -1
        if (index >= 0 && selectedIndex !== index) { selectedIndex = index; sourceChanged() }
    }, setInstanceProps(start, values, group) {
        const instance = snapshot?.instances.find((entry) => entry.start === start)
        if (!snapshot || !instance || !model) return false
        try {
            const source = model.setSceneLiteralProps(api.getSource(), snapshot, instance.id, values)
            api.loadSource(source, false, { group })
            sourceChanged()
            return true
        } catch (error) {
            note.textContent = error instanceof Error ? error.message : 'Could not edit this component.'
            return false
        }
    }, selectText(start, end) {
        if (!snapshot) return
        let index = -1
        snapshot.instances.forEach((entry, candidate) => { if (entry.start <= start && entry.end >= end) index = candidate })
        if (index >= 0 && selectedIndex !== index) { selectedIndex = index; sourceChanged() }
    } }
}
