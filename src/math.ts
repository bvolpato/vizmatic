import parseCssColor from 'parse-css-color'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import type TexError from 'mathjax-full/js/input/tex/TexError.js'
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js'
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js'
import 'mathjax-full/js/input/tex/mhchem/MhchemConfiguration.js'
import { STATE } from 'mathjax-full/js/core/MathItem.js'
import type { MmlNode } from 'mathjax-full/js/core/MmlTree/MmlNode.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { SVG } from 'mathjax-full/js/output/svg.js'

export interface RenderMathSvgOptions {
    fontSize?: number
    color?: string
    display?: boolean
}

export interface RenderMathSvgResult {
    svg: string
    width: number
    height: number
    /** Baseline from the SVG top, possibly outside the ink bounds for isolated symbols. */
    baseline: number
}

const DEFAULT_FONT_SIZE = 16
const EX_FACTOR = 0.5

let adaptor: ReturnType<typeof liteAdaptor> | undefined
let outputJax: SVG<unknown, unknown, unknown> | undefined
const renderCache = new Map<string, RenderMathSvgResult>()
const RENDER_CACHE_LIMIT = 128

function ensureMathJax() {
    if (!adaptor) {
        adaptor = liteAdaptor({ fontSize: DEFAULT_FONT_SIZE })
        RegisterHTMLHandler(adaptor)
    }
    outputJax ??= new SVG({ fontCache: 'none', exFactor: EX_FACTOR })
    return { adaptor, outputJax }
}

function createDocument() {
    const { outputJax: svgOutput } = ensureMathJax()
    const inputJax = new TeX({
        packages: ['base', 'ams', 'newcommand', 'mhchem'],
        formatError(_jax: unknown, error: TexError) {
            throw new Error(`Invalid TeX: ${error.message}`, { cause: error })
        },
    })
    // Keep logical limits identifiable when MathJax moves them beside an inline operator.
    inputJax.postFilters.add(({ data }: { data: { root: MmlNode } }) => {
        data.root.walkTree((node) => {
            if (['munder', 'mover', 'munderover'].includes(node.kind)) {
                (node as MmlNode).attributes.set('data-vizmatic-kind', node.kind)
                node.childNodes.forEach((child, index) => {
                    (child as MmlNode).attributes.set('data-vizmatic-slot', index)
                })
            }
        })
    }, -4.5)
    return mathjax.document('', { InputJax: inputJax, OutputJax: svgOutput })
}

function parseEx(value: unknown, name: string): number {
    if (typeof value !== 'string' || !value.endsWith('ex')) {
        throw new Error(`MathJax returned an unsupported ${name} dimension`)
    }

    const amount = Number(value.slice(0, -2))
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`MathJax returned an invalid ${name} dimension`)
    }
    return amount
}

function parseViewBox(value: unknown): [number, number, number, number] {
    if (typeof value !== 'string') throw new Error('MathJax returned an SVG without a viewBox')
    const values = value.trim().split(/[ ,]+/).map(Number)
    if (values.length !== 4 || values.some((part) => !Number.isFinite(part)) || values[2]! <= 0 || values[3]! <= 0) {
        throw new Error('MathJax returned an invalid SVG viewBox')
    }
    return [values[0]!, values[1]!, values[2]!, values[3]!]
}

/** Typeset TeX as a standalone SVG with pixel dimensions and baseline metrics. */
export function renderMathSvg(tex: string, options: RenderMathSvgOptions = {}): RenderMathSvgResult {
    return renderSvg(tex, options)
}

/** Internal: parse a target with the equation's local macros and display mode. */
export function renderMathFragmentSvg(source: string, fragment: string, options: RenderMathSvgOptions = {}): RenderMathSvgResult {
    return renderSvg(fragment, options, source === fragment ? undefined : source)
}

function renderSvg(tex: string, options: RenderMathSvgOptions, context?: string): RenderMathSvgResult {
    if (typeof tex !== 'string' || tex.trim().length === 0) {
        throw new Error('TeX input must be a non-empty string')
    }

    const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
        throw new Error('Math SVG fontSize must be a positive finite number')
    }

    const color = options.color ?? '#000000'
    if (typeof color !== 'string' || !parseCssColor(color.trim())) {
        throw new Error('Math SVG color must be a valid CSS color')
    }
    const normalizedColor = color.trim()
    const display = options.display ?? false
    const key = JSON.stringify([tex, fontSize, normalizedColor, display, context])
    const cached = renderCache.get(key)
    if (cached) {
        renderCache.delete(key)
        renderCache.set(key, cached)
        return { ...cached }
    }

    let container
    try {
        const document = createDocument()
        // Compile the source even if its SVG is cached: definitions belong to this document.
        if (context !== undefined) document.convert(context, { display, end: STATE.COMPILED })
        container = document.convert(tex, {
            display,
            em: fontSize,
            ex: fontSize * EX_FACTOR,
            containerWidth: fontSize * 80,
        })
    } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith('Invalid TeX:')) throw cause
        const detail = cause instanceof Error ? cause.message : String(cause)
        throw new Error(`Unable to render TeX: ${detail}`, { cause })
    }

    const { adaptor: mathAdaptor } = ensureMathJax()
    const svgElement = mathAdaptor.tags(container, 'svg')[0]
    if (!svgElement) throw new Error('MathJax did not produce an SVG image')

    const width = parseEx(mathAdaptor.getAttribute(svgElement, 'width'), 'width') * fontSize * EX_FACTOR
    const height = parseEx(mathAdaptor.getAttribute(svgElement, 'height'), 'height') * fontSize * EX_FACTOR
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        throw new Error('MathJax returned non-finite SVG dimensions')
    }

    const [, viewBoxY, , viewBoxHeight] = parseViewBox(mathAdaptor.getAttribute(svgElement, 'viewBox'))
    const baseline = -viewBoxY * height / viewBoxHeight
    if (!Number.isFinite(baseline)) {
        throw new Error('MathJax returned an invalid SVG baseline')
    }

    const drawing = mathAdaptor.tags(svgElement, 'g')[0]
    if (!drawing) throw new Error('MathJax returned an SVG without a drawing group')

    mathAdaptor.removeAttribute(svgElement, 'style')
    mathAdaptor.setAttribute(svgElement, 'width', `${width}px`)
    mathAdaptor.setAttribute(svgElement, 'height', `${height}px`)
    mathAdaptor.setAttribute(drawing, 'fill', normalizedColor)
    mathAdaptor.setAttribute(drawing, 'stroke', normalizedColor)

    const result = {
        svg: mathAdaptor.serializeXML(svgElement),
        width,
        height,
        baseline,
    }
    renderCache.set(key, result)
    if (renderCache.size > RENDER_CACHE_LIMIT) {
        renderCache.delete(renderCache.keys().next().value!)
    }
    return { ...result }
}
