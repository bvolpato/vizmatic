import { EntityRelationshipDiagram, Scene, getThemeColors, type ThemeMode } from 'vizmatic'

export const width = 1280
export const height = 480

/** A nullable order reference and a composite line-item key carry different semantics. */
export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    return (
        <Scene c={c} title="Order data, with its constraints" subtitle="Crow-foot endpoints state how many records can participate; keys stay attached to their columns." background={c.bg} padding={28}>
            <EntityRelationshipDiagram
                c={c}
                title="Checkout schema"
                description="A customer can place multiple orders. Guest orders have no customer. Each line item belongs to one order."
                width={1224}
                height={300}
                fontSize={14}
                entities={[
                    { id: 'customers', label: 'Customers', tone: 'blue', attributes: [
                        { name: 'id', type: 'uuid', primaryKey: true },
                        { name: 'email', type: 'text', unique: true },
                        { name: 'name', type: 'text' },
                    ] },
                    { id: 'orders', label: 'Orders', tone: 'purple', attributes: [
                        { name: 'id', type: 'uuid', primaryKey: true },
                        { name: 'customer_id', type: 'uuid', foreignKey: true, nullable: true },
                        { name: 'created_at', type: 'timestamp' },
                    ] },
                    { id: 'line_items', label: 'Line items', tone: 'green', attributes: [
                        { name: 'order_id', type: 'uuid', primaryKey: true, foreignKey: true },
                        { name: 'line_number', type: 'integer', primaryKey: true },
                        { name: 'quantity', type: 'integer' },
                    ] },
                ]}
                relationships={[
                    { id: 'customer-orders', label: 'places',
                        from: { entity: 'customers', attribute: 'id', cardinality: 'zero-or-one' },
                        to: { entity: 'orders', attribute: 'customer_id', cardinality: 'zero-or-many' },
                    },
                    { id: 'order-items', label: 'contains', identifying: true,
                        from: { entity: 'orders', attribute: 'id', cardinality: 'one' },
                        to: { entity: 'line_items', attribute: 'order_id', cardinality: 'one-or-many' },
                    },
                ]}
            />
        </Scene>
    )
}

export default create('dark')
