import { describe, expect, it } from 'vitest'
import { analyzeScene, appendSceneComponent, setSceneLiteralProps, updateStructuredSceneProp } from '../src/playground-scene'
import { validateStructuredSceneValue } from '../src/playground-data'

describe('builder structured data source edits', () => {
    it('reads literal arrays and objects without evaluating setup, calls, or spread data', () => {
        const source = `<Scene>
  <BarChart data={[{label: 'A \\u{1F680}', value: -2, color: '#fff',}, /* comment */ {label: "B", value: +3, valueLabel: 'three'}]} />
  <ScatterPlot points={[{x: 1_000, y: -0.5, label: 'Point'}]} />
  <DataTable rows={[["Name", "Value"], ["A", 2], [null, false]]} />
  <BarChart data={readRemoteData()} />
  <PieChart segments={[{label: 'Hidden', value: 4}]} {...settings} />
  <PieChart {...settings} segments={[{label: 'Visible', value: 5}]} />
</Scene>`
        const scene = analyzeScene(source)
        expect(scene.instances[1].structuredControls[0].value).toEqual([
            { label: 'A 🚀', value: -2, color: '#fff' }, { label: 'B', value: 3, valueLabel: 'three' },
        ])
        expect(scene.instances[2].structuredControls[0].value).toEqual([{ x: 1000, y: -0.5, label: 'Point' }])
        expect(scene.instances[3].structuredControls[0].value).toEqual([['Name', 'Value'], ['A', 2], [null, false]])
        expect(scene.instances[4].structuredControls).toHaveLength(0)
        expect(scene.instances[5].structuredControls).toHaveLength(0)
        expect(scene.instances[6].structuredControls[0].value).toEqual([{ label: 'Visible', value: 5 }])
    })

    it('updates only the selected repeated chart attribute and retains source setup and scalar controls', () => {
        const source = `width = 960
const keep = 'data={[not data]}';
<Scene>
 <BarChart title="First" width={380} data={[{label:'A',value:1}]} />
 <BarChart title="Second" data={[{label:'B',value:2}]} />
</Scene>`
        const scene = analyzeScene(source)
        const data = [{ label: 'Quotes " < & Unicode 🪄', value: 12 }, { label: 'New row', value: -1 }]
        const updated = updateStructuredSceneProp(source, scene, scene.instances[2].id, 'data', data)
        expect(updated).toContain("const keep = 'data={[not data]}';")
        expect(updated).toContain(`<BarChart title="First" width={380} data={[{label:'A',value:1}]} />`)
        const next = analyzeScene(updated)
        expect(next.instances[2].structuredControls[0].value).toEqual(data)
        expect(next.instances[1].controls.find((control) => control.prop === 'width')?.value).toBe(380)
        expect(() => updateStructuredSceneProp(updated, scene, scene.instances[2].id, 'data', data)).toThrow('scene changed')
    })

    it('rejects computed data, shorthand, unsafe keys, and duplicate props rather than replacing them', () => {
        const source = `<Scene>
 <BarChart data={[{label, value: 1}]} />
 <BarChart data={[{label: 'A', value: fetchValue()}]} />
 <BarChart data={[{label:'A', value:1}]} data={other} />
 <BarChart data={[{label:'A', value:1, '__proto__': {test: true}}]} />
</Scene>`
        const scene = analyzeScene(source)
        expect(scene.instances.slice(1).every((instance) => !instance.structuredControls.length)).toBe(true)
        expect(() => setSceneLiteralProps(source, scene, scene.instances[1].id, { data: [] })).toThrow('computed')
        expect(() => setSceneLiteralProps(source, scene, scene.instances[3].id, { data: [] })).toThrow('more than once')
        expect(() => validateStructuredSceneValue('BarChart', 'data', JSON.parse('[{"label":"A","value":1,"__proto__":{}}]'))).toThrow('not supported')
    })

    it('validates chart rows, point coordinates, and table cells before modifying source', () => {
        expect(() => validateStructuredSceneValue('PieChart', 'segments', [{ label: 'A', value: -1 }])).toThrow('non-negative')
        expect(() => validateStructuredSceneValue('ParetoBarChart', 'data', [{ label: 'A', value: Infinity }])).toThrow('finite')
        expect(() => validateStructuredSceneValue('BarChart', 'data', [{ label: 'A', value: '1' }])).toThrow('row 1 value must be a finite number')
        expect(() => validateStructuredSceneValue('ScatterPlot', 'points', [{ x: 2 }])).toThrow('row 1 y')
        expect(() => validateStructuredSceneValue('ScatterPlot', 'points', [{ x: 2, y: 3, size: 0 }])).toThrow('greater than zero')
        expect(() => validateStructuredSceneValue('DataTable', 'rows', [['A', { label: 'B' }]])).toThrow('cells must be text')
        expect(() => validateStructuredSceneValue('LineChart', 'series', [{ name: 'A', points: [1, '2'] }])).toThrow('point 2')
        expect(() => validateStructuredSceneValue('DataTable', 'rows', [['A', 2, null, true]])).not.toThrow()
    })

    it('validates graph references and supports an atomic node and edge replacement', () => {
        const source = `<GraphDiagram nodes={[{id:'a',label:'A'}, {id:'b',label:'B'}]} edges={[{from:'a',to:'b'}]} />`
        const scene = analyzeScene(source)
        expect(() => updateStructuredSceneProp(source, scene, scene.rootID, 'nodes', [{ id: 'a', label: 'A' }])).toThrow('missing node')
        expect(() => updateStructuredSceneProp(source, scene, scene.rootID, 'edges', [{ from: 'a', to: 'missing' }])).toThrow('missing node')
        const updated = setSceneLiteralProps(source, scene, scene.rootID, { nodes: [{ id: 'a', label: 'A' }], edges: [] })
        expect(analyzeScene(updated).instances[0].structuredControls.map((control) => control.value)).toEqual([[{ id: 'a', label: 'A' }], []])
        expect(() => validateStructuredSceneValue('GraphDiagram', 'nodes', [{ id: 'a', label: 'A' }, { id: 'a', label: 'A again' }])).toThrow('Duplicate nodes id')
    })

    it('adds geometry literals safely and protects computed and spread-overridden values', () => {
        const source = `<Board width={960}><CanvasItem x={40} y={50}><MetricCard label="A" value="1" /></CanvasItem></Board>`
        const scene = analyzeScene(source)
        const updated = setSceneLiteralProps(source, scene, scene.instances[1].id, { x: 80, y: 90, width: 260, height: 144 })
        const attributes = analyzeScene(updated).instances[1].attributes
        expect(Object.fromEntries(attributes.map((attribute) => [attribute.prop, attribute.value]))).toEqual({ x: 80, y: 90, width: 260, height: 144 })
        const computed = `<CanvasItem x={position.x} y={50} />`
        expect(() => setSceneLiteralProps(computed, analyzeScene(computed), analyzeScene(computed).rootID, { x: 20 })).toThrow('current scene snapshot')
        const computedScene = analyzeScene(computed)
        expect(() => setSceneLiteralProps(computed, computedScene, computedScene.rootID, { x: 20 })).toThrow('computed')
        const spread = '<CanvasItem x={40} {...position} />'
        const spreadScene = analyzeScene(spread)
        expect(() => setSceneLiteralProps(spread, spreadScene, spreadScene.rootID, { x: 20 })).toThrow('overridden')
        expect(() => setSceneLiteralProps(source, scene, scene.instances[1].id, { width: NaN })).toThrow('finite')
    })

    it('wraps inserted catalog components in positioned Board items using literal dimensions', () => {
        const source = 'width = 960\nheight = 540\n<Board width={960} height={540} />'
        const example = '<Scene><BarChart width={380} height={260} data={[{label:"A",value:1}]} /></Scene>'
        const added = appendSceneComponent(source, analyzeScene(source), example, 'BarChart')
        const scene = analyzeScene(added)
        expect(scene.instances.map((instance) => instance.name)).toEqual(['Board', 'CanvasItem', 'BarChart'])
        expect(scene.instances[1].attributes.map((attribute) => [attribute.prop, attribute.value])).toEqual([['x', 40], ['y', 40], ['width', 380], ['height', 260]])
        const twice = appendSceneComponent(added, scene, example, 'BarChart')
        expect(analyzeScene(twice).instances.filter((instance) => instance.name === 'CanvasItem')[1].attributes[0].value).toBe(64)
        expect(twice).toContain('width = 960\nheight = 540')
    })
})
