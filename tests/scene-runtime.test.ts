import { describe, expect, it } from 'vitest'
import { evaluateSceneSource, prepareScene, SCENE_LIMITS, validateSceneGraph } from '../src/scene-runtime'
import type { SceneFrameRequest } from '../src/scene-contract'

const request = (source: string, extra: Partial<SceneFrameRequest> = {}): SceneFrameRequest => ({
    source, width: 320, height: 180, duration: 2, fps: 24, ...extra,
})

describe('editable scene evaluation', () => {
    it.each([
        '<svg><rect width={width} height={height} /></svg>',
        '<div style={{display:"flex"}}>Native root</div>',
        '(\n (<svg><circle cx={10} cy={10} r={4}/></svg>)\n)',
        'function Mark() { return <rect width={5} height={9}/> }\nconst y = 6;\n<svg><Mark/><circle cy={y}/></svg>',
        '<Scene title="Trusted component"><Row><Badge label="Ready" /></Row></Scene>',
    ])('accepts native roots, local JSX helper functions and Vizmatic components', async (source) => {
        expect((await evaluateSceneSource(request(source))).graph).toBeTruthy()
    })

    it('supplies seconds, exact frame context, named cues and easing helpers', async () => {
        const evaluated = await evaluateSceneSource(request('<div>{JSON.stringify({time,t,duration,progress,frame,fps,width,height,theme,p:cue("first-beat",2),e:ease(0.5),v:lerp(0,10,0.5)})}</div>', {
            time: 1, cues: { 'first-beat': 0 },
        }))
        expect(evaluated.graph).toMatchObject({ children: [JSON.stringify({
            time: 1, t: 1, duration: 2, progress: 0.5, frame: 24, fps: 24,
            width: 320, height: 180, theme: 'dark', p: 0.5, e: 0.5, v: 5,
        })] })
        await expect(evaluateSceneSource(request('<div>{cue("missing")}</div>'))).rejects.toThrow('Unknown scene cue: missing')
    })

    it('is deterministic for a seed and independent of previous frames', async () => {
        const prepared = await prepareScene(request('globalThis.counter = (globalThis.counter ?? 0) + 1;\n<div>{JSON.stringify([Math.random(),Math.random(),globalThis.counter,typeof Date,typeof performance])}</div>', { seed: 42 }))
        const first = await prepared.evaluate(0.5)
        await prepared.evaluate(1)
        const repeated = await prepared.evaluate(0.5)
        expect(first).toEqual(repeated)
        expect(first.graph).toMatchObject({ children: [expect.stringContaining(',1,"undefined","undefined"]')] })
    })

    it('hashes exact source and semantic parameters while canonicalizing cue order', async () => {
        const source = '<div>{time}</div>'
        const first = await prepareScene(request(source, { cues: { b: 1, a: 0 } }))
        const reordered = await prepareScene(request(source, { cues: { a: 0, b: 1 } }))
        const changed = await prepareScene(request(source, { duration: 3, cues: { a: 0, b: 1 } }))
        const whitespace = await prepareScene(request(`${source}\n`, { cues: { a: 0, b: 1 } }))
        expect(first.inputSha256).toBe(reordered.inputSha256)
        expect(first.inputSha256).not.toBe(changed.inputSha256)
        expect(first.sourceSha256).not.toBe(whitespace.sourceSha256)
    })

    it.each([
        'import fs from "node:fs";\n<Scene/>',
        'const fs = import /* comment */ ("node:fs");\n<Scene/>',
        'export const secret = 1;\n<Scene/>',
    ])('rejects module syntax before execution', async (source) => {
        await expect(evaluateSceneSource(request(source))).rejects.toThrow('Imports and exports are disabled')
    })

    it('never installs Node, browser, network or host-function globals', async () => {
        const result = await evaluateSceneSource(request('const exposed = [typeof process,typeof require,typeof fetch,typeof window,typeof document,typeof self,typeof WebAssembly,typeof console];\n<div>{JSON.stringify(exposed)}</div>'))
        expect(result.graph).toMatchObject({ children: [JSON.stringify(Array(8).fill('undefined'))] })
        const constructorAttempt = await evaluateSceneSource(request('const probe = ({}).constructor.constructor("return typeof process")();\n<div>{probe}</div>'))
        expect(constructorAttempt.graph).toMatchObject({ children: ['undefined'] })
        await expect(evaluateSceneSource(request('const exposed = (async()=>{}).constructor("return process.env")();\n<div value={exposed}/>'))).rejects.toThrow('Async scene values are not supported')
    })

    it('rejects executable, async, unsafe and nonfinite values at the data boundary', async () => {
        for (const source of [
            '<div value={()=>process.env}/>', '<div value={Promise.resolve(1)}/>',
            '<div value={Infinity}/>', '<div value={BigInt(1)}/>',
            '<div {...JSON.parse(\'{"__proto__":{"bad":true}}\')}/>',
            '<div onClick="anything"/>', '<div dangerouslySetInnerHTML={{__html:"<script/>"}}/>',
            '<script>fetch("https://example.com")</script>', '<foreignObject/>',
        ]) await expect(evaluateSceneSource(request(source))).rejects.toThrow()
    })

    it.each([
        '<svg><use href="https://example.com/private"/></svg>',
        '<div style={{backgroundImage:"url(http://169.254.169.254/)"}}/>',
        '<div style={{backgroundImage:"u\\\\72l(http://localhost/)"}}/>',
        '<div style={{background:"url/**/(http://localhost/)"}}/>',
        '<svg><image href="file:///etc/passwd"/></svg>',
        '<div src="data:image/svg+xml,<svg/>"/>',
    ])('rejects external and obfuscated resources before trusted rendering', async (source) => {
        await expect(evaluateSceneSource(request(source))).rejects.toThrow()
    })

    it('allows local SVG references and ordinary source text containing URLs', async () => {
        expect((await evaluateSceneSource(request('<svg><defs><linearGradient id="water"><stop stopColor={c.info}/></linearGradient></defs><rect fill="url(#water)"/><use href="#water"/><text>https://example.com/source</text></svg>'))).graph).toBeTruthy()
    })

    it.each([
        '<DashedLine x1={0} y1={0} x2={100} y2={0} color="#fff" dotSpacing={0}/>',
        '<DashedLine x1={0} y1={0} x2={100} y2={0} color="#fff" dotSpacing={0.0001}/>',
        '<TileGrid tiles={[{title:"x"}]} columns={-1}/>',
        '<TileGrid tiles={[{title:"x"}]} columns="1000000000"/>',
        '<TiledMatrix rows={1000000000} cols={1000000000}/>',
        '<TiledMatrix rows={1000} cols={1000}/>',
        '<AxisPlot width={100} height={100} gridCount={1000000000}/>',
        '<TransformerTopology expandRepeats blocks={[{id:"x",kind:"custom",repeat:1000000000}]}/>',
        '<LayeredNetwork layers={Array.from({length:4},()=>({title:"Layer",nodes:Array(32).fill("x")}))}/>',
        '<ParetoChart points={Array.from({length:513},(_,x)=>({x,y:x}))}/>',
    ])('bounds expansion-driving props before any trusted component invocation', async (source) => {
        await expect(evaluateSceneSource(request(source))).rejects.toThrow(/Editable scene/)
    })

    it('returns bounded author error messages without invoking error getters', async () => {
        await expect(evaluateSceneSource(request('throw new Error("Check this cue");\n<div/>'))).rejects.toThrow('Check this cue')
        await expect(evaluateSceneSource(request('throw {get message(){while(true){}}};\n<div/>'))).rejects.toThrow('Scene evaluation failed')
    })

    it('interrupts loops, recursion, getters and allocation, then recovers', async () => {
        const started = Date.now()
        for (const source of [
            'while(true){}\n<div/>',
            'function recurse(){return recurse()}\nrecurse();\n<div/>',
            'const a=[];while(true){a.push("x".repeat(100000))}\n<div/>',
            'const trap={get value(){while(true){}}};\n<div value={trap}/>',
        ]) await expect(evaluateSceneSource(request(source))).rejects.toThrow()
        expect(Date.now() - started).toBeLessThan(5_000)
        expect((await evaluateSceneSource(request('<div>Recovered</div>'))).graph).toMatchObject({ children: ['Recovered'] })
    })

    it('enforces source, graph, canvas, duration and frame limits', async () => {
        await expect(evaluateSceneSource(request(' '.repeat(SCENE_LIMITS.sourceBytes) + '<div/>'))).rejects.toThrow('UTF-8 bytes')
        await expect(evaluateSceneSource(request('<div/>', { width: 1920, height: 1920 }))).rejects.toThrow('pixels')
        await expect(evaluateSceneSource(request('<div/>', { duration: 121 }))).rejects.toThrow('seconds')
        await expect(evaluateSceneSource(request('<div/>', { duration: 120, fps: 60 }))).rejects.toThrow('frames')
        await expect(evaluateSceneSource(request('<div>{Array.from({length:2001},()=> <span>Mark</span>)}</div>'))).rejects.toThrow('2000 elements')
        const nested = { kind: 'vizmatic.element', type: 'div', props: {}, children: [] as unknown[] }
        let current = nested
        for (let i = 0; i < 70; i++) {
            const child = { kind: 'vizmatic.element', type: 'div', props: {}, children: [] as unknown[] }
            current.children.push(child)
            current = child
        }
        expect(() => validateSceneGraph(nested)).toThrow('depth')
    })
})
