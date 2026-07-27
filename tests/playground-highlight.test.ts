import { describe, expect, it } from 'vitest'
import { highlightPlaygroundSource } from '../src/playground-highlight'

describe('playground source highlighting', () => {
    it('highlights TSX tokens and escapes source markup', () => {
        const highlighted = highlightPlaygroundSource('<Scene title="Cost & cache" width={960} enabled={true} />')

        expect(highlighted).toContain('<span class="syntax-operator">&lt;</span><span class="syntax-tag">Scene</span>')
        expect(highlighted).toContain('<span class="syntax-attribute">title</span>')
        expect(highlighted).toContain('<span class="syntax-string">"Cost &amp; cache"</span>')
        expect(highlighted).toContain('<span class="syntax-number">960</span>')
        expect(highlighted).toContain('<span class="syntax-literal">true</span>')
        expect(highlighted).not.toContain('<Scene')
    })

    it('keeps comments and quoted markup inside their own tokens', () => {
        const highlighted = highlightPlaygroundSource('// <Panel />\nconst label = "<Row />"')

        expect(highlighted).toContain('<span class="syntax-comment">// &lt;Panel /&gt;</span>')
        expect(highlighted).toContain('<span class="syntax-keyword">const</span>')
        expect(highlighted).toContain('<span class="syntax-string">"&lt;Row /&gt;"</span>')
    })

    it('keeps highlighting attributes after operators in JSX expressions', () => {
        const highlighted = highlightPlaygroundSource('<Panel visible={count > 0} render={() => count} title="Visible" />')

        expect(highlighted).toContain('<span class="syntax-attribute">render</span>')
        expect(highlighted).toContain('<span class="syntax-attribute">title</span>')
    })
})
