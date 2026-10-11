import { describe, expect, it } from 'vitest'
import {
    analyzeScene, appendSceneComponent, duplicateSceneInstance, moveSceneInstance,
    removeSceneInstance, updateSceneControls,
} from '../src/playground-scene'
import { getComponentControls } from '../scripts/component-controls'

describe('playground scene source model', () => {
    it('finds repeated nested instances and controls at original source offsets', () => {
        const source = `width = 960
height = 480
const setup = { title: 'Keep this setup' };
export default (
  <Scene title="A &amp; B">
    <Row gap={14}>
      <MetricCard label="Build" value="98.7%" width={220} />
      <MetricCard label="Issues" value={'4'} width={300} />
    </Row>
  </Scene>
); // trailing comment`
        const scene = analyzeScene(source)
        expect(scene.instances.map((instance) => [instance.name, instance.depth])).toEqual([
            ['Scene', 0], ['Row', 1], ['MetricCard', 2], ['MetricCard', 2],
        ])
        const [root, row, first, second] = scene.instances
        expect(scene.rootID).toBe(root.id)
        expect(first.parentID).toBe(row.id)
        expect(first.id).not.toBe(second.id)
        expect(source.slice(first.start, first.end)).toBe('<MetricCard label="Build" value="98.7%" width={220} />')
        expect(source.slice(row.openingEnd, row.closingStart!)).toContain('label="Issues"')
        expect(root.controls[0].value).toBe('A & B')
        expect(first.controls).toEqual(getComponentControls(source, 'MetricCard'))
        const updated = updateSceneControls(source, scene, second.id, { label: 'New issues', value: '3' })
        expect(updated).toContain('label="Build" value="98.7%"')
        expect(updated).toContain('label={"New issues"} value={"3"}')
        expect(updated).toContain("const setup = { title: 'Keep this setup' };")
        expect(updated).toContain('); // trailing comment')
    })

    it('rebuilds scalar controls after inline text editing and escapes new values', () => {
        const source = `<Panel title={'Say "hello" & C:\\\\tmp'} tone="purple" width={360} shadow />`
        const before = analyzeScene(source)
        const replacement = 'A "quoted" <value> & Unicode 🪄\nnext line'
        const updated = updateSceneControls(source, before, before.rootID, { title: replacement })
        const after = analyzeScene(updated)
        expect(after.instances[0].controls.find((control) => control.prop === 'title')?.value).toBe(replacement)
        expect(after.instances[0].controls.find((control) => control.prop === 'width')?.value).toBe(360)
        const final = updateSceneControls(updated, after, after.rootID, { width: 420, shadow: false })
        expect(final).toContain(`title={${JSON.stringify(replacement)}}`)
        expect(final).toContain('width={420} shadow={false}')
    })

    it('skips computed props and ambiguous or spread-overridden props without evaluating code', () => {
        const source = `<Scene>
  <Panel title={throwIfEvaluated()} width={sizes.width} tone="purple" shadow={true} />
  <Panel title="earlier" width={300} {...settings} shadow tone="green" />
  <Panel title="a" title="b" width={1_200} />
</Scene>`
        const panels = analyzeScene(source).instances.filter((instance) => instance.name === 'Panel')
        expect(panels[0].controls.map((control) => control.prop)).toEqual(['tone', 'shadow'])
        expect(panels[1].controls.map((control) => control.prop)).toEqual(['shadow', 'tone'])
        expect(panels[2].controls.map((control) => [control.prop, control.value])).toEqual([['width', 1200]])
        expect(() => updateSceneControls(source, analyzeScene(source), 'old-id', {})).toThrow('current scene snapshot')
    })

    it('reads braces and comments in strings and nested expressions without mixing controls', () => {
        const source = `<Scene title="Curly {braces} &quot;quotes&quot;">
  <Panel title={/* one */ 'a > b { } \\u{1F680}'} width={/* two */ +300} shadow={false}>
    {/* comment with <Panel /> */}
    <TextLabel text={'hello \\x26 goodbye'} fontSize={16} />
  </Panel>
</Scene>`
        const scene = analyzeScene(source)
        expect(scene.instances.map((instance) => instance.name)).toEqual(['Scene', 'Panel', 'TextLabel'])
        expect(scene.instances[1].controls.map((control) => control.value)).toEqual(['a > b { } 🚀', 300, false])
        expect(scene.instances[2].controls[0].value).toBe('hello & goodbye')
        expect(scene.instances[2].canRemove).toBe(true)
    })

    it('rejects mutations made with stale source or another snapshot', () => {
        const source = `<Scene><MetricCard label="First" value="1" /></Scene>`
        const scene = analyzeScene(source)
        const id = scene.instances[1].id
        expect(() => updateSceneControls(source.replace('First', 'Other'), scene, id, { value: '2' })).toThrow('scene changed')
        expect(() => duplicateSceneInstance(source + '\n', scene, id)).toThrow('scene changed')
        expect(() => removeSceneInstance(source, analyzeScene(source), id)).toThrow('current scene snapshot')
        expect(() => appendSceneComponent(source + ' ', scene, source, 'MetricCard')).toThrow('scene changed')
    })

    it('duplicates, removes, and reorders direct siblings while preserving setup and expressions', () => {
        const source = `width = 960
height = 480
const keep = [1, 2, 3];
<Scene>
  <Row>
    <MetricCard label="First" value="1" />
    <MetricCard label="Second" value="2" />
  </Row>
  {keep.length}
</Scene>`
        const scene = analyzeScene(source)
        const [first, second] = scene.instances.filter((instance) => instance.name === 'MetricCard')
        expect(first.canMoveDown).toBe(true)
        expect(first.canMoveUp).toBe(false)
        expect(second.canMoveUp).toBe(true)
        const reordered = moveSceneInstance(source, scene, second.id, 'up')
        expect(reordered.indexOf('label="Second"')).toBeLessThan(reordered.indexOf('label="First"'))
        expect(reordered).toContain('const keep = [1, 2, 3];')
        expect(reordered).toContain('{keep.length}')
        const duplicate = duplicateSceneInstance(source, scene, first.id)
        expect(analyzeScene(duplicate).instances.filter((instance) => instance.name === 'MetricCard')).toHaveLength(3)
        expect(duplicate.match(/label="First"/g)).toHaveLength(2)
        const removed = removeSceneInstance(source, scene, second.id)
        expect(removed).not.toContain('label="Second"')
        expect(removed).toContain('label="First"')
        expect(analyzeScene(removed).instances).toHaveLength(3)
    })

    it('protects the root and expression-generated components and does not move across comments', () => {
        const source = `<Scene>
  <MetricCard label="First" value="1" />
  {/* do not move this comment */}
  {items.map((item) => <MetricCard label="Template" value={item.value} />)}
  <MetricCard label="Last" value="3" />
</Scene>`
        const scene = analyzeScene(source)
        const [first, template, last] = scene.instances.filter((instance) => instance.name === 'MetricCard')
        expect(template.canDuplicate).toBe(false)
        expect(template.canRemove).toBe(false)
        expect(first.canMoveDown).toBe(false)
        expect(() => duplicateSceneInstance(source, scene, template.id)).toThrow('expression-generated')
        expect(() => removeSceneInstance(source, scene, scene.rootID)).toThrow('Keep the root component')
        expect(() => moveSceneInstance(source, scene, last.id, 'up')).toThrow('expressions or comments')
        expect(updateSceneControls(source, scene, template.id, { label: 'Renamed template' })).toContain('label={"Renamed template"}')
    })

    it('appends a catalog component inside containers and wraps a single root without losing metadata', () => {
        const example = `width = 800
height = 600
<Scene title="Example"><MetricCard label="Added" value="4" /></Scene>`
        const source = `width = 960
height = 480
<Scene title="Keep title">
  <Row gap={12}><TextLabel text="Keep me" /></Row>
</Scene> // keep suffix`
        const snapshot = analyzeScene(source)
        const appended = appendSceneComponent(source, snapshot, example, 'MetricCard')
        expect(appended).toContain('width = 960\nheight = 480')
        expect(appended).not.toContain('width = 800')
        expect(appended).toContain('<Scene title="Keep title">')
        expect(appended).toContain('<MetricCard label="Added" value="4" />')
        expect(appended).toContain('</Scene> // keep suffix')
        const row = snapshot.instances.find((instance) => instance.name === 'Row')!
        const nested = appendSceneComponent(source, snapshot, example, 'MetricCard', row.id)
        const nestedScene = analyzeScene(nested)
        expect(nestedScene.instances.find((instance) => instance.name === 'MetricCard')?.parentID)
            .toBe(nestedScene.instances.find((instance) => instance.name === 'Row')?.id)
        const single = 'width = 960\nheight = 480\n<MetricCard label="Root" value="1" />'
        const wrapped = appendSceneComponent(single, analyzeScene(single), example, 'MetricCard')
        const wrappedScene = analyzeScene(wrapped)
        expect(wrappedScene.instances[0].name).toBe('Scene')
        expect(wrappedScene.instances.filter((instance) => instance.name === 'MetricCard')).toHaveLength(2)
        expect(wrapped).toContain('width = 960\nheight = 480')
        const empty = '<Scene title="Empty" />'
        expect(appendSceneComponent(empty, analyzeScene(empty), example, 'MetricCard')).toContain('</Scene>')
    })

    it('keeps native SVG context when adding a drawing primitive', () => {
        const example = `<Scene><Column><svg width="400" height="200"><SvgPoint cx={20} cy={30} r={8} /></svg></Column></Scene>`
        const source = '<Scene />'
        const result = appendSceneComponent(source, analyzeScene(source), example, 'SvgPoint')
        expect(result).toContain('<svg width="400" height="200"><SvgPoint cx={20} cy={30} r={8} /></svg>')
        expect(analyzeScene(result).instances.map((instance) => instance.name)).toEqual(['Scene', 'svg', 'SvgPoint'])
    })

    it('keeps the catalog wrapper for helper calls and expression-based components', () => {
        const source = '<Scene />'
        const snapshot = analyzeScene(source)
        const math = `<Scene><Column><TextLabel text={MathText({ text: 'x_i' })} /></Column></Scene>`
        const result = appendSceneComponent(source, snapshot, math, 'MathText')
        expect(result).toContain(`<Column><TextLabel text={MathText({ text: 'x_i' })} /></Column>`)
        const watermark = `<Scene><Row>{wrapWithWatermark(<MetricCard label="Report" value="42" />, 640, 320, 'dark', <Watermark text="Vizmatic" />)}</Row></Scene>`
        const watermarked = appendSceneComponent(source, snapshot, watermark, 'Watermark')
        expect(watermarked).toContain(`<Row>{wrapWithWatermark(<MetricCard label="Report" value="42" />, 640, 320, 'dark', <Watermark text="Vizmatic" />)}</Row>`)
        expect(() => appendSceneComponent(source, snapshot, math, 'Missing')).toThrow('TSX source editing')
    })

    it('preserves multiline string expressions when wrapping and adding components', () => {
        const original = '<TextLabel text={`first line\n  literal indentation\nlast line`} />'
        const example = '<Scene><CodeBlock title="Added" lines={[{ text: `line one\n  keep spaces` }]} /></Scene>'
        const result = appendSceneComponent(original, analyzeScene(original), example, 'CodeBlock')
        expect(result).toContain(original)
        expect(result).toContain('<CodeBlock title="Added" lines={[{ text: `line one\n  keep spaces` }]} />')
        expect(analyzeScene(result).instances.map((instance) => instance.name)).toEqual(['Scene', 'TextLabel', 'CodeBlock'])
    })
})
