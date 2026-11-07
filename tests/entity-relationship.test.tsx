import React from 'react'
import { describe, expect, it } from 'vitest'
import { getThemeColors } from '../src/theme'
import { renderToSvg } from '../src/render'
import { checkFrame } from '../src/check'
import {
    EntityRelationshipDiagram,
    type EntityRelationship,
    type EntityRelationshipCardinality,
    type EntityRelationshipEntity,
} from '../src/primitives/entity-relationship'

const entities: EntityRelationshipEntity[] = [
    { id: 'customers', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'email', type: 'text', unique: true }] },
    { id: 'orders', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'customer_id', type: 'uuid', foreignKey: true }, { name: 'note', type: 'text', nullable: true }] },
]
const relationships: EntityRelationship[] = [{
    id: 'customer-orders', label: 'places',
    from: { entity: 'customers', attribute: 'id', cardinality: 'one' },
    to: { entity: 'orders', attribute: 'customer_id', cardinality: 'zero-or-many' },
}]

function render(props: Partial<React.ComponentProps<typeof EntityRelationshipDiagram>> = {}) {
    return EntityRelationshipDiagram({ c: getThemeColors('dark'), entities, relationships, ...props })
}

function elements(node: React.ReactNode, predicate: (element: React.ReactElement<Record<string, unknown>>) => boolean): React.ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate))
    if (!React.isValidElement(node)) return []
    const element = node as React.ReactElement<Record<string, unknown>>
    return [...(predicate(element) ? [element] : []), ...elements(element.props.children as React.ReactNode, predicate)]
}

function glyphBounds(glyph: React.ReactElement<Record<string, unknown>>) {
    const bounds = elements(glyph, (element) => element.type === 'path' || element.type === 'circle').map((element) => {
        const halfStroke = Number(element.props.strokeWidth) / 2
        if (element.type === 'circle') {
            const x = Number(element.props.cx), y = Number(element.props.cy), r = Number(element.props.r) + halfStroke
            return { left: x - r, right: x + r, top: y - r, bottom: y + r }
        }
        const coordinates = String(element.props.d).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number)
        const xs = coordinates.filter((_, index) => index % 2 === 0), ys = coordinates.filter((_, index) => index % 2 === 1)
        return { left: Math.min(...xs) - halfStroke, right: Math.max(...xs) + halfStroke, top: Math.min(...ys) - halfStroke, bottom: Math.max(...ys) + halfStroke }
    })
    return { left: Math.min(...bounds.map((box) => box.left)), right: Math.max(...bounds.map((box) => box.right)), top: Math.min(...bounds.map((box) => box.top)), bottom: Math.max(...bounds.map((box) => box.bottom)) }
}

function expectSeparateCardinalities(diagram: React.ReactNode) {
    const glyphs = elements(diagram, (element) => typeof element.props['data-er-cardinality'] === 'string').map(glyphBounds)
    for (let index = 0; index < glyphs.length; index++) {
        for (const other of glyphs.slice(index + 1)) {
            const box = glyphs[index]
            expect(box.left >= other.right || box.right <= other.left || box.top >= other.bottom || box.bottom <= other.top, JSON.stringify({ box, other })).toBe(true)
        }
    }
}

