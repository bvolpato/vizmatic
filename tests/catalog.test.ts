import { existsSync } from 'fs'
import { describe, expect, it } from 'vitest'
import * as primitives from '../src/primitives'
import { Watermark } from '../src/brand'
import {
    catalogComponentCount,
    catalogUtilities,
    componentCatalog,
} from '../scripts/component-catalog'

describe('component catalog', () => {
    it('covers every public primitive function exactly once', () => {
        const primitiveFunctions = Object.entries(primitives)
            .filter(([, value]) => typeof value === 'function')
            .map(([name]) => name)
            .sort()
        const componentNames = componentCatalog.flatMap((category) =>
            category.components.map((component) => component.name))
        const primitiveComponentNames = componentNames.filter((name) => name !== Watermark.name)
        const coveredExports = [...primitiveComponentNames, ...catalogUtilities].sort()

        expect(new Set(componentNames).size).toBe(componentNames.length)
        expect(componentNames).toHaveLength(catalogComponentCount)
        expect(componentNames).toContain(Watermark.name)
        expect(coveredExports).toEqual(primitiveFunctions)
    })

    it('keeps every category useful and backed by a rendered example', () => {
        expect(componentCatalog.length).toBeGreaterThanOrEqual(6)
        for (const category of componentCatalog) {
            expect(category.description.length).toBeGreaterThan(20)
            expect(category.components.length).toBeGreaterThan(0)
            expect(existsSync(`examples/${category.source}.tsx`)).toBe(true)
            for (const component of category.components) {
                expect(component.description.length).toBeGreaterThan(20)
            }
        }
    })
})
