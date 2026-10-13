import React from 'react'
import { describe, expect, it } from 'vitest'
import { createPlaygroundApi } from '../src/playground-api'
import {
    readPlaygroundSettings,
    updatePlaygroundSettings,
} from '../src/playground-settings'
import { mergePlaygroundThemeColors } from '../src/frame-theme'
import { preparePlaygroundSource } from '../src/playground-source'

describe('playground source settings', () => {
    it('reads only preamble metadata and ignores assignments inside comments and setup', () => {
        const source = [
            '// preserve this comment',
            '/*',
            'width = 20',
            'themeColors = {"primary":"#ffffff"}',
            '*/',
            'width = 640; // canvas width',
            'preset = "engineering";',
            'themeColors = {"primary":"#123456","bg":"rgb(10, 20, 30)"};',
            'background = "theme";',
            'const note = "settings below are setup code"',
            'width = 720',
            '<Board />',
        ].join('\n')

        expect(readPlaygroundSettings(source)).toEqual({
            width: 640,
            height: 540,
            preset: 'engineering',
            themeColors: { primary: '#123456', bg: 'rgb(10, 20, 30)' },
            background: 'theme',
        })
    })

    it('keeps animation-first and typed or commented preset metadata aligned with rendering', () => {
        const source = [
            'animationDuration = 1',
            'animationFps = 2',
            'width = 320',
            'height = 180',
            '// preset: ThemePreset = "default"',
            'export const preset: ThemePreset = "engineering";',
            'themeColors = {"primary":"#ff0000"}',
            'background = "#ffffff"',
            '<Board width={320} height={180} />',
        ].join('\n')
        const updated = updatePlaygroundSettings(source, {
            themeColors: { primary: '#0000ff' },
            background: '#000000',
        })
        const settings = readPlaygroundSettings(updated)
        const prepared = preparePlaygroundSource(updated).metadata

        expect(updated.indexOf('animationFps')).toBeLessThan(updated.indexOf('themeColors'))
        expect(settings).toMatchObject({
            width: 320,
            height: 180,
            preset: 'engineering',
            themeColors: { primary: '#0000ff' },
            background: '#000000',
        })
        expect(prepared).toMatchObject({
            width: settings.width,
            height: settings.height,
            preset: settings.preset,
            themeColors: settings.themeColors,
            background: settings.background,
            animation: { duration: 1, fps: 2 },
        })
    })

    it('updates metadata while preserving comments, setup code, line endings, and literal Board dimensions', () => {
        const source = [
            '// keep this note',
            'width = 640; // keep width explanation',
            'height = 360',
            'preset = "default";',
            'const title = "keep setup"',
            '<Board width={640} height="360"><CanvasItem x={0} y={0} /></Board>',
            '',
        ].join('\r\n')
        const updated = updatePlaygroundSettings(source, {
            width: 1280,
            height: 720,
            preset: 'engineering',
            themeColors: { primary: '#ff00ff', bg: 'hsl(210 20% 10%)' },
            background: '#f0a',
        })

        expect(updated).toContain('// keep this note\r\n')
        expect(updated).toContain('width = 1280; // keep width explanation\r\n')
        expect(updated).toContain('height = 720\r\n')
        expect(updated).toContain('preset = "engineering";\r\n')
        expect(updated).toContain('themeColors = {"primary":"#ff00ff","bg":"hsl(210 20% 10%)"}\r\n')
        expect(updated).toContain('background = "#f0a"\r\n')
        expect(updated).toContain('const title = "keep setup"\r\n')
        expect(updated).toContain('<Board width={1280} height="720">')
        expect(readPlaygroundSettings(updated)).toMatchObject({ width: 1280, height: 720, preset: 'engineering' })
        expect(preparePlaygroundSource(updated)).toMatchObject({ metadata: { width: 1280, height: 720, preset: 'engineering' } })
    })

    it('inserts new settings after preamble comments and before setup code', () => {
        const source = '// keep comment\nconst label = "setup"\n<Board />\n'
        const updated = updatePlaygroundSettings(source, { width: 800, height: 450 })
        expect(updated).toBe('// keep comment\nwidth = 800\nheight = 450\nconst label = "setup"\n<Board width={800} height={450} />\n')
    })

    it('reports computed, spread, and duplicate root Board dimensions it cannot synchronize safely', () => {
        const source = 'width = 640\n<Board width={canvasWidth} height={360} />'
        expect(() => updatePlaygroundSettings(source, { width: 800 })).toThrow(
            'Cannot safely sync root Board width: its value is computed as canvasWidth.',
        )
        expect(() => updatePlaygroundSettings('width = 640\n<Board {...props} />', { width: 800 })).toThrow(
            'Cannot safely sync root Board width: its value may be supplied or overridden by prop spread {...props}.',
        )
        expect(() => updatePlaygroundSettings('width = 640\n<Board width={640} width={800} />', { width: 800 })).toThrow(
            'Cannot safely sync root Board width: it appears more than once.',
        )
        const nestedBoard = updatePlaygroundSettings(
            'width = 960\nheight = 540\n<Scene><Board width={200} height={100} /></Scene>',
            { width: 1200, height: 720 },
        )
        expect(nestedBoard).toContain('<Board width={200} height={100} />')
    })

    it('clears an existing custom palette and preserves a trailing comment', () => {
        const source = 'themeColors = {"primary":"#123456"}; // palette note\n<Board />'
        const updated = updatePlaygroundSettings(source, { themeColors: null })
        expect(updated).toBe('// palette note\n<Board />')
        expect(readPlaygroundSettings(updated).themeColors).toBeUndefined()
    })

    it('supports portable source backgrounds and rejects non-color values', () => {
        const source = 'width = 320\n<Board />'
        const updated = updatePlaygroundSettings(source, { background: 'theme' })
        expect(updated).toBe('width = 320\nbackground = "theme"\n<Board />')
        expect(readPlaygroundSettings(updated).background).toBe('theme')
        expect(preparePlaygroundSource(updated).metadata.background).toBe('theme')
        expect(updatePlaygroundSettings(updated, { background: null })).toBe(source)
        expect(() => updatePlaygroundSettings(source, { background: 'var(--canvas)' })).toThrow('background must be "theme", "transparent", or a valid CSS color.')
        expect(() => readPlaygroundSettings('background = 7\n<Board />')).toThrow('background must be "theme", "transparent", or a valid CSS color.')
    })

    it('validates dimensions and rejects malformed palettes, unknown keys, and non-colors', () => {
        expect(() => updatePlaygroundSettings('<Board />', { width: 0 })).toThrow('width must be an integer from 1 to 8192.')
        expect(() => updatePlaygroundSettings('<Board />', { height: 8193 })).toThrow('height must be an integer from 1 to 8192.')
        expect(() => readPlaygroundSettings('themeColors = {"primary":}\n<Board />')).toThrow('themeColors must be a single-line JSON object')
        expect(() => readPlaygroundSettings('themeColors = {"fontSans":"Arial"}\n<Board />')).toThrow('Unknown themeColors key "fontSans".')
        expect(() => readPlaygroundSettings('themeColors = {"primary":"var(--brand)"}\n<Board />')).toThrow('themeColors.primary must be a valid CSS color.')
    })

    it('applies custom colors over both theme presets and keeps explicit component colors', () => {
        const palette = { primary: '#123456' }
        const light = mergePlaygroundThemeColors('light', 'default', palette)
        const engineering = mergePlaygroundThemeColors('dark', 'engineering', palette)
        expect(light.primary).toBe('#123456')
        expect(light.bg).toBe('#f5f7fa')
        expect(engineering.primary).toBe('#123456')
        expect(engineering.bg).toBe('#f4f4f5')

        const api = createPlaygroundApi(light)
        const Scene = api.Scene as (props: Record<string, unknown>) => React.ReactElement
        expect((Scene({}) as React.ReactElement<{ c: typeof light }>).props.c).toBe(light)
        const explicit = mergePlaygroundThemeColors('dark', 'default', { primary: '#654321' })
        expect((Scene({ c: explicit }) as React.ReactElement<{ c: typeof explicit }>).props.c).toBe(explicit)
    })
})
