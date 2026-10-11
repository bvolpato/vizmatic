import React from 'react'
import { Resvg } from '@resvg/resvg-js'
import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import { Board, CanvasItem } from '../src/primitives/board'
import { getThemeColors } from '../src/theme'
import { createPlaygroundApi } from '../src/playground-api'
import { readPlaygroundProject, writePlaygroundProject, projectFilename, type PlaygroundProject } from '../src/playground-project'
import { snapCanvasValue } from '../src/playground-canvas-editor'
import { analyzeScene, appendSceneComponent, duplicateSceneInstance, moveSceneInstance, removeSceneInstance, setSceneLiteralProps } from '../src/playground-scene'
import { mapPlaygroundText, prepareEditableText, editableCanvasItems } from '../src/playground-text-mapping'
import { preparePlaygroundSource } from '../src/playground-source'
import { satori, type SatoriNode } from '../src/satori'

function prepare(source: string) {
    const mapping = mapPlaygroundText(source)
    const prepared = preparePlaygroundSource(mapping.source)
    const c = getThemeColors('dark')
    const api = createPlaygroundApi(c)
    const code = transform(`const render = () => {\n${prepared.setup}\nreturn (${prepared.jsx});\n};`, { transforms: ['typescript', 'jsx'], production: true }).code
    const element = Function('React', 'c', ...Object.keys(api), `${code}\nreturn render();`)(React, c, ...Object.values(api)) as React.ReactNode
    return prepareEditableText(element, mapping)
}

describe('playground project files', () => {
    const project: PlaygroundProject = {
        format: 'vizmatic', version: 1, name: 'Quarterly charts 🪄',
        source: 'width = 640\r\nheight = 360\r\n<Board><CanvasItem x={24} y={40}><div>A &amp; B</div></CanvasItem></Board>\r\n',
        theme: 'light', background: 'theme',
    }

    it('round-trips source bytes and presentation settings through a portable project file', () => {
        const text = writePlaygroundProject(project)
        expect(readPlaygroundProject(text)).toEqual(project)
        expect(readPlaygroundProject(JSON.stringify({ ...project, ignored: 'not part of the project contract' }))).toEqual(project)
        expect(projectFilename('  ../Quarterly charts 🪄 /  ')).toBe('Quarterly-charts.vizmatic.json')
        expect(projectFilename('🪄')).toBe('vizmatic-project.vizmatic.json')
    })

    it('rejects invalid JSON, unsupported versions, missing fields, and oversized payloads', () => {
        expect(() => readPlaygroundProject('{')).toThrow('not valid JSON')
        expect(() => readPlaygroundProject('null')).toThrow('Choose a Vizmatic project file')
        expect(() => readPlaygroundProject(JSON.stringify({ ...project, version: 2 }))).toThrow('not supported')
        for (const replacement of [{ source: ' ' }, { theme: 'system' }, { background: 'blue' }, { name: 'x'.repeat(121) }, { source: 'x'.repeat(500_001) }]) {
            expect(() => readPlaygroundProject(JSON.stringify({ ...project, ...replacement }))).toThrow('must include')
        }
        expect(() => readPlaygroundProject(' '.repeat(600_001))).toThrow('smaller than 600 KB')
        expect(() => writePlaygroundProject({ ...project, source: '🪄'.repeat(150_000) })).toThrow('smaller than 600 KB')
    })
})

describe('canvas snapping', () => {
    it('snaps to the closest grid line while respecting exact canvas boundaries', () => {
        expect(snapCanvasValue(43, 8, 0, 640)).toBe(40)
        expect(snapCanvasValue(44, 8, 0, 640)).toBe(48)
        expect(snapCanvasValue(-9, 8, 0, 640)).toBe(0)
        expect(snapCanvasValue(639, 8, 0, 635)).toBe(635)
        expect(snapCanvasValue(7, 8, 40, 640)).toBe(40)
        expect(snapCanvasValue(43.6, 1, 0, 640)).toBe(44)
    })
})

