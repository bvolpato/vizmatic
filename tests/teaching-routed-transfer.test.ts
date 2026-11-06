import { describe, expect, it } from 'vitest'
import type { CanvasBounds, CanvasPoint } from '../src/canvas-components'
import type { TeachingPainter } from '../src/teaching-canvas'
import { createTeachingRoutedTransfer, planTeachingRoutedTransfer, type TeachingRoutedTransferOptions } from '../src/teaching-routed-transfer'

const source = { id: 'owner-B', shape: { x: 80, y: 45, width: 48, height: 48, auditId: 41 }, opacity: 1 }
const target = { id: 'rank-2-B', shape: { x: 80, y: 405, width: 48, height: 48, auditId: 42 }, opacity: 1 }
const settled = { id: 'rank-0-B', bounds: { x: 70, y: 210, width: 68, height: 68 } }
const options: TeachingRoutedTransferOptions<typeof source.shape> = {
    id: 'broadcast-B-to-rank-2', source, target,
    corridor: { x: 0, y: 0, width: 420, height: 520 }, obstacles: [settled],
    width: 4, margin: 3, progress: 0.5, marker: { radius: 12, stroke: '#fff', strokeWidth: 4 },
}

function distanceToBox(p: CanvasPoint, box: CanvasBounds): number {
    return Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.width), Math.max(box.y - p.y, 0, p.y - box.y - box.height))
}

function host() {
    const events: { kind: string, alpha: number, [key: string]: unknown }[] = []
    let alpha = 1
    const painter: TeachingPainter<typeof source.shape> = {
        target(id, draw) { events.push({ kind: 'target', alpha, id }); return draw() },
        rect(x,y,width,height,_fill,_stroke,radius) { return {x,y,width,height,radius,auditId:99} },
        text(value,x,y,size,color,align) { events.push({kind:'text',alpha,value,x,y,size,color,align}) },
        math() {}, line() {}, arrow() {},
        path(points, style) { events.push({ kind: 'path', alpha, points, style }) },
        circle(x,y,radius,fill,stroke,width) { events.push({kind:'circle',alpha,x,y,radius,fill,stroke,width}) },
        connect() { throw new Error('A routed transfer must use the checked polyline path') },
        container(_bounds, draw) { draw() }, labelScope(_bounds, draw) { draw() },
        opacity(value, draw) { const old=alpha;alpha*=value;try{draw()}finally{alpha=old} },
    }
    return {painter,events,alpha:()=>alpha}
}

