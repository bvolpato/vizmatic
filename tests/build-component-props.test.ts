import { describe, expect, it } from 'vitest'
import { buildComponentPropMetadata } from '../scripts/build-component-props'
import { componentCatalog } from '../scripts/component-catalog'

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
})
