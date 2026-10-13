import { describe, expect, it } from 'vitest'
import { buildComponentPropMetadata } from '../scripts/build-component-props'
import { componentCatalog } from '../scripts/component-catalog'
import { analyzeScene, setSceneLiteralProps, type SceneComponentPropSchema } from '../src/playground-scene'

const componentNames = componentCatalog.flatMap((category) =>
    category.components.map((component) => component.name))

describe('generated component prop metadata', () => {
    const metadata = buildComponentPropMetadata(componentNames)

    it('covers every catalog component using its package-root export', () => {
        expect(Object.keys(metadata.propsByComponent)).toEqual(componentNames)
        expect(metadata.propsByComponent.Canvas.find((prop) => prop.name === 'c')).toMatchObject({
            type: 'ThemeColors',
            required: true,
        })
    })

    it('records optionality, shared finite values, and useful property documentation', () => {
        expect(metadata.propsByComponent.Scene.find((prop) => prop.name === 'align')).toMatchObject({
            type: 'FlexAlign',
            required: false,
            allowedValuesRef: 'FlexAlign',
        })
        expect(metadata.enums.FlexAlign?.slice().sort()).toEqual(['center', 'end', 'start', 'stretch'])
        expect(metadata.propsByComponent.SequenceDiagram.find((prop) => prop.name === 'items')).toMatchObject({
            type: 'SequenceItem[]',
            required: false,
            description: 'Ordered event input. When present, it is the source of row order.',
        })
    })

    it('keeps structured data props as TypeScript types without claiming JSON defaults', () => {
        const participants = metadata.propsByComponent.SequenceDiagram.find((prop) => prop.name === 'participants')
        expect(participants).toMatchObject({ type: 'SequenceParticipant[]', required: true })
        expect(participants).not.toHaveProperty('allowedValuesRef')
        expect(participants).not.toHaveProperty('default')
        expect(metadata.propsByComponent.Watermark.find((prop) => prop.name === 'element')?.type).toBe('React.ReactNode')
    })

    it('exposes finite presets for callback unions without making callback expressions editable', () => {
        const format = metadata.propsByComponent.PieChart.find((prop) => prop.name === 'format')!
        expect(format).toHaveProperty('literalValuesRef')
        expect(format).not.toHaveProperty('allowedValuesRef')
        expect(new Set(metadata.enums[format.literalValuesRef!])).toEqual(new Set(['decimal', 'percent', 'integer', 'compact']))

        const formattedProps = [
            ['BarChart', 'format'], ['DonutChart', 'format'], ['LineChart', 'format'], ['ParetoBarChart', 'format'], ['PieChart', 'format'],
            ['QuadrantChart', 'formatX'], ['QuadrantChart', 'formatY'], ['ParetoChart', 'formatX'], ['ParetoChart', 'formatY'],
            ['ScatterPlot', 'formatX'], ['ScatterPlot', 'formatY'],
        ] as const
        for (const [component, prop] of formattedProps) {
            expect(metadata.propsByComponent[component].find((entry) => entry.name === prop)).toMatchObject({ literalValuesRef: 'ChartValueFormat' })
        }

        const props: SceneComponentPropSchema = {
            PieChart: metadata.propsByComponent.PieChart.map((prop) => ({
                ...prop,
                allowedValues: prop.allowedValuesRef ? metadata.enums[prop.allowedValuesRef] : undefined,
                literalValues: prop.literalValuesRef ? metadata.enums[prop.literalValuesRef] : undefined,
            })),
        }
        const source = '<PieChart segments={[]} />'
        const scene = analyzeScene(source, props)
        expect(scene.instances[0].properties.find((property) => property.prop === 'format')).toMatchObject({
            kind: 'select', initialValue: 'decimal', options: metadata.enums[format.literalValuesRef!],
        })
        const updated = setSceneLiteralProps(source, scene, scene.rootID, { format: 'compact' })
        expect(analyzeScene(updated, props).instances[0].properties.find((property) => property.prop === 'format')?.value).toBe('compact')
        const existing = '<PieChart segments={[]} format="integer" />'
        expect(analyzeScene(existing, props).instances[0].properties.find((property) => property.prop === 'format')).toMatchObject({
            kind: 'select', value: 'integer',
        })

        const computed = '<PieChart segments={[]} format={(value) => value.toFixed(1)} />'
        const computedScene = analyzeScene(computed, props)
        expect(computedScene.instances[0].properties.some((property) => property.prop === 'format')).toBe(false)
        expect(computedScene.instances[0].readOnlyProps).toContainEqual(expect.objectContaining({
            prop: 'format', reason: expect.stringContaining('computed'),
        }))
        expect(() => setSceneLiteralProps(computed, computedScene, computedScene.rootID, { format: 'percent' }))
            .toThrow('computed')
    })
})