describe('entity relationship diagrams', () => {
    it.each((['LR', 'RL', 'TB', 'BT'] as const).flatMap((direction) => [{ direction, fontSize: 36 }, { direction, density: 'presentation' as const }]))('separates large cardinality symbols and keeps them before route bends %j', (options) => {
        const diagram = render({ ...options, relationships: [{ id: 'optional-orders',
            from: { entity: 'customers', attribute: 'id', cardinality: 'zero-or-one' },
            to: { entity: 'orders', attribute: 'customer_id', cardinality: 'zero-or-many' },
        }] })
        expectSeparateCardinalities(diagram)
        const path = elements(diagram, (element) => element.props['data-vizmatic-graph-edge-id'] === 'optional-orders')[0]
        const coordinates = String(path.props.d).match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number)
        const points = Array.from({ length: coordinates.length / 2 }, (_, index) => ({ x: coordinates[index * 2], y: coordinates[index * 2 + 1] }))
        const glyphs = elements(diagram, (element) => typeof element.props['data-er-cardinality'] === 'string').map(glyphBounds)
        for (const [anchor, next, box] of [[points[0], points[1], glyphs[0]], [points.at(-1)!, points.at(-2)!, glyphs[1]]] as const) {
            const extent = next.x > anchor.x ? box.right - anchor.x : next.x < anchor.x ? anchor.x - box.left : next.y > anchor.y ? box.bottom - anchor.y : anchor.y - box.top
            expect(Math.hypot(next.x - anchor.x, next.y - anchor.y)).toBeGreaterThan(extent + 0.5)
        }
    })

    it.each(['LR', 'TB'] as const)('separates large markers on shared-key parallel routes and a same-key self relationship in %s layout', (direction) => {
        const parallel: EntityRelationship[] = [
            { id: 'payer', from: { entity: 'users', attribute: 'id', cardinality: 'one' }, to: { entity: 'payments', attribute: 'payer_id', cardinality: 'zero-or-many' } },
            { id: 'payee', from: { entity: 'users', attribute: 'id', cardinality: 'zero-or-one' }, to: { entity: 'payments', attribute: 'payee_id', cardinality: 'zero-or-many' } },
        ]
        expectSeparateCardinalities(render({ fontSize: 36, direction, entities: [
            { id: 'users', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
            { id: 'payments', attributes: [{ name: 'payer_id', type: 'uuid', foreignKey: true }, { name: 'payee_id', type: 'uuid', foreignKey: true }] },
        ], relationships: parallel }))
        expectSeparateCardinalities(render({ fontSize: 36, direction, entities: [entities[0]], relationships: [{ id: 'recursive',
            from: { entity: 'customers', attribute: 'id', cardinality: 'zero-or-one' }, to: { entity: 'customers', attribute: 'id', cardinality: 'zero-or-many' },
        }] }))
    })

    it.each(['', '   '])('retains schema metadata with an empty title %j', async (title) => {
        const svg = await renderToSvg(render({ title }), 900, 420)
        expect(svg).toMatch(/<title[^>]*>Entity relationship diagram<\/title>/)
        expect(svg).toContain('customer_id (uuid, foreign key, not null)')
        expect(svg).toContain('vizmatic-graph-index-0-node-customers')
    })

    it.each([{ density: 'presentation' as const }, { fontSize: 28 }, { fontSize: 36 }])('sizes the legend for larger text %j', async (options) => {
        const report = await checkFrame({ width: 1400, height: 800, create: (theme) => EntityRelationshipDiagram({
            c: getThemeColors(theme), entities: [entities[0]], ...options,
        }) }, { themes: ['dark', 'light'], background: 'theme', failOn: 'warning' })
        expect(report.rendered, JSON.stringify(report.themes)).toBe(true)
        expect(report.summary.errors, JSON.stringify(report.themes)).toBe(0)
        expect(report.summary.warnings, JSON.stringify(report.themes)).toBe(0)
    })

    it('rejects ambiguous entities, attributes, and nullable primary keys', () => {
        expect(() => render({ entities: [...entities, entities[0]] })).toThrow('duplicate entity id "customers"')
        expect(() => render({ entities: [{ id: 'customers', attributes: [{ name: 'id', type: 'uuid' }, { name: 'id', type: 'text' }] }] })).toThrow('duplicate attribute "customers.id"')
        expect(() => render({ entities: [{ id: 'customers', attributes: [{ name: 'id', type: 'uuid', primaryKey: true, nullable: true }] }] })).toThrow('primary key "customers.id" cannot be nullable')
        expect(() => render({ entities: [] })).toThrow('at least one entity')
    })

    it('validates relationship identities, references, cardinalities, and ordered composite mappings', () => {
        expect(() => render({ relationships: [relationships[0], relationships[0]] })).toThrow('duplicate relationship id "customer-orders"')
        expect(() => render({ relationships: [{ ...relationships[0], from: { entity: 'missing', cardinality: 'one' } }] })).toThrow('relationship "customer-orders" references missing entity "missing"')
        expect(() => render({ relationships: [{ ...relationships[0], to: { entity: 'orders', attribute: 'missing', cardinality: 'one' } }] })).toThrow('missing attribute "orders.missing"')
        expect(() => render({ relationships: [{ ...relationships[0], to: { entity: 'orders', cardinality: 'many' as EntityRelationshipCardinality } }] })).toThrow('invalid cardinality "many"')
        expect(() => render({ relationships: [{ ...relationships[0], from: { entity: 'customers', attribute: ['id', 'email'], cardinality: 'one' } }] })).toThrow('mismatched composite attribute counts')
        expect(() => render({ relationships: [{ ...relationships[0], from: { entity: 'customers', attribute: ['id', 'id'], cardinality: 'one' } }] })).toThrow('repeats an endpoint attribute')
    })

    it('draws optional circles and mandatory bars separately from one and many endpoints', () => {
        for (const cardinality of ['one', 'zero-or-one', 'one-or-many', 'zero-or-many'] as const) {
            const diagram = render({ relationships: [{ ...relationships[0], from: { entity: 'customers', cardinality }, to: { entity: 'orders', cardinality } }] })
            const glyphs = elements(diagram, (element) => element.props['data-er-cardinality'] === cardinality)
            expect(glyphs).toHaveLength(2)
            const circles = elements(glyphs, (element) => element.type === 'circle')
            expect(circles).toHaveLength(cardinality.startsWith('zero') ? 2 : 0)
            const path = elements(glyphs[0], (element) => element.type === 'path')[0].props.d as string
            expect(path.match(/\bL\b/g)?.length).toBe(cardinality.endsWith('many') ? cardinality.startsWith('zero') ? 3 : 4 : cardinality.startsWith('zero') ? 1 : 2)
        }
    })

    it('preserves actual schema semantics in exported SVGs and renders cleanly in both themes', async () => {
        const create = (theme: 'dark' | 'light') => React.createElement(EntityRelationshipDiagram, {
            c: getThemeColors(theme), entities, relationships, title: 'Customer orders', description: 'Checkout schema.', width: 900, height: 420,
        })
        const svg = await renderToSvg(create('dark'), 900, 420, { theme: 'dark' })
        expect(svg).toMatch(/<title[^>]*>Customer orders<\/title>/)
        expect(svg).toContain('Checkout schema.')
        expect(svg).toContain('customer_id (uuid, foreign key, not null)')
        expect(svg).toContain('email (text, unique, not null)')
        expect(svg).toContain('note (text, nullable)')
        expect(svg).toContain('customers [id] (exactly one) to orders [customer_id] (zero or more): places')
        expect(svg).toContain('vizmatic-graph-index-0-node-customers')
        expect(svg).toContain('vizmatic-graph-index-0-edge-customer-orders')
        expect(svg).toBe(await renderToSvg(create('dark'), 900, 420, { theme: 'dark' }))
        const report = await checkFrame({ width: 900, height: 420, create }, { themes: ['dark', 'light'], background: 'theme', failOn: 'warning' })
        expect(report.rendered, JSON.stringify(report.themes)).toBe(true)
        expect(report.summary.errors, JSON.stringify(report.themes)).toBe(0)
        expect(report.summary.warnings, JSON.stringify(report.themes)).toBe(0)
    }, 20_000)

    it('keeps composite primary and foreign keys readable with long names and vertical layout', async () => {
        const composite: EntityRelationshipEntity[] = [
            { id: 'memberships', label: 'Organization memberships', attributes: [{ name: 'organization_id', type: 'uuid', primaryKey: true, foreignKey: true }, { name: 'member_id', type: 'uuid', primaryKey: true }] },
            { id: 'profiles', label: 'Optional membership profiles', attributes: [{ name: 'organization_id', type: 'uuid', primaryKey: true, foreignKey: true }, { name: 'member_id', type: 'uuid', primaryKey: true, foreignKey: true }] },
        ]
        const compositeRelationship: EntityRelationship[] = [{ id: 'profile-key', identifying: true,
            from: { entity: 'memberships', attribute: ['organization_id', 'member_id'], cardinality: 'one' },
            to: { entity: 'profiles', attribute: ['organization_id', 'member_id'], cardinality: 'zero-or-one' },
        }]
        const report = await checkFrame({ width: 800, height: 650, create: (theme) => React.createElement(EntityRelationshipDiagram, { c: getThemeColors(theme), entities: composite, relationships: compositeRelationship, width: 800, height: 650, direction: 'TB' }) }, { background: 'theme' })
        expect(report.summary.errors, JSON.stringify(report.themes)).toBe(0)
        expect(report.summary.warnings, JSON.stringify(report.themes)).toBe(0)
        const description = render({ entities: composite, relationships: compositeRelationship }).props as Record<string, unknown>
        expect(description['data-vizmatic-svg-description']).toContain('Organization memberships [organization_id, member_id] (exactly one) to Optional membership profiles [organization_id, member_id] (zero or one)')
    }, 20_000)

    it('reports invalid or undersized dimensions instead of hiding the schema', () => {
        expect(() => render({ width: Number.NaN })).toThrow('width must be a finite positive number')
        expect(() => render({ fontSize: 0 })).toThrow('fontSize must be a finite positive number')
        expect(() => render({ padding: -1 })).toThrow('padding must be a finite non-negative number')
        expect(() => render({ width: 100 })).toThrow(/width needs at least \d+px/)
        expect(() => render({ height: 20 })).toThrow(/height needs at least \d+px/)
    })

    it('reserves room for labels on parallel foreign-key routes and recursive relationships', async () => {
        const paymentEntities: EntityRelationshipEntity[] = [
            { id: 'users', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }] },
            { id: 'payments', attributes: [{ name: 'payer_id', type: 'uuid', foreignKey: true }, { name: 'payee_id', type: 'uuid', foreignKey: true }] },
        ]
        const paymentRelationships: EntityRelationship[] = [
            { id: 'payer', label: 'pays', from: { entity: 'users', attribute: 'id', cardinality: 'one' }, to: { entity: 'payments', attribute: 'payer_id', cardinality: 'zero-or-many' } },
            { id: 'payee', label: 'receives', from: { entity: 'users', attribute: 'id', cardinality: 'one' }, to: { entity: 'payments', attribute: 'payee_id', cardinality: 'zero-or-many' } },
        ]
        const recursiveEntities: EntityRelationshipEntity[] = [{ id: 'staff', attributes: [{ name: 'id', type: 'uuid', primaryKey: true }, { name: 'manager_id', type: 'uuid', foreignKey: true, nullable: true }] }]
        const recursiveRelationships: EntityRelationship[] = [{ id: 'manager', label: 'reports to a manager', from: { entity: 'staff', attribute: 'id', cardinality: 'zero-or-one' }, to: { entity: 'staff', attribute: 'manager_id', cardinality: 'zero-or-many' } }]
        for (const spec of [{ entities: paymentEntities, relationships: paymentRelationships }, { entities: recursiveEntities, relationships: recursiveRelationships }]) {
            const report = await checkFrame({ width: 900, height: 420, create: (theme) => React.createElement(EntityRelationshipDiagram, { c: getThemeColors(theme), ...spec }) }, { background: 'theme', failOn: 'warning' })
            expect(report.rendered, JSON.stringify(report.themes)).toBe(true)
            expect(report.summary.errors, JSON.stringify(report.themes)).toBe(0)
            expect(report.summary.warnings, JSON.stringify(report.themes)).toBe(0)
        }
    }, 20_000)
})
