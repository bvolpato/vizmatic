import { describe, expect, it } from 'vitest'
import { evaluateSceneSource } from '../src/scene-runtime'

const scene = { width: 760, height: 420, duration: 2, fps: 25, theme: 'dark' as const }

describe('scientific scene expansion boundaries', () => {
    it.each([
        ['wave samples', '<WaveDiagram waves={[{amplitude:1,wavelength:4}]} time={0} xMin={0} xMax={4} sampleCount={200000}/>', 'sampleCount'],
        ['molecule atoms', '<MoleculeDiagram atoms={Array.from({length:65},(_,i)=>({id:String(i),element:"C",x:i,y:0}))} bonds={[]}/>', 'atoms'],
        ['geometry segments', '<GeometryDiagram points={[{id:"a",x:0,y:0},{id:"b",x:1,y:0}]} segments={Array.from({length:257},()=>({from:"a",to:"b"}))}/>', 'segments'],
        ['attention rows', '<AttentionMatrix weights={Array.from({length:33},()=>[1])}/>', 'weights'],
    ])('rejects excessive %s before trusted rendering', async (_name, source, diagnostic) => {
        await expect(evaluateSceneSource({ ...scene, source })).rejects.toThrow(diagnostic)
    })

    it('preserves deterministic scene state when scientific frames are sought out of order', async () => {
        const source = '<WaveDiagram waves={[{amplitude:1,wavelength:4,phase:progress*Math.PI}]} time={time} xMin={-4} xMax={4}/>'
        const middle = await evaluateSceneSource({ ...scene, source, time: 0.75 })
        await evaluateSceneSource({ ...scene, source, time: 1.5 })
        const repeated = await evaluateSceneSource({ ...scene, source, time: 0.75 })
        expect(repeated.graph).toEqual(middle.graph)
        expect(repeated.inputSha256).toBe(middle.inputSha256)
    })
})
