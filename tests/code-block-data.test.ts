import { expect, it } from 'vitest'
import { tokenize, type TokenKind } from '../src/stage/objects/cs'
import { codeBlock, compileFilm, film, rect } from '../src/stage'

type Shipped = 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'type' | 'punctuation' | 'plain' | 'space'

it('keeps the shipped kind exhaustive for data keys', () => {
    const palette: Record<Shipped, number> = { keyword: 0, string: 1, number: 2, comment: 3, function: 4, type: 5, punctuation: 6, plain: 7, space: 8 }
    const exhaustive: Record<TokenKind, number> = palette
    for (const t of tokenize('{"x":1}', 'json')) {
        const kind: Shipped = t.kind
        expect(exhaustive[kind]).toBeDefined()
    }
})

it('paints key roles through codeBlock', async () => {
    await compileFilm(film(() => {
        const paint = (fill: string) => rect(1, 1, { fill, stroke: null }).get('fill')
        const json = codeBlock('{"name":"Ada"}', { language: 'json' })
        expect(json.find('"name"')[0]!.get('fill')).toEqual(paint('blue'))
        expect(json.find('"Ada"')[0]!.get('fill')).toEqual(paint('green'))
        const keys = codeBlock('service-name: a\nservice: b', { language: 'yaml' })
        expect(keys.find('service')).toHaveLength(2 * 'service'.length)
        const yaml = codeBlock('display name: Ada', { language: 'yml', colors: { key: 'teal' } })
        for (const glyph of yaml.find('display name')) expect(glyph.get('fill')).toEqual(paint('teal'))
    }))
})

it('marks all words of a YAML key and numeric keys while retaining their lexical kinds', () => {
    const data = '- display name: one\n  404: missing\n  flow: {full name: one, 403: denied}'
    expect(tokenize(data, 'yml').filter(t => t.role === 'key').map(t => [t.text, t.kind])).toEqual([
        ['display', 'plain'], ['name', 'plain'], ['404', 'number'], ['flow', 'plain'],
        ['full', 'plain'], ['name', 'plain'], ['403', 'number'],
    ])
})

it('separates YAML comments from literal hashes and reads doubled single quotes', () => {
    const source = "name: 'O''Reilly'\nurl: https://x.test/p#frag # source\nlabel: C#\n# row"
    const data = tokenize(source, 'yaml')
    expect(data.filter(t => t.kind === 'comment').map(t => t.text)).toEqual(['# source', '# row'])
    expect(data.filter(t => t.kind === 'string').map(t => t.text)).toEqual(["'O''Reilly'"])
    expect(tokenize("'O''Reilly': yes", 'yaml').filter(t => t.role === 'key').map(t => t.text)).toEqual(["'O''Reilly'"])
})

it('keeps signed JSON numbers and either exponent marker in a single token', () => {
    expect(tokenize('{"x"\n: 1}', 'json').find(token => token.text === '"x"')?.role).toBe('key')
    const numbers = ['-2.5E+3', '1e-2', '-0', '0.125', '4E1']
    expect(tokenize('[' + numbers.join(',') + ']', 'jsonl').filter(t => t.kind === 'number').map(t => t.text)).toEqual(numbers)
})
