import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { Box, compileFilm, film, linear, morphMatching, parseColor, place, row, tex, text, type PathOp } from '../src/stage/index'
import { apply } from '../src/stage/geometry'
import { renderMathSvg } from '../src/math'

it('returns no targets for a fragment without visible glyphs', () => {
    // Run out of process so a zero-length match cannot hang the test runner.
    expect(() => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', String.raw`
        import assert from 'node:assert/strict';
        import { compileFilm, film, tex } from './src/stage/index.ts';
        await compileFilm(film(() => {
            const eq = tex('x');
            assert.deepEqual(eq.parts('\\phantom{x}'), []);
            assert.deepEqual(eq.part(''), []);
        }));
    `], { timeout: 5000, stdio: 'pipe' })).not.toThrow()
})

it('targets script structure, repeated terms, and sibling fragments without flattening fractions', async () => {
    await compileFilm(film(() => {
        const eq = tex(String.raw`x_2+x^2+x^{2}`)
        expect(eq.part('x^2')).toEqual(eq.glyphs.slice(3, 5))
        expect(eq.parts('x^{2}')).toEqual([eq.glyphs.slice(3, 5), eq.glyphs.slice(6, 8)])
        expect(eq.parts('2')).toEqual([[eq.glyphs[1]], [eq.glyphs[4]], [eq.glyphs[7]]])
        expect(eq.part('x2')).toEqual([])
        expect(eq.clone().part('x^2')).not.toContain(eq.glyphs[3])
        const sum = tex('a+b+c')
        expect(sum.part('b+c')).toEqual(sum.glyphs.slice(2))
        const fractions = tex(String.raw`\frac{ab}{c}+\frac{a}{bc}`)
        expect(fractions.parts(String.raw`\frac{a}{bc}`)).toHaveLength(1)
        expect(fractions.part(String.raw`\frac{a}{bc}`)).toEqual(fractions.glyphs.slice(5))
    }))
})

it('resolves targets in the equation macro and display context without leaking macros', async () => {
    await compileFilm(film(() => {
        const eq = tex(String.raw`\newcommand{\term}[1]{#1^2}\term{x}+\term{y}`)
        expect(eq.part(String.raw`\term{y}`)).toEqual(eq.glyphs.slice(3))
        for (const display of [true, false]) {
            const sum = tex(String.raw`\sum_{i=1}^n x_i`, { display })
            expect(sum.part(String.raw`\sum_{i=1}^n`)).toEqual(sum.glyphs.slice(0, 5))
        }
        const nested = tex(String.raw`\frac{\sum_{i=1}^n x_i}{y}`)
        expect(nested.part(String.raw`\sum_{i=1}^n`)).toEqual(nested.glyphs.slice(0, 5))
        const inline = tex(String.raw`\textstyle\sum_{i=1}^n x_i`)
        expect(inline.part(String.raw`\sum_{i=1}^n`)).toEqual(inline.glyphs.slice(0, 5))
        expect(() => tex(String.raw`\term{y}`)).toThrow('Invalid TeX:')
    }))
})

it('outlines Unicode text fallback and rejects characters absent from bundled fonts', async () => {
    const compiled = await compileFilm(film((s) => {
        const eq = s.add(tex(String.raw`\text{H₂O}`))
        expect(eq.glyphs.map((g) => g.data['key'])).toEqual(['H', '₂', 'O'])
        expect(eq.part(String.raw`\text{₂}`)).toEqual([eq.glyphs[1]])
        s.wait(1)
    }))
    expect(compiled.frame(0).ops.filter((op) => op.kind === 'path')).toHaveLength(3)
    await expect(compileFilm(film((s) => { s.add(tex('\\text{\u{10FFFF}}')) }))).rejects.toThrow(/U\+10FFFF/)
})

it('aligns mixed text and scaled equations by their baselines in rows', async () => {
    await compileFilm(film(() => {
        const label = text('value', { size: 30 })
        const x = tex('x', { size: 40 })
        const fraction = tex(String.raw`\frac{x}{y}`, { size: 50 }).scale(1.4)
        const block = row([label, x, fraction])
        place(block, new Box(-400, -200, 600, 340))
        const baseline = apply(label.worldMatrix(), 0, 0)[1]
        expect(apply(x.worldMatrix(), 0, 0)[1]).toBeCloseTo(baseline)
        expect(apply(fraction.worldMatrix(), 0, 0)[1]).toBeCloseTo(baseline)
    }))
})

it('keeps reordered and duplicate glyphs fully visible throughout matching morphs', async () => {
    const compiled = await compileFilm(film((s) => {
        const from = s.add(tex('a+b+a'))
        const to = tex('a+a+b')
        from.glyphs[0]!.color('#ff0000')
        from.glyphs[4]!.color('#0000ff')
        to.glyphs[0]!.color('#ff0000')
        to.glyphs[2]!.color('#0000ff')
        s.play(morphMatching(from, to, { ease: linear, duration: 1 }))
    }))
    for (const time of [0.2, 0.7, 0.4, 1]) {
        const paths = compiled.frame(time).ops.filter((op): op is PathOp => op.kind === 'path')
        expect(paths).toHaveLength(5)
        expect(paths.every((op) => op.fillAlpha === 1)).toBe(true)
        expect(paths[0]!.fill).toEqual(parseColor('#ff0000').map((value) => expect.closeTo(value, 3)))
        expect(paths[time < 1 ? 4 : 2]!.fill).toEqual(parseColor('#0000ff').map((value) => expect.closeTo(value, 3)))
    }
})

it('renders bundled chemistry in the shared SVG engine and in films', async () => {
    const source = String.raw`\ce{2 H2 + O2 -> 2 H2O}`
    const svg = renderMathSvg(source, { display: true })
    expect(svg.width).toBeGreaterThan(0)
    const compiled = await compileFilm(film((s) => {
        const eq = s.add(tex(source))
        expect(eq.part(String.raw`\ce{H2O}`)).not.toHaveLength(0)
        s.wait(1)
    }))
    expect(compiled.frame(0).ops.length).toBeGreaterThan(10)
})
