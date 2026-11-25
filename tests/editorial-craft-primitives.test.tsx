import React from 'react'
import { describe, expect, it } from 'vitest'
import {
    AttentionMatrix,
    Card,
    Heatmap,
    LineChart,
    MathSvg,
    Matrix,
    Panel,
    Scene,
    TextLabel,
    divergingColor,
    getThemeColors,
    heatColor,
    renderToSvg,
} from '../src'
import { analyzeContrast } from '../src/diagnostics'

describe('editorial craft primitives', () => {
    it('renders AttentionMatrix with transparent root by default and optional header/footer', async () => {
        const options = {
            weights: [[1, 0], [0.25, 0.75]],
            mask: [[true, false], [true, true]],
            queryLabels: ['q1', 'q2'],
            keyLabels: ['k1', 'k2'],
        }
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const compact = AttentionMatrix({ ...options, c, showHeader: false, showFooter: false })
            expect((compact.props as { style: React.CSSProperties }).style.backgroundColor).toBe('transparent')

            const svg = await renderToSvg(compact, 760, 320, { background: 'transparent', theme })
            expect(svg).toMatch(/^<svg\b/)
            expect(svg).not.toMatch(/NaN|Infinity/)
            expect(analyzeContrast(compact, theme)).not.toContainEqual(
                expect.objectContaining({ code: 'accessibility.low_contrast' }),
            )
        }
    })

    it('adapts heatColor to light vs dark themes and supports diverging scale in Matrix and Heatmap', async () => {
        const dark = getThemeColors('dark')
        const light = getThemeColors('light')

        expect(heatColor(0, light)).toBe('#f5f1e6')
        expect(heatColor(0, dark)).toBe('#1b2430')
        expect(heatColor(0)).toBe('#1b2430')
        expect(divergingColor(0.5, light)).toBe('#f5f1e6')
        expect(divergingColor(0.5, dark)).toBe('#1b2029')
        expect(divergingColor(0, light)).not.toBe(divergingColor(1, light))

        const matrix = Matrix({
            c: light,
            data: [[-1, 0, 1]],
            colorDomain: [-1, 1],
            colorScale: 'diverging',
            rowLabels: ['delta'],
            colLabels: ['a', 'b', 'c'],
        })
        const heatmap = Heatmap({
            c: light,
            data: [[-0.5, 0.5]],
            xLabels: ['k1', 'k2'],
            yLabels: ['q1'],
            colorDomain: [-1, 1],
            colorScale: 'diverging',
        })
        const svg = await renderToSvg(
            React.createElement('div', { style: { display: 'flex', gap: 16 } }, matrix, heatmap),
            720,
            240,
            { background: 'transparent', theme: 'light' },
        )
        expect(svg).toMatch(/^<svg\b/)
        expect(svg).not.toMatch(/NaN|Infinity/)
    })

    it('supports smooth monotone splines, dashed series, and referenceLines on LineChart', async () => {
        const c = getThemeColors('light')
        const chart = LineChart({
            c,
            width: 520,
            height: 260,
            smooth: true,
            labels: ['0', '1', '2', '3', '4'],
            series: [
                { name: 'Train', points: [2.2, 1.4, 0.9, 0.6, 0.45], color: 'primary', area: true },
                { name: 'Val', points: [2.3, 1.6, 1.2, 1.1, 1.15], color: 'warning', dashed: true },
            ],
            referenceLines: [
                { axis: 'y', value: 1.0, label: 'Target', color: 'positive' },
                { axis: 'x', value: 3, label: 'Best', color: 'critical' },
            ],
        })
        const svg = await renderToSvg(chart, 560, 300, { background: 'transparent', theme: 'light' })
        expect(svg).toMatch(/^<svg\b/)
        expect(svg).toContain('stroke-dasharray')
        expect(svg).toMatch(/C[\d.\s,-]+/)
        expect(svg).not.toMatch(/NaN|Infinity/)
    })

    it('supports card, ghost, and tinted surface variants on Panel and Card', async () => {
        const c = getThemeColors('light')
        const ghostPanel = Panel({ c, title: 'Ghost panel', tone: 'blue', variant: 'ghost', children: TextLabel({ c, text: 'frameless' }) })
        const tintedPanel = Panel({ c, title: 'Tinted panel', tone: 'green', variant: 'tinted', children: TextLabel({ c, text: 'soft wash' }) })
        const ghostCard = Card({ c, title: 'Ghost card', tone: 'warm', variant: 'ghost', children: TextLabel({ c, text: 'editorial' }) })
        const tintedCard = Card({ c, title: 'Tinted card', tone: 'purple', variant: 'tinted', children: TextLabel({ c, text: 'accent wash' }) })

        expect((ghostPanel.props as { style: React.CSSProperties }).style.backgroundColor).toBe('transparent')
        expect((ghostCard.props as { style: React.CSSProperties }).style.backgroundColor).toBe('transparent')
        expect((tintedPanel.props as { style: React.CSSProperties }).style.backgroundColor).not.toBe(c.bgCard)
        expect((tintedCard.props as { style: React.CSSProperties }).style.backgroundColor).not.toBe(c.bgCard)

        const svg = await renderToSvg(
            <Scene c={c} padding={12}>
                {ghostPanel}
                {tintedPanel}
                {ghostCard}
                {tintedCard}
            </Scene>,
            540,
            420,
            { background: 'transparent', theme: 'light' },
        )
        expect(svg).toMatch(/^<svg\b/)
    })

    it('renders MathSvg TeX equations cleanly through Satori in dark and light modes', async () => {
        for (const theme of ['dark', 'light'] as const) {
            const c = getThemeColors(theme)
            const svg = await renderToSvg(
                <Scene c={c} padding={12}>
                    <MathSvg c={c} tex="\mathcal{L}(\theta) = -\sum_t \log p_\theta(x_t \mid x_{<t})" fontSize={18} />
                </Scene>,
                520,
                120,
                { background: 'transparent', theme },
            )
            expect(svg).toMatch(/^<svg\b/)
            expect(svg).toContain('<image')
            expect(svg).not.toMatch(/NaN|Infinity/)
        }
    })
})
