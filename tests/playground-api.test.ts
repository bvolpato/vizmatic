import React from 'react'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { satori } from '../src/satori'
import { createPlaygroundApi } from '../src/playground-api'
import { getThemeColors } from '../src/theme'

describe('playground SVG helpers', () => {
    it('renders direct-call SVG primitives into parseable SVG', async () => {
        const c = getThemeColors('dark')
        const api = createPlaygroundApi(c)
        const helper = (name: string, props: Record<string, unknown>) =>
            (api[name] as (input: Record<string, unknown>) => React.ReactNode)(props)
        const element = React.createElement('svg', {
            width: 200,
            height: 120,
            viewBox: '0 0 200 120',
        },
        React.createElement('defs', null, helper('ArrowMarkerDef', { id: 'arrow', color: c.infoLight })),
        helper('SvgFrame', { c, width: 200, height: 120, fill: c.bg, stroke: c.borderLight }),
        React.createElement('path', { d: 'M 24 24 L 170 24', fill: 'none', stroke: c.infoLight, markerEnd: 'url(#arrow)' }),
        helper('VectorSegment', { x1: 24, y1: 48, x2: 98, y2: 96, color: c.secondaryLight, showStartDot: true }),
        helper('VectorArrow', { x1: 98, y1: 96, x2: 170, y2: 48, color: c.positiveLight }),
        helper('SvgPoint', { cx: 170, cy: 48, r: 6, fill: c.positiveLight }),
        )

        const svg = await satori(element, { width: 200, height: 120, fonts: [] })
        expect(svg).not.toContain('<function ')
        expect(() => new Resvg(svg).render()).not.toThrow()
    })
})
