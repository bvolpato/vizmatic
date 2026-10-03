import { describe, expect, it } from 'vitest'
import { applyComponentControls, type ComponentControlValues } from '../src/component-controls'
import { getComponentControls } from '../scripts/component-controls'

describe('component controls', () => {
    it('extracts supported literal props and edits only their JSX attribute spans', () => {
        const source = `width = 900
height = 520
<Scene title="Outside &amp; unchanged">
    <Panel title={'Say "hello" & C:\\\\tmp'} tone="purple" width={360} padding={18} shadow>
        <Panel title="Nested panel stays the same" tone="warm" width={180} />
    </Panel>
</Scene>`
        const controls = getComponentControls(source, 'Panel')
        const originalAttributes = controls.map((control) => source.slice(control.start, control.end))
        const title = 'Quoted "text" & C:\\Users\\Ada'
        const updated = applyComponentControls(source, controls, {
            title,
            tone: 'green',
            width: 440,
            padding: 24,
            shadow: false,
        })

        expect(controls.map((control) => [control.prop, control.type, source.slice(control.start, control.end)])).toEqual([
            ['title', 'text', `title={'Say "hello" & C:\\\\tmp'}`],
            ['tone', 'select', 'tone="purple"'],
            ['width', 'number', 'width={360}'],
            ['padding', 'number', 'padding={18}'],
            ['shadow', 'boolean', 'shadow'],
        ])
        expect(controls.find((control) => control.prop === 'tone')?.options).toContain('green')
        expect(updated).toContain(`title={${JSON.stringify(title)}}`)
        expect(updated).toContain('tone={"green"}')
        expect(updated).toContain('width={440}')
        expect(updated).toContain('padding={24}')
        expect(updated).toContain('shadow={false}')
        expect(updated).toContain('<Scene title="Outside &amp; unchanged">')
        expect(updated).toContain('<Panel title="Nested panel stays the same" tone="warm" width={180} />')
        expect(originalAttributes).toEqual([
            `title={'Say "hello" & C:\\\\tmp'}`,
            'tone="purple"',
            'width={360}',
            'padding={18}',
            'shadow',
        ])
    })

    it('offers only enum values containing the current value and handles booleans', () => {
        const source = `<Stack direction='horizontal' gap={12} wrap={false}><TextLabel text="items" /></Stack>`
        const controls = getComponentControls(source, 'Stack')
        expect(controls.map(({ prop, type, value }) => ({ prop, type, value }))).toEqual([
            { prop: 'direction', type: 'select', value: 'horizontal' },
            { prop: 'gap', type: 'number', value: 12 },
            { prop: 'wrap', type: 'boolean', value: false },
        ])
        expect(controls[0]?.options).toEqual(['horizontal', 'vertical'])
        expect(applyComponentControls(source, controls, { direction: 'vertical', wrap: true }))
            .toContain(`direction={"vertical"}`)
    })

    it('does not infer controls for helper calls, unsupported elements, or computed values', () => {
        expect(getComponentControls(`const card = Panel({ title: 'Helper call', width: 300 })`, 'Panel')).toEqual([])
        expect(getComponentControls(`<PanelHeader title="Different component" />`, 'Panel')).toEqual([])
        expect(getComponentControls(`<Panel title={makeTitle()} tone={currentTone} width={width} />`, 'Panel')).toEqual([])
        expect(getComponentControls(`<Panel orientation="horizontal" />`, 'Panel')).toEqual([])
    })

    it('rejects wrong types, unknown enum options, non-finite numbers, and out-of-range values', () => {
        const source = `<Panel title="Safe" tone="purple" width={360} />`
        const controls = getComponentControls(source, 'Panel')
        const invalid = (values: Record<string, unknown>) => applyComponentControls(
            source,
            controls,
            values as ComponentControlValues,
        )

        expect(() => invalid({ title: 12 })).toThrow('Invalid value for title')
        expect(() => invalid({ tone: 'ultraviolet' })).toThrow('Invalid value for tone')
        expect(() => invalid({ width: Number.NaN })).toThrow('Invalid value for width')
        expect(() => invalid({ width: 1500 })).toThrow('Invalid value for width')
        expect(() => invalid({ other: true })).toThrow('Unknown component control other')
        expect(applyComponentControls(source, controls, {})).toBe(source)
    })
})
