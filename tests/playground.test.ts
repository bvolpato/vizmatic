import { describe, expect, it } from 'vitest'
import { preparePlaygroundSource } from '../src/playground-source'
import { playgroundTemplates } from '../src/playground-templates'

describe('playground source preparation', () => {
    it('extracts metadata while preserving setup code and root JSX', () => {
        const prepared = preparePlaygroundSource(`width = 1200
height = 700
preset = "engineering"

const stages = [{ title: "Prompt", tone: "blue" }]

<Scene>
  <Flow stages={stages} />
</Scene>`)

        expect(prepared.metadata).toEqual({
            width: 1200,
            height: 700,
            preset: 'engineering',
            warnings: [],
        })
        expect(prepared.setup).toContain('const stages')
        expect(prepared.jsx).toMatch(/^<Scene>/)
    })

    it('keeps helper JSX and nested metadata out of frame metadata', () => {
        const prepared = preparePlaygroundSource(`/*
width = 120
preset = "missing"
*/
function Helper() {
  const width = 200
  const preset = "missing"
  return (
    <Panel title="Helper">
      <CalloutCard title="Nested" detail="Ordinary setup variables" tone="blue" />
    </Panel>
  )
}

<Scene>
  {1 < 2 ? <Helper /> : null}
</Scene>`)

        expect(prepared.metadata).toEqual({
            width: 960,
            height: 540,
            preset: 'default',
            warnings: [],
        })
        expect(prepared.setup).toContain('const width = 200')
        expect(prepared.setup).toContain('<Panel title="Helper">')
        expect(prepared.jsx).toMatch(/^<Scene>/)
    })

    it('isolates snippets from imports and unsafe dimensions', () => {
        expect(() => preparePlaygroundSource(`import data from "./private.json"
<Scene />`)).toThrow('cannot use imports')
        expect(() => preparePlaygroundSource(`const module = import("https://example.com/code.js")
<Scene />`)).toThrow('cannot load dynamic imports')
        expect(() => preparePlaygroundSource(`const module = import /* bypass */ ("https://example.com/code.js")
<Scene />`)).toThrow('cannot load dynamic imports')
        expect(() => preparePlaygroundSource(`width = 9000
<Scene />`)).toThrow('width must be an integer from 1 to 8192')
    })

    it('falls back from unknown presets and keeps every template valid', () => {
        const fallback = preparePlaygroundSource(`preset = "missing"
<Scene />`)
        expect(fallback.metadata.preset).toBe('default')
        expect(fallback.metadata.warnings[0]).toContain('Unknown preset')

        expect(playgroundTemplates.length).toBeGreaterThanOrEqual(3)
        for (const template of playgroundTemplates) {
            expect(() => preparePlaygroundSource(template.source)).not.toThrow()
        }
    })
})
