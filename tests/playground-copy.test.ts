import { describe, expect, it } from 'vitest'
import { copySceneBlock } from '../src/playground-copy'
import { analyzeScene } from '../src/playground-scene'

describe('standalone playground block copying', () => {
    it('copies an edited chart with its CanvasItem geometry and original Board settings', () => {
        const source = `width = 840
height = 520
preset = "engineering"
themeColors = {"primary":"#0055cc","bg":"#f5f7fa"}
const boardPalette = { primary: '#123456' };
const boardFill = '#fefefe';
<Board width={840} height={520} c={boardPalette} background={boardFill}>
  <CanvasItem x={71} y={46} width={460} height={330}>
    <PieChart title="Edited mix" segments={[{ label: 'A', value: 8 }, { label: 'B', value: 3 }]} showLegend={false} />
  </CanvasItem>
  <CanvasItem x={560} y={90} width={200} height={200}><TextLabel text="Leave out" /></CanvasItem>
</Board> // preserve suffix`
        const original = analyzeScene(source)
        const chart = original.instances.find((instance) => instance.name === 'PieChart')!
        const copied = copySceneBlock(original, chart.id)!

        expect(copied).toContain('width = 840\nheight = 520\npreset = "engineering"')
        expect(copied).toContain('themeColors = {"primary":"#0055cc","bg":"#f5f7fa"}')
        expect(copied).toContain("const boardPalette = { primary: '#123456' };")
        expect(copied).toContain("const boardFill = '#fefefe';")
        expect(copied).toContain('<Board width={840} height={520} c={boardPalette} background={boardFill}>')
        expect(copied).toContain('<CanvasItem x={71} y={46} width={460} height={330}>')
        expect(copied).toContain('title="Edited mix" segments={[{ label: \'A\', value: 8 }, { label: \'B\', value: 3 }]} showLegend={false}')
        expect(copied).not.toContain('Leave out')
        expect(copied).toContain('</Board> // preserve suffix')

        const roundTrip = analyzeScene(copied)
        expect(roundTrip.instances.map((instance) => instance.name)).toEqual(['Board', 'CanvasItem', 'PieChart'])
        expect(copied.slice(roundTrip.instances[1].start, roundTrip.instances[1].end))
            .toBe(source.slice(original.instances[1].start, original.instances[1].end))
    })

    it('copies the enclosing CanvasItem when a nested canvas descendant is selected', () => {
        const source = `const title = 'current title';
<Board width={600} height={400}>
  <CanvasItem x={12} y={23} width={300} height={180}>
    <Card title={title}><TextLabel text={title} /></Card>
  </CanvasItem>
</Board>`
        const scene = analyzeScene(source)
        const selected = scene.instances.find((instance) => instance.name === 'TextLabel')!
        const copied = copySceneBlock(scene, selected.id)!

        expect(copied).toContain("const title = 'current title';")
        expect(copied).toContain('<CanvasItem x={12} y={23} width={300} height={180}>')
        expect(copied).toContain('<Card title={title}><TextLabel text={title} /></Card>')
        expect(analyzeScene(copied).instances.map((instance) => instance.name)).toEqual(['Board', 'CanvasItem', 'Card', 'TextLabel'])
    })

    it('copies a non-canvas selection as the new root while retaining setup dependencies', () => {
        const source = `width = 720
height = 420
preset = "default"
const message = 'setup dependency';
<Scene><Column gap={12}><TextLabel text={message} /></Column></Scene>`
        const scene = analyzeScene(source)
        const label = scene.instances.find((instance) => instance.name === 'TextLabel')!
        const copied = copySceneBlock(scene, label.id)!

        expect(copied).toContain('width = 720\nheight = 420\npreset = "default"')
        expect(copied).toContain("const message = 'setup dependency';")
        expect(copied).toMatch(/<TextLabel text=\{message\}\s*\/>$/)
        expect(analyzeScene(copied).instances.map((instance) => instance.name)).toEqual(['TextLabel'])
    })

    it('returns the full original frame for the root and refuses unsafe or missing selections', () => {
        const complete = `const values = [1, 2];
<Scene>{values.map((value) => <TextLabel text={value} />)}</Scene> // keep source`
        const scene = analyzeScene(complete)
        const generated = scene.instances.find((instance) => instance.name === 'TextLabel')!

        expect(copySceneBlock(scene, scene.rootID)).toBe(complete)
        expect(copySceneBlock(scene, generated.id)).toBeUndefined()
        expect(copySceneBlock(scene, 'missing-selection')).toBeUndefined()
    })
})
