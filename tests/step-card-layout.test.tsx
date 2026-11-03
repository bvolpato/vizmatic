import { describe, expect, it } from 'vitest'
import { getThemeColors, renderToSvg, StepCard, type SatoriNode } from '../src'

describe.each([
    ['dark', 'default'],
    ['light', 'default'],
    ['dark', 'engineering'],
    ['light', 'engineering'],
] as const)('StepCard layout in %s/%s', (mode, preset) => {
    it.each([
        { title: 'Tool A', width: 170 },
        { title: 'System instructions', subtitle: 'same content', width: 330 },
        {
            title: 'A longer tool title that wraps',
            subtitle: 'cache read',
            eyebrow: 'Request 1',
            width: 170,
            minHeight: 150,
        },
    ])('centers the complete label group for $title', async (props) => {
        const nodes: SatoriNode[] = []
        await renderToSvg(<StepCard c={getThemeColors(mode, preset)} {...props} />, 400, 240, {
            onNodeDetected: (node) => nodes.push(node),
        })

        const card = nodes[0]!
        const labels = nodes.filter((node) => node.textContent)
        expect(labels.length).toBeGreaterThan(0)
        const top = Math.min(...labels.map((node) => node.top))
        const bottom = Math.max(...labels.map((node) => node.top + node.height))
        expect(Math.abs((top + bottom) / 2 - (card.top + card.height / 2))).toBeLessThanOrEqual(0.5)
        for (const label of labels) {
            expect(Math.abs(label.left + label.width / 2 - (card.left + card.width / 2))).toBeLessThanOrEqual(0.5)
        }
    })
})
