import React from 'react'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { satori, type SatoriNode } from '../src/satori'

it.each([
    [{}, [470, 470, 470]],
    [{ flexShrink: 0 }, [470, 470, 470]],
    [{ flexShrink: 1 }, [320, 320, 320]],
    [{ flex: 1 }, [320, 320, 320]],
    [{ flexShrink: 1, minWidth: 400 }, [400, 400, 400]],
] as const)('preserves fixed widths and explicit flexible sizing: %j', async (style, widths) => {
    const nodes: SatoriNode[] = []
    const Panel = () => React.createElement('div', {
        style: { display: 'flex', width: 960, height: 60 },
    }, ...widths.map((_, index) => React.createElement('div', {
        key: index,
        'data-panel': true,
        style: { width: 470, height: 20, backgroundColor: '#123456', ...style },
    })))
    await satori(React.createElement(Panel), {
        width: 960,
        height: 60,
        fonts: [],
        onNodeDetected: (node) => { if (node.props['data-panel']) nodes.push(node) },
    })
    expect(nodes.map((node) => node.width)).toEqual(widths)
})

it.each(['plain', 'fragment', 'function', 'forwardRef', 'bigint'] as const)('fits %s text beside a fixed-width sibling without shrinking the sibling', async (kind) => {
    const nodes: SatoriNode[] = []
    const font = await readFile(new URL('../assets/fonts/Inter-Regular.ttf', import.meta.url))
    const text = 'A long text paragraph that must wrap beside its fixed-width sibling.'
    let calls = 0
    const renderText = () => { calls += 1; return text }
    const content = kind === 'plain' ? text
        : kind === 'fragment' ? React.createElement(React.Fragment, {}, text)
        : kind === 'function' ? React.createElement(renderText)
        : kind === 'forwardRef' ? React.createElement(React.forwardRef(renderText))
        : 123456789012345678901234567890n
    const element = React.createElement('div', {
        style: { display: 'flex', width: 200, height: 200 },
    }, React.createElement('div', {
        'data-text': true,
        style: { fontSize: 16 },
    }, content),
    React.createElement('div', {
        'data-fixed': true,
        style: { width: 80, height: 20 },
    }))
    await satori(element, {
        width: 200,
        height: 200,
        fonts: [{ name: 'Inter', data: font }],
        onNodeDetected: (node) => nodes.push(node),
    })
    expect(nodes.find((node) => node.props['data-text'])?.width).toBe(120)
    expect(nodes.find((node) => node.props['data-fixed'])?.width).toBe(80)
    expect(calls).toBe(kind === 'function' || kind === 'forwardRef' ? 1 : 0)
})
