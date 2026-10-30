import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { createAnimation as createAllGather } from '../examples/nccl-all-gather'
import { createAnimation as createAllReduce } from '../examples/nccl-all-reduce'
import { createAnimation as createReduceScatter } from '../examples/nccl-reduce-scatter'

type RenderProps = { style?: { opacity?: number }; children?: ReactNode }
type TextLeaf = { text: string; opacity: number }

function renderedTextLeaves(node: ReactNode, ancestorOpacity = 1): TextLeaf[] {
    if (Array.isArray(node)) {
        const leaves: TextLeaf[] = []
        let text = ''
        const flushText = () => {
            if (!text) return
            leaves.push({ text, opacity: ancestorOpacity })
            text = ''
        }

        for (const child of node) {
            if (typeof child === 'string' || typeof child === 'number') {
                text += String(child)
            } else {
                flushText()
                leaves.push(...renderedTextLeaves(child, ancestorOpacity))
            }
        }
        flushText()
        return leaves
    }
    if (typeof node === 'string' || typeof node === 'number') return [{ text: String(node), opacity: ancestorOpacity }]
    if (!isValidElement(node)) return []

    const element = node as ReactElement<RenderProps>
    if (typeof element.type === 'function') {
        const component = element.type as (props: never) => ReactNode
        return renderedTextLeaves(component(element.props as never), ancestorOpacity)
    }

    const opacity = ancestorOpacity * Number(element.props.style?.opacity ?? 1)
    return renderedTextLeaves(element.props.children, opacity)
}

function textCount(view: ReactNode, text: string, isVisible: (opacity: number) => boolean): number {
    return renderedTextLeaves(view).filter((leaf) => leaf.text === text && isVisible(leaf.opacity)).length
}

const fullyOpaque = (opacity: number) => opacity === 1
const visible = (opacity: number) => opacity > 0
const frame = { index: 0, count: 1, time: 0, duration: 1, delay: 1, progress: 0, step: 0, stepProgress: 0, fps: 20 }

describe('NCCL collective completion visibility', () => {
    it('shows only rank-owned shards before AllGather completes, then shows all replicas', () => {
        const animation = createAllGather('dark')
        const beforeCompletion = animation.render({ progress: 0.49, opacity: 1 }, frame)
        const complete = animation.render({ progress: 1, opacity: 1 }, frame)

        for (const label of ['A', 'B', 'C', 'D']) {
            expect(textCount(beforeCompletion, label, fullyOpaque)).toBe(1)
            expect(textCount(beforeCompletion, label, visible)).toBe(1)
            expect(textCount(complete, label, fullyOpaque)).toBe(4)
            expect(textCount(complete, label, visible)).toBe(4)
        }
    })

    it('keeps the AllReduce sum hidden until reduction completes', () => {
        const animation = createAllReduce('dark')
        const beforeCompletion = animation.render({ progress: 0.49, opacity: 1 }, frame)
        const complete = animation.render({ progress: 1, opacity: 1 }, frame)

        for (const input of ['1', '2', '3', '4']) {
            expect(textCount(beforeCompletion, input, fullyOpaque)).toBe(1)
        }
        expect(textCount(beforeCompletion, '10', visible)).toBe(0)
        expect(textCount(complete, '10', fullyOpaque)).toBe(4)
        expect(textCount(complete, '10', visible)).toBe(4)
    })

    it('keeps ReduceScatter results hidden until reduction completes', () => {
        const animation = createReduceScatter('dark')
        const beforeCompletion = animation.render({ progress: 0.63, opacity: 1 }, frame)
        const complete = animation.render({ progress: 1, opacity: 1 }, frame)

        for (let source = 0; source < 4; source++) {
            for (let destination = 0; destination < 4; destination++) {
                expect(textCount(beforeCompletion, `${source}:${destination}`, fullyOpaque)).toBe(1)
            }
        }
        for (let destination = 0; destination < 4; destination++) {
            const result = `R${destination}`
            // One owner marker is always visible; the result token adds a second copy when complete.
            expect(textCount(beforeCompletion, result, visible)).toBe(1)
            expect(textCount(complete, result, fullyOpaque)).toBe(2)
            expect(textCount(complete, result, visible)).toBe(2)
        }
    })
})
