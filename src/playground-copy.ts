import type { SceneInstance, SceneSnapshot } from './playground-scene'

/**
 * Builds a standalone bare-frame snippet for the selected builder block.
 * Setup and frame metadata stay in place so references used by a copied block
 * continue to resolve when pasted into the playground or a Vizmatic document.
 */
export function copySceneBlock(snapshot: SceneSnapshot, instanceId: string): string | undefined {
    try {
        const selected = snapshot.instances.find((instance) => instance.id === instanceId)
        const root = snapshot.instances.find((instance) => instance.id === snapshot.rootID)
        if (!selected || !root || selected.unsafeReason) return undefined

        // Copying the root is equivalent to Copy source and preserves every byte,
        // including comments and syntax outside the JSX element.
        if (selected.id === root.id) return snapshot.source

        const target = copyTarget(snapshot, selected)
        if (target.unsafeReason) return undefined

        let block = snapshot.source.slice(target.start, target.end)
        if (target.name === 'CanvasItem') {
            const board = nearestBoard(snapshot, target)
            if (!board || board.unsafeReason || board.closingStart == null) return undefined

            // CanvasItem coordinates and dimensions are relative to a Board.
            // Keep the selected item in its original coordinate space and copy
            // the original Board props, including dimensions, palette and fill.
            const opening = snapshot.source.slice(board.start, board.openingEnd)
            const closing = snapshot.source.slice(board.closingStart, board.end)
            block = `${opening}\n  ${block}\n${closing}`
        }

        // Replace only the root JSX. This retains the original metadata,
        // comments, setup declarations and trailing syntax without evaluating
        // or trying to infer dependencies from user code.
        return snapshot.source.slice(0, root.start) + block + snapshot.source.slice(root.end)
    } catch {
        // Invalid, stale or expression-generated selections are source-only.
        return undefined
    }
}

function copyTarget(snapshot: SceneSnapshot, selected: SceneInstance): SceneInstance {
    let instance: SceneInstance | undefined = selected
    while (instance) {
        const parent = snapshot.instances.find((entry) => entry.id === instance!.parentID)
        if (instance.name === 'CanvasItem' && parent?.name === 'Board') return instance
        instance = parent
    }
    return selected
}

function nearestBoard(snapshot: SceneSnapshot, item: SceneInstance): SceneInstance | undefined {
    let parentID = item.parentID
    while (parentID) {
        const parent = snapshot.instances.find((instance) => instance.id === parentID)
        if (!parent) return undefined
        if (parent.name === 'Board') return parent
        parentID = parent.parentID
    }
    return undefined
}