describe('Board geometry and editable source mapping', () => {
    it('supplies child dimensions and rejects non-renderable canvas geometry', () => {
        const item = CanvasItem({ x: 24, y: 40, width: 120, height: 64, children: <svg width={12} height={12} /> })
        const props = item.props as { children: React.ReactNode; style: React.CSSProperties }
        const child = React.Children.toArray(props.children)[0] as React.ReactElement<{ width: number; height: number }>
        expect(child.props).toMatchObject({ width: 120, height: 64 })
        expect(props.style).toMatchObject({ position: 'absolute', left: 24, top: 40, width: 120, height: 64 })
        expect(() => CanvasItem({ x: NaN, y: 0 })).toThrow('x and y must be finite')
        expect(() => CanvasItem({ x: 0, y: 0, height: 0 })).toThrow('CanvasItem height')
        expect(() => Board({ c: getThemeColors('dark'), width: 8193 })).toThrow('Board width')
    })

    it('maps source spans to actual rendered item bounds and pixels', async () => {
        const source = `width = 640
height = 360
<Board width={640} height={360}>
  <CanvasItem x={24} y={40} width={120} height={64}><svg><rect width={120} height={64} fill="#ff0000" /></svg></CanvasItem>
  <CanvasItem x={200} y={100} width={80} height={40}><svg><rect width={80} height={40} fill="#00ff00" /></svg></CanvasItem>
</Board>`
        const editable = prepare(source)
        const nodes: SatoriNode[] = []
        const svg = await satori(editable.element as React.ReactElement, { width: 640, height: 360, fonts: [], onNodeDetected: (node) => nodes.push(node) })
        const targets = editableCanvasItems(nodes, editable.canvasItems)
        expect(targets.map(({ x, y, left, top, width, height }) => ({ x, y, left, top, width, height }))).toEqual([
            { x: 24, y: 40, left: 24, top: 40, width: 120, height: 64 },
            { x: 200, y: 100, left: 200, top: 100, width: 80, height: 40 },
        ])
        expect(targets.map((target) => source.slice(target.sourceStart, target.sourceEnd))).toEqual([
            '<CanvasItem x={24} y={40} width={120} height={64}><svg><rect width={120} height={64} fill="#ff0000" /></svg></CanvasItem>',
            '<CanvasItem x={200} y={100} width={80} height={40}><svg><rect width={80} height={40} fill="#00ff00" /></svg></CanvasItem>',
        ])
        const image = new Resvg(svg).render()
        const rgba = (x: number, y: number) => [...image.pixels.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)]
        expect(rgba(24, 40)).toEqual([255, 0, 0, 255])
        expect(rgba(143, 103)).toEqual([255, 0, 0, 255])
        expect(rgba(23, 40)[3]).toBe(0)
        expect(rgba(200, 100)).toEqual([0, 255, 0, 255])
    })

    it('keeps computed, spread-overridden, and expression-generated item geometry read-only', () => {
        const source = `const x = 24;
<Board>
 <CanvasItem x={x} y={40} width={120} height={64}><svg /></CanvasItem>
 <CanvasItem x={24} y={40} width={120} {...{x: 32}}><svg /></CanvasItem>
 <CanvasItem x={24} y={40} width={120 + 1}><svg /></CanvasItem>
 {[1, 2].map((index) => <CanvasItem x={24} y={40} width={120} height={64}><svg /></CanvasItem>)}
 <CanvasItem x={24} y={40} width={120} height={64}><svg /></CanvasItem>
</Board>`
        const editable = prepare(source)
        expect(editable.canvasItems.size).toBe(1)
        expect([...editable.canvasItems.values()][0].sourceStart).toBe(source.lastIndexOf('<CanvasItem'))
        const scene = analyzeScene(source)
        const computed = scene.instances.find((instance) => instance.name === 'CanvasItem')!
        expect(() => setSceneLiteralProps(source, scene, computed.id, { x: 32 })).toThrow('computed')
    })

    it('duplicates, removes, and reorders a whole Board item when its content is selected', () => {
        const source = `<Board>
  <CanvasItem x={24} y={40}><Column><MetricCard label="First" value="1" /><TextLabel text="Keep with first" /></Column></CanvasItem>
  <CanvasItem x={200} y={100}><MetricCard label="Second" value="2" /></CanvasItem>
</Board>`
        const scene = analyzeScene(source)
        const first = scene.instances.find((instance) => instance.name === 'MetricCard')!
        const duplicated = duplicateSceneInstance(source, scene, first.id)
        expect(analyzeScene(duplicated).instances.filter((instance) => instance.name === 'CanvasItem')).toHaveLength(3)
        expect(duplicated.match(/Keep with first/g)).toHaveLength(2)
        const removed = removeSceneInstance(source, scene, first.id)
        expect(removed).not.toContain('Keep with first')
        expect(analyzeScene(removed).instances.map((instance) => instance.name)).toEqual(['Board', 'CanvasItem', 'MetricCard'])
        const moved = moveSceneInstance(source, scene, first.id, 'down')
        expect(moved.indexOf('label="Second"')).toBeLessThan(moved.indexOf('label="First"'))
        expect(moved.indexOf('Keep with first')).toBeGreaterThan(moved.indexOf('label="First"'))
    })

    it('inserts a catalog CanvasItem into a Board without adding another position wrapper', () => {
        const source = '<Board />'
        const example = '<Board><CanvasItem x={24} y={40} width={120} height={64}><MetricCard label="A" value="1" /></CanvasItem></Board>'
        const added = appendSceneComponent(source, analyzeScene(source), example, 'CanvasItem')
        expect(analyzeScene(added).instances.map((instance) => instance.name)).toEqual(['Board', 'CanvasItem', 'MetricCard'])
        expect(added).toContain('x={24} y={40} width={120} height={64}')
    })
})
