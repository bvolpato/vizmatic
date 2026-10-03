import React from 'react'
import { transform } from 'sucrase'
import { describe, expect, it } from 'vitest'
import { getThemeColors, Scene } from 'vizmatic'
import { toPlaygroundExample } from '../scripts/playground-example'
import { preparePlaygroundSource } from '../src/playground-source'

function prepareAndEvaluate(source: string, theme: 'dark' | 'light') {
    const prepared = preparePlaygroundSource(toPlaygroundExample(source))
    const wrapped = `const __render = () => {\n${prepared.setup}\nreturn (\n${prepared.jsx}\n);\n};\nreturn __render();`
    const compiled = transform(wrapped, {
        transforms: ['typescript', 'jsx'],
        jsxPragma: 'React.createElement',
    }).code
    const render = Function('React', 'c', 'getThemeColors', 'Scene', compiled) as (
        react: typeof React,
        colors: ReturnType<typeof getThemeColors>,
        themeColors: typeof getThemeColors,
        scene: typeof Scene,
    ) => React.ReactElement

    return {
        prepared,
        element: render(React, getThemeColors(theme), getThemeColors, Scene),
    }
}

function fragmentChild(element: React.ReactElement): React.ReactElement {
    return (element.props as { children: React.ReactElement }).children
}

describe('trusted playground example adaptation', () => {
    it('adapts a module with helper JSX, local dimensions, and the selected theme', () => {
        const source = `import React from 'react'
import { getThemeColors, Scene, type ThemeMode } from 'vizmatic'

export const width = 640
export const height = 360

function contentHeight() {
    return height - 40
}

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)
    return <Scene c={c} title={theme} width={width} height={contentHeight()} />
}

export default create('dark')
`

        const adapted = toPlaygroundExample(source)
        expect(adapted).toMatch(/^width = 640\nheight = 360\nconst __vizmaticExampleTheme/)
        expect(adapted).not.toContain('import React')
        expect(adapted).not.toContain('export function')

        const { prepared, element } = prepareAndEvaluate(source, 'light')
        const scene = fragmentChild(element)
        expect(prepared.metadata).toMatchObject({ width: 640, height: 360 })
        expect(prepared.setup).toContain('const width = 640')
        expect(prepared.setup).toContain('const height = 360')
        expect(scene.props as Record<string, unknown>).toMatchObject({ title: 'light', width: 640, height: 320 })
    })

    it('keeps the static create fallback and removes exported animation APIs', () => {
        const source = `import { getThemeColors, Scene, type ThemeMode } from 'vizmatic'

export const width = 420
export const height = 240

function frame(theme: ThemeMode) {
    const c = getThemeColors(theme)
    return <Scene c={c} title="Static fallback" />
}

export function create(theme: ThemeMode = 'dark') {
    return frame(theme)
}

export function createScenes(theme: ThemeMode) {
    return [{ element: frame(theme), duration: 200 }]
}

export function createAnimation(theme: ThemeMode) {
    return { theme }
}

export default create('dark')
`

        const adapted = toPlaygroundExample(source)
        expect(adapted).not.toMatch(/\bcreateScenes\b/)
        expect(adapted).not.toMatch(/\bcreateAnimation\b/)

        const { prepared, element } = prepareAndEvaluate(source, 'dark')
        const scene = fragmentChild(element)
        expect(prepared.metadata).toMatchObject({ width: 420, height: 240 })
        expect((scene.props as { title: string }).title).toBe('Static fallback')
    })

    it('leaves bare snippets byte-for-byte unchanged and refuses external imports', () => {
        const snippet = 'width = 400\nheight = 240\n<Scene />\n'
        expect(toPlaygroundExample(snippet)).toBe(snippet)
        expect(() => toPlaygroundExample(`import x from 'https://example.com/x.js'\n${snippet}`))
            .toThrow('can only import from "vizmatic" or "react"')
    })
})
