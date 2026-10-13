import { describe, expect, it } from 'vitest'
import {
    analyzeScene, removeSceneLiteralProp, setSceneLiteralProps,
    type SceneComponentPropSchema,
} from '../src/playground-scene'
import { readPlaygroundSettings, updatePlaygroundSettings } from '../src/playground-settings'

const componentProps: SceneComponentPropSchema = {
    Demo: [
        { name: 'title', type: 'string', required: false },
        { name: 'subtitle', type: 'string', required: false },
        { name: 'width', type: 'number', required: false },
        { name: 'height', type: 'number', required: false },
        { name: 'size', type: 'number', required: false },
        { name: 'showLegend', type: 'boolean', required: false, allowedValues: [false, true] },
        { name: 'format', type: 'ChartValueFormat', required: false, allowedValues: ['decimal', 'percent', 'integer'] },
        { name: 'footer', type: 'string', required: false },
        { name: 'style', type: 'React.CSSProperties', required: false },
        { name: 'data', type: 'ExampleDatum[]', required: false },
        { name: 'segments', type: 'DonutChartSegment[]', required: true },
    ],
}

describe('complete visual property customization', () => {
    it('shows all literal props, including numeric values beyond slider hints and nested JSON styles', () => {
        const source = `<Demo title="Chart" width={960} height={480} size={900} showLegend={false} format="future-format" footer="Tail" data={[{label:'A', value:1}]} style={{ fontSize: 18, nested: { color: '#123456' } }} segments={[{label:'A',value:1}]} />`
        const scene = analyzeScene(source, componentProps)
        const properties = scene.instances[0].properties

        expect(properties.length).toBeGreaterThan(8)
        expect(properties.find((property) => property.prop === 'size')).toMatchObject({ kind: 'number', value: 900 })
        expect(properties.find((property) => property.prop === 'format')).toMatchObject({ kind: 'select', value: 'future-format' })
        expect(properties.find((property) => property.prop === 'showLegend')).toMatchObject({ kind: 'select', value: false })
        expect(properties.find((property) => property.prop === 'style')).toMatchObject({
            kind: 'json', value: { fontSize: 18, nested: { color: '#123456' } },
        })
        expect(properties.find((property) => property.prop === 'footer')).toMatchObject({ kind: 'text', value: 'Tail' })
        expect(() => setSceneLiteralProps(source, scene, scene.rootID, { format: 'invalid' })).toThrow('listed values')

        const updated = setSceneLiteralProps(source, scene, scene.rootID, {
            size: 901,
            style: { fontSize: 22, nested: { color: '#abcdef', opacity: 0.5 } },
        })
        const next = analyzeScene(updated, componentProps).instances[0].properties
        expect(next.find((property) => property.prop === 'size')?.value).toBe(901)
        expect(next.find((property) => property.prop === 'style')?.value).toEqual({
            fontSize: 22, nested: { color: '#abcdef', opacity: 0.5 },
        })
    })

    it('adds, edits, and removes optional primitive, object, and array props from fresh snapshots', () => {
        const source = '<Demo segments={[]} />'
        const initialScene = analyzeScene(source, componentProps)
        const initial = initialScene.instances[0]
        expect(initial.properties.find((property) => property.prop === 'footer')).toMatchObject({ initialValue: '' })
        expect(initial.properties.find((property) => property.prop === 'style')).toMatchObject({ kind: 'json', initialValue: {} })
        expect(initial.properties.find((property) => property.prop === 'data')).toMatchObject({ kind: 'json', initialValue: [] })
        expect(initial.properties.find((property) => property.prop === 'segments')).toMatchObject({ required: true, kind: 'json' })

        const added = setSceneLiteralProps(source, initialScene, initial.id, {
            footer: 'Updated title', style: { color: '#123456', padding: 8 }, data: [{ label: 'A', value: 2 }],
        })
        expect(added).toContain('footer={"Updated title"}')
        const current = analyzeScene(added, componentProps)
        expect(current.instances[0].properties.find((property) => property.prop === 'style')?.value).toEqual({ color: '#123456', padding: 8 })
        const edited = setSceneLiteralProps(added, current, current.rootID, { footer: 'Changed again' })
        const editedScene = analyzeScene(edited, componentProps)
        expect(editedScene.instances[0].properties.find((property) => property.prop === 'footer')?.value).toBe('Changed again')

        const withoutFooter = removeSceneLiteralProp(edited, editedScene, editedScene.rootID, 'footer')
        const finalScene = analyzeScene(withoutFooter, componentProps)
        const finalProperties = finalScene.instances[0].properties
        expect(finalProperties.find((property) => property.prop === 'footer')).toMatchObject({ initialValue: '' })
        expect(finalProperties.find((property) => property.prop === 'style')?.value).toEqual({ color: '#123456', padding: 8 })
        expect(() => removeSceneLiteralProp(withoutFooter, finalScene, finalScene.rootID, 'segments'))
            .toThrow('required')
    })

    it('supports editable JSX data and accessibility attributes', () => {
        const source = '<Demo data-testid="chart" aria-label="Traffic" segments={[]} />'
        const scene = analyzeScene(source, componentProps)
        const properties = scene.instances[0].properties
        expect(properties.some((property) => property.prop === 'data-testid')).toBe(true)
        expect(properties.some((property) => property.prop === 'aria-label')).toBe(true)
        const updated = setSceneLiteralProps(source, scene, scene.rootID, { 'data-testid': 'custom-chart' })
        expect(updated).toContain('data-testid={"custom-chart"}')
    })

    it('keeps broad scalar unions flexible rather than turning one branch into an exhaustive enum', () => {
        const schema: SceneComponentPropSchema = { Demo: [
            { name: 'metric', type: 'string | number', required: false },
        ] }
        const source = '<Demo />'
        const scene = analyzeScene(source, schema)
        expect(scene.instances[0].properties.find((property) => property.prop === 'metric')).toMatchObject({
            kind: 'json', initialValue: '',
        })
        const numberValue = setSceneLiteralProps(source, scene, scene.rootID, { metric: 9_999 })
        expect(analyzeScene(numberValue, schema).instances[0].properties.find((property) => property.prop === 'metric')?.value).toBe(9_999)
        const numberScene = analyzeScene(numberValue, schema)
        const stringValue = setSceneLiteralProps(numberValue, numberScene, numberScene.rootID, { metric: 'custom metric' })
        expect(analyzeScene(stringValue, schema).instances[0].properties.find((property) => property.prop === 'metric')?.value).toBe('custom metric')
        const stringScene = analyzeScene(stringValue, schema)
        expect(() => setSceneLiteralProps(stringValue, stringScene, stringScene.rootID, { metric: true })).toThrow('TypeScript types')
    })

    it('keeps computed, spread-overridden, unsafe JSON, invalid known data, and stale edits source-only', () => {
        const source = `<Demo title={chooseTitle()} width={960} {...settings} height={makeHeight()} style={{color:'#fff'}} />`
        const scene = analyzeScene(source, componentProps)
        expect(scene.instances[0].properties.some((property) => property.prop === 'title')).toBe(false)
        expect(scene.instances[0].readOnlyProps).toEqual(expect.arrayContaining([
            expect.objectContaining({ prop: 'title', reason: expect.stringContaining('spread') }),
            expect.objectContaining({ prop: 'width', reason: expect.stringContaining('spread') }),
            expect.objectContaining({ prop: 'height', reason: expect.stringContaining('computed') }),
            expect.objectContaining({ prop: 'Spread props' }),
        ]))
        expect(() => setSceneLiteralProps(source, scene, scene.rootID, { height: 600 })).toThrow('computed')
        expect(() => removeSceneLiteralProp(source, scene, scene.rootID, 'height')).toThrow('spread')
        expect(() => setSceneLiteralProps(source, scene, scene.rootID, { style: JSON.parse('{"__proto__":{"polluted":true}}') }))
            .toThrow('not supported')
        const oversized = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`key${index}`, index]))
        expect(() => setSceneLiteralProps(source, scene, scene.rootID, { style: oversized }))
            .toThrow('1,000 properties')
        expect(() => setSceneLiteralProps(source + ' ', scene, scene.rootID, { height: 600 })).toThrow('scene changed')

        const computed = '<Demo title={chooseTitle()} />'
        const computedScene = analyzeScene(computed, componentProps)
        expect(computedScene.instances[0].readOnlyProps).toContainEqual(expect.objectContaining({
            prop: 'title', reason: expect.stringContaining('computed'),
        }))

        const chart = '<PieChart segments={[{label:"A",value:1}]} />'
        const chartScene = analyzeScene(chart)
        expect(() => setSceneLiteralProps(chart, chartScene, chartScene.rootID, { segments: [{ label: 'A', value: -1 }] }))
            .toThrow('non-negative')
    })

    it('keeps expression-generated components source-only and rejects direct edits', () => {
        const source = '<Scene>{items.map((title) => <Demo title={title} size={18} segments={[]} />)}</Scene>'
        const scene = analyzeScene(source, componentProps)
        const generated = scene.instances.find((instance) => instance.name === 'Demo')!
        expect(generated.unsafeReason).toContain('expression-generated')
        expect(generated.properties).toEqual([])
        expect(generated.readOnlyProps).toContainEqual(expect.objectContaining({
            prop: 'size', reason: expect.stringContaining('JSX expression'),
        }))
        expect(() => setSceneLiteralProps(source, scene, generated.id, { size: 20 })).toThrow('expression-generated')
        expect(() => removeSceneLiteralProp(source, scene, generated.id, 'size')).toThrow('expression-generated')
    })

    it('keeps root Board inspector edits aligned with frame metadata and protects dimensions from removal', () => {
        const schema: SceneComponentPropSchema = { Board: [
            { name: 'width', type: 'number', required: false },
            { name: 'height', type: 'number', required: false },
        ] }
        const source = 'width = 960\nheight = 480\n\n<Board />'
        const scene = analyzeScene(source, schema)
        expect(scene.instances[0].properties.find((property) => property.prop === 'width')).toMatchObject({ initialValue: 960 })
        const withWidth = setSceneLiteralProps(source, scene, scene.rootID, { width: 1200 })
        const synchronized = updatePlaygroundSettings(withWidth, { width: 1200 })
        expect(readPlaygroundSettings(synchronized)).toMatchObject({ width: 1200, height: 480 })
        expect(synchronized).toContain('<Board width={1200} />')
        const updatedScene = analyzeScene(synchronized, schema)
        expect(() => removeSceneLiteralProp(synchronized, updatedScene, updatedScene.rootID, 'width'))
            .toThrow('frame setting')
    })
})
