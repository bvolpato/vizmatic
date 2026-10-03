import React from 'react'
import { describe, expect, it } from 'vitest'
import { transform } from 'sucrase'
import { getThemeColors } from '../src/theme'
import { createPlaygroundApi } from '../src/playground-api'
import { preparePlaygroundSource } from '../src/playground-source'
import { mapPlaygroundText, prepareEditableText, editableTextTargets } from '../src/playground-text-mapping'

function prepare(source: string) {
    const mapping = mapPlaygroundText(source)
    const prepared = preparePlaygroundSource(mapping.source)
    const c = getThemeColors('dark')
    const api = createPlaygroundApi(c)
    const wrapped = transform(`const render = () => {\n${prepared.setup}\nreturn (${prepared.jsx});\n};`, { transforms: ['typescript', 'jsx'], production: true }).code
    const element = Function('React', 'c', ...Object.keys(api), `${wrapped}\nreturn render();`)(React, c, ...Object.values(api)) as React.ReactNode
    return { mapping, ...prepareEditableText(element, mapping) }
}

describe('playground direct text mapping', () => {
    it('keeps repeated labels in separate components tied to their own source spans', () => {
        const source = `width = 960\nheight = 480\n<Scene title="Overview"><Row><MetricCard label="Count" value="12"/><MetricCard label="Count" value="24"/></Row></Scene>`
        const { references } = prepare(source)
        const labels = [...references.values()].filter((reference) => reference.value === 'Count')
        expect(labels).toHaveLength(2)
        expect(labels[0].start).not.toBe(labels[1].start)
        expect(labels.every((reference) => source.slice(reference.start, reference.end) === reference.original)).toBe(true)
    })

    it('maps structured labels and skips ambiguous duplicates or computed expressions', () => {
        const source = `<GraphDiagram width={700} height={300} nodes={[{ id: 'a', label: 'API' }, { id: 'b', label: 'Same' }, { id: 'c', label: 'Same' }, { id: 'd', label: 'Agent' + ' result' }]} edges={[]}/>`
        const { references } = prepare(source)
        const values = [...references.values()].map((reference) => reference.value)
        expect(values).toContain('API')
        expect(values).not.toContain('Same')
        expect(values).not.toContain('Agent result')
    })

    it('preserves source offsets through metadata, JSX entities and escaped literal text', () => {
        const source = `width = 960\r\nheight = 480\r\n<Scene title="A &amp; B"><TextLabel text={'Say \\'hello\\' \\u03bb'}/><div>Use &lt;TSX&gt;</div></Scene>`
        const { references } = prepare(source)
        const values = [...references.values()]
        expect(values.map((reference) => reference.value)).toEqual(expect.arrayContaining(['A & B', "Say 'hello' λ", 'Use <TSX>']))
        expect(values.every((reference) => source.slice(reference.start, reference.end) === reference.original)).toBe(true)
        expect(values.find((reference) => reference.value === 'Use <TSX>')?.kind).toBe('jsx-text')
    })

    it('uses only keyed renderer geometry for edit targets', () => {
        const { references } = prepare('<MetricCard label="Count" value="12"/>')
        const [key, reference] = [...references][0]
        const targets = editableTextTargets([
            { key, type: 'div', left: 30, top: 40, width: 120, height: 20, props: { style: { fontSize: 18, color: '#fff' } } },
            { key: 'unrelated', type: 'div', left: 0, top: 0, width: 30, height: 20, props: {} },
        ], references)
        expect(targets).toEqual([{ ...reference, left: 30, top: 40, width: 120, height: 20, fontSize: 18, color: '#fff' }])
    })

    it('supports export-default roots and literal text inside fragments', () => {
        const { references } = prepare('width = 400\nexport default (<Scene title="Example"><div><>Fragment text</></div></Scene>);')
        expect([...references.values()].map((reference) => reference.value)).toEqual(expect.arrayContaining(['Example', 'Fragment text']))
    })

    it('does not attach computed labels to unused literals or another rendered field', () => {
        const source = `const unused = { label: 'Ready' };\nconst computed = ['Re', 'ady'].join('');\n<Scene title="Example"><MetricCard label="Ready" value={computed}/><TextLabel text={computed}/></Scene>`
        const { references } = prepare(source)
        expect([...references.values()].map((reference) => reference.value)).not.toContain('Ready')
    })

    it('removes editing annotations from native SVG and host props', () => {
        const { element } = prepare('<Scene title="Example"><GraphDiagram nodes={[{id:"a",label:"API"}]} edges={[]}/></Scene>')
        let svgCount = 0
        const visit = (node: React.ReactNode) => {
            if (Array.isArray(node)) { node.forEach(visit); return }
            if (!React.isValidElement<Record<string, unknown>>(node)) return
            if (node.type === 'svg') svgCount += 1
            expect(node.props).not.toHaveProperty('__vizmaticTextScope')
            visit(node.props.children as React.ReactNode)
        }
        visit(element)
        expect(svgCount).toBeGreaterThan(0)
    })
})