describe('semantic routed teaching transfers', () => {
    it('routes around completed replicas with whole-marker clearance and stable identity', () => {
        const route = planTeachingRoutedTransfer(options)
        expect(route.source).toBe(source)
        expect(route.target).toBe(target)
        expect(route.source.shape.auditId).toBe(41)
        expect(route.clearance).toBe(17)
        expect(route.points).toEqual(planTeachingRoutedTransfer(options).points)
        expect(route.length).toBeGreaterThan(312)
        expect(Object.isFrozen(route.points)).toBe(true)
        for(let i=0;i<route.points.length;i++) {
            expect(Object.isFrozen(route.points[i])).toBe(true)
            if(i) expect(route.points[i]!.x===route.points[i-1]!.x || route.points[i]!.y===route.points[i-1]!.y).toBe(true)
        }
        // Independent Euclidean footprint checks include the first and last
        // marker centers, not only the turns chosen by the router.
        for(let i=0;i<=2000;i++) {
            const p=route.positionAt(i/2000)
            for(const box of [source.shape,target.shape,settled.bounds]) expect(distanceToBox(p,box)).toBeGreaterThanOrEqual(17)
            expect(p.x-17).toBeGreaterThanOrEqual(0)
            expect(p.x+17).toBeLessThanOrEqual(420)
            expect(p.y-17).toBeGreaterThanOrEqual(0)
            expect(p.y+17).toBeLessThanOrEqual(520)
        }
        expect(route.positionAt(-1)).toEqual(route.positionAt(0))
        expect(route.positionAt(2)).toEqual(route.positionAt(1))
    })

    it('replans translated scenes without depending on canvas origin', () => {
        const base=planTeachingRoutedTransfer(options)
        const shift=(b:CanvasBounds)=>({...b,x:b.x-500,y:b.y+200})
        const moved=planTeachingRoutedTransfer({...options, source:{...source,shape:{...shift(source.shape),auditId:41}},target:{...target,shape:{...shift(target.shape),auditId:42}},corridor:shift(options.corridor),obstacles:options.obstacles.map(o=>({...o,bounds:shift(o.bounds)}))})
        expect(moved.points).toHaveLength(base.points.length)
        moved.points.forEach((point,i)=>{expect(point.x).toBeCloseTo(base.points[i]!.x-500,6);expect(point.y).toBeCloseTo(base.points[i]!.y+200,6)})
        expect(moved.length).toBeCloseTo(base.length)
    })

    it('rejects a marker that cannot fit even when a thin centerline can cross the gap', () => {
        const small={id:'gap',source:{id:'left',shape:{x:30,y:70,width:30,height:20},opacity:1},target:{id:'right',shape:{x:540,y:70,width:30,height:20},opacity:1},corridor:{x:0,y:0,width:600,height:160},obstacles:[{id:'ceiling',bounds:{x:220,y:0,width:160,height:60}},{id:'floor',bounds:{x:220,y:100,width:160,height:60}}],width:2,margin:2,progress:.5,marker:{radius:4}}
        expect(planTeachingRoutedTransfer(small).length).toBeGreaterThan(0)
        expect(()=>planTeachingRoutedTransfer({...small,marker:{radius:20,stroke:'#fff',strokeWidth:4}})).toThrow('Cannot route transfer gap')
        expect(()=>planTeachingRoutedTransfer({...small,width:44,progress:undefined,marker:undefined})).toThrow('Cannot route transfer gap')
    })

    it('throws an identified failure before painting when an obstacle seals the corridor', () => {
        const h=host(),transfer=createTeachingRoutedTransfer(h.painter)
        expect(()=>transfer({...options,obstacles:[{id:'sealed-row',bounds:{x:0,y:220,width:420,height:70}}]})).toThrow(/broadcast-B-to-rank-2.*owner-B.*rank-2-B/)
        expect(h.events).toEqual([])
    })

    it('preserves checked path IDs, focus metadata, shape references and nested opacity', () => {
        const h=host(),transfer=createTeachingRoutedTransfer(h.painter)
        let route:ReturnType<typeof transfer>=null
        h.painter.opacity(.8,()=>{route=transfer({...options,source:{...source,opacity:.6},target:{...target,opacity:.4},opacity:.9,focusTarget:'active-broadcast'})})
        expect(h.events[0]).toMatchObject({kind:'target',id:'active-broadcast'})
        const path=h.events.find(e=>e.kind==='path')!,marker=h.events.find(e=>e.kind==='circle')!
        expect(path.style).toMatchObject({id:'broadcast-B-to-rank-2:route',width:4})
        expect(path.points).toBe(route!.points)
        expect(route!.source.shape).toBe(source.shape)
        expect(path.alpha).toBeCloseTo(.8*.4)
        expect(marker.alpha).toBe(path.alpha)
        expect(marker).toMatchObject({...route!.positionAt(.5),radius:12,stroke:'#fff',width:4})
        expect(h.alpha()).toBe(1)
        h.events.length=0
        expect(transfer({...options,target:{...target,opacity:0}})).toBeNull()
        expect(h.events).toEqual([])
    })

    it('validates identities, geometry, styles and progress instead of silently changing the contract', () => {
        expect(()=>planTeachingRoutedTransfer({...options,target:{...target,id:source.id}})).toThrow('IDs must differ')
        expect(()=>planTeachingRoutedTransfer({...options,obstacles:[{...settled,id:source.id}]})).toThrow('Duplicate')
        expect(()=>planTeachingRoutedTransfer({...options,corridor:{...options.corridor,width:0}})).toThrow('positive')
        expect(()=>planTeachingRoutedTransfer({...options,width:0})).toThrow('positive')
        expect(()=>planTeachingRoutedTransfer({...options,margin:-1})).toThrow('nonnegative')
        expect(()=>planTeachingRoutedTransfer({...options,progress:NaN})).toThrow('finite')
        expect(()=>planTeachingRoutedTransfer({...options,progress:undefined})).toThrow('requires progress')
        expect(()=>planTeachingRoutedTransfer(options).positionAt(Infinity)).toThrow('finite')
    })
})
