import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'
import { renderMathSvg } from '../src/math'

describe('MathJax SVG rendering', () => {
    it('renders common TeX as self-contained SVG paths with pixel metrics', () => {
        const result = renderMathSvg(String.raw`\frac{\partial L}{\partial w}=\sum_{i=1}^n (x_i-\hat{x}_i)^2+\alpha`, {
            fontSize: 24,
            color: 'rebeccapurple',
        })

        expect(result.svg).toContain('width="')
        expect(result.svg).toContain('height="')
        expect(result.svg).toContain('fill="rebeccapurple"')
        expect(result.svg).not.toContain('currentColor')
        expect(result.svg).not.toContain('<use')
        expect(result.svg).not.toContain('<style')
        expect(result.width).toBeGreaterThan(0)
        expect(result.height).toBeGreaterThan(0)
        expect(result.baseline).toBeGreaterThan(0)
        expect(result.baseline).toBeLessThan(result.height)

        const rendered = new Resvg(result.svg, { font: { loadSystemFonts: false } }).render()
        expect(rendered.width).toBe(Math.round(result.width))
        expect(rendered.height).toBe(Math.round(result.height))
        expect(rendered.asPng().length).toBeGreaterThan(100)
    })

    it('scales dimensions and baseline with font size and supports display layout', () => {
        const inline = renderMathSvg('x', { fontSize: 16 })
        const larger = renderMathSvg('x', { fontSize: 32 })
        const display = renderMathSvg(String.raw`\frac{1}{x}`, { fontSize: 16, display: true })

        expect(larger.width).toBeCloseTo(inline.width * 2)
        expect(larger.height).toBeCloseTo(inline.height * 2)
        expect(larger.baseline).toBeCloseTo(inline.baseline * 2)
        expect(display.height).toBeGreaterThan(inline.height)
        expect(display.baseline).toBeGreaterThan(0)
        expect(display.baseline).toBeLessThan(display.height)
    })

    it('renders AMS matrices, cases, aligned equations, and isolated new commands', () => {
        const expressions = [
            String.raw`\begin{bmatrix}a & b \\ c & d\end{bmatrix}`,
            String.raw`f(x)=\begin{cases}x^2,&x>0\\0,&x\le0\end{cases}`,
            String.raw`\begin{aligned}y&=mx+b\\z&=ax^2+bx+c\end{aligned}`,
        ]

        for (const expression of expressions) {
            const result = renderMathSvg(expression, { display: true })
            expect(result.svg).toContain('<path')
            expect(() => new Resvg(result.svg).render()).not.toThrow()
        }

        expect(renderMathSvg(String.raw`\newcommand{\lessonMacro}{x}\lessonMacro`).svg).toContain('<path')
        expect(() => renderMathSvg(String.raw`\lessonMacro`)).toThrow('Invalid TeX:')
    })

    it('rejects malformed TeX, empty expressions, and invalid rendering options', () => {
        expect(() => renderMathSvg(' ')).toThrow('TeX input must be a non-empty string')
        expect(() => renderMathSvg(String.raw`\frac{1}{`)).toThrow('Invalid TeX:')
        expect(() => renderMathSvg(String.raw`\unknowncommand{x}`)).toThrow('Invalid TeX:')
        expect(() => renderMathSvg('x', { fontSize: 0 })).toThrow('fontSize must be a positive finite number')
        expect(() => renderMathSvg('x', { color: 'url(https://example.com/a.svg#x)' })).toThrow('valid CSS color')
    })
})
