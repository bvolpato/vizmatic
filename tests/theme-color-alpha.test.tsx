import React from 'react'
import { describe, expect, it } from 'vitest'
import {
    Badge,
    BadgePill,
    BarChart,
    Box,
    CalloutCard,
    CodeBlock,
    Grid,
    GraphDiagram,
    LayeredNetwork,
    PieChart,
    SequenceDiagram,
    StatusRow,
    Tile,
    Timeline,
    TiledMatrix,
    TreeDiagram,
    getThemeColors,
    renderToSvg,
    withColorAlpha,
    type ThemeColors,
} from '../src'

describe('withColorAlpha', () => {
    it('preserves hex alpha bytes and composes alpha for other CSS color formats', () => {
        expect(withColorAlpha('#7C3AED', 0x20 / 0xff)).toBe('#7C3AED20')
        expect(withColorAlpha('rgba(10, 20, 30, 0.5)', 0.25)).toBe('rgba(10, 20, 30, 0.125)')
        expect(withColorAlpha('hsl(120 100% 50% / 75%)', 0.5)).toBe('rgba(0, 255, 0, 0.375)')
        expect(withColorAlpha('rebeccapurple', 0.5)).toBe('rgba(102, 51, 153, 0.5)')
        expect(withColorAlpha('#0f08', 0.5)).toBe('rgba(0, 255, 0, 0.266667)')
        expect(withColorAlpha('#12345680', 0.5)).toBe('rgba(18, 52, 86, 0.25098)')
        expect(withColorAlpha('transparent', 0.5)).toBe('rgba(0, 0, 0, 0)')
    })

    it('uses transparent for invalid colors or opacity values', () => {
        expect(withColorAlpha('not-a-css-color', 0.5)).toBe('transparent')
        expect(withColorAlpha('#ffffff', Number.NaN)).toBe('transparent')
    })
})

describe('custom theme colors in alpha-styled primitives', () => {
    it('renders primitives and chart formats with RGBA, HSL, named, and alpha-hex theme colors', async () => {
        const c: ThemeColors = {
            ...getThemeColors('dark'),
            primary: 'rgba(125, 50, 240, 0.8)',
            primaryLight: 'hsl(270 75% 65% / 80%)',
            secondaryLight: 'rebeccapurple',
            positiveLight: 'rgba(10, 190, 110, 0.65)',
            warningLight: 'hsl(35deg 90% 55% / 70%)',
            infoLight: '#46a4bba0',
            accentLight: '#b78a',
            criticalLight: 'navy',
        }

        const svg = await renderToSvg(
            React.createElement('div', {
                style: { display: 'flex', flexDirection: 'column', gap: 10 },
            },
                React.createElement(Box, { c, label: 'Custom color shadow', color: 'primary', width: 220, height: 72 }),
                React.createElement(Badge, { c, label: 'RGBA badge', color: 'primary' }),
                React.createElement(BadgePill, { c, text: 'HSL pill', tone: 'blue' }),
                React.createElement(StatusRow, { c, label: 'RGBA status', tone: 'green', status: 'check' }),
                React.createElement(TiledMatrix, {
                    c,
                    rows: 2,
                    cols: 2,
                    tone: 'purple',
                    regions: [{ rowStart: 0, rowEnd: 1, colStart: 0, colEnd: 1, tone: 'purple' }],
                }),
                React.createElement(Grid, { c, rows: [[{ label: 'Grid', tone: 'warm' }]] }),
                React.createElement(Tile, { c, title: 'Named tone', tone: 'warm' }),
                React.createElement(CodeBlock, { c, lines: [{ text: 'accent', tone: 'cyan' }], tone: 'cyan' }),
                React.createElement(CalloutCard, { c, title: 'Custom callout', tone: 'red', filled: false }),
                React.createElement(TreeDiagram, {
                    c,
                    root: { id: 'root', label: 'Root', tone: 'purple', children: [{ id: 'child', label: 'Child', tone: 'purple' }] },
                }),
                React.createElement(GraphDiagram, {
                    c,
                    groups: [{ id: 'service', label: 'Service', tone: 'warm' }],
                    nodes: [{ id: 'api', label: 'API', group: 'service', tone: 'purple' }],
                    edges: [],
                }),
                React.createElement(LayeredNetwork, {
                    c,
                    layers: [{ title: 'Input', nodes: ['A'] }, { title: 'Output', nodes: ['B'] }],
                    activePath: [0, 0],
                    width: 360,
                    height: 260,
                    showFormula: false,
                }),
                React.createElement(Timeline, { c, events: [{ title: 'Timeline', tone: 'blue' }] }),
                React.createElement(SequenceDiagram, {
                    c,
                    participants: [{ id: 'client', label: 'Client' }, { id: 'server', label: 'Server' }],
                    items: [{
                        kind: 'loop',
                        tone: 'warm',
                        label: 'retry',
                        items: [
                            { type: 'note', text: 'custom note', participant: 'client', tone: 'warm' },
                            { from: 'client', to: 'server', label: 'request' },
                        ],
                    }],
                }),
                React.createElement(BarChart, { c, data: [{ label: 'A', value: 4 }, { label: 'B', value: 7 }], width: 250, height: 150 }),
                React.createElement(PieChart, { c, segments: [{ label: 'A', value: 4 }, { label: 'B', value: 7 }], size: 150 }),
            ),
            960,
            2200,
        )

        expect(svg).toMatch(/^<svg\b/)
        expect(svg).toContain('fill="rgba(125, 50, 240, 0.8)"')
        expect(svg).toContain('flood-color="rgba(125, 50, 240, 0.150588)"')
        expect(svg).toContain('fill="rgba(102, 51, 153, 0.094118)"')
        expect(svg).toContain('fill="rgba(244, 157, 37, 0.093333)"')
        expect(svg).toContain('data-pie-label=')
        expect(svg).not.toMatch(/(?:rgba|hsl)\([^)]*\)[0-9a-f]{2}/i)
    })
})
