import { BEATS, DEFAULT_EASE, EASES } from './beats'
import { KINDS, num, str, type CodeContext, type CodeResult } from './catalog'
import { hiddenAtStart, sortedBeats } from './compile'
import { projectDuration, VALUE_TRACK, type StudioObject, type StudioProject } from './model'

const IMPORTABLE = [
    'film', 'text', 'tex', 'rect', 'ellipse', 'regularPolygon', 'line', 'arrow', 'dot', 'brace', 'axes', 'plane', 'decimal',
    'matrix', 'numberLine', 'complexPlane', 'vectorField', 'barChart', 'donut', 'pie', 'lineChart', 'heatmap', 'sparkline',
    'infoBox', 'graph', 'codeBlock', 'neuralNet', 'arrayCells', 'tokens', 'scene3d', 'surface', 'axes3d', 'morphCode', 'write',
    'draw', 'fadeIn', 'fadeOut', 'grow', 'appear', 'erase', 'vanish', 'moveTo', 'scaleBy', 'rotate', 'recolor', 'fade',
    'morph', 'morphMatching', 'along', 'applyMatrix', 'indicate', 'circumscribe', 'flash', 'ripple', 'pulse', 'shake',
    ...Object.values(EASES).map((ease) => ease.code.replace('()', '')),
]

const RESERVED = new Set([
    's', 'x', 'y', 't', 'in', 'of', 'do', 'if', 'for', 'new', 'var', 'let', 'try', 'this', 'void', 'with', 'case', 'else', 'enum', 'null', 'true',
    'class', 'const', 'false', 'super', 'throw', 'while', 'yield', 'await', 'break', 'catch', 'delete', 'export', 'import', 'return', 'static',
    'switch', 'typeof', 'default', 'extends', 'finally', 'package', 'private', 'continue', 'function', 'interface', 'protected', 'public',
    'implements', 'undefined', 'arguments', 'eval', 'NaN', 'Infinity', 'Math', 'instanceof', 'debugger',
    ...IMPORTABLE,
])

/** A readable, unique camelCase name for each object. */
function identifiers(values: readonly string[], fallback: string, taken: Set<string>): string[] {
    return values.map((value) => {
        const words = value.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 4)
        let base = words.map((word, i) => i === 0 ? word.toLowerCase() : word[0]!.toUpperCase() + word.slice(1).toLowerCase()).join('') || fallback
        if (/^[0-9]/.test(base)) base = `${fallback}${base}`
        let name = base
        for (let n = 2; taken.has(name) || RESERVED.has(name); n++) name = `${base}${n}`
        taken.add(name)
        return name
    })
}

function placement(object: StudioObject): string {
    const parts = [`.moveTo([${num(object.x)}, ${num(object.y)}])`]
    if (object.scale !== 1) parts.push(`.scale(${num(object.scale)})`)
    if (object.rotation !== 0) parts.push(`.rotate(${num(object.rotation)} * Math.PI / 180)`)
    if (object.opacity !== 1) parts.push(`.opacity(${num(object.opacity)})`)
    return parts.join('')
}

/** Readable TSX that renders to the same film. Paste it into a file and run the CLI. */
export function projectToSource(project: StudioProject): string {
    const visible = project.objects.filter((object) => !object.hidden && KINDS[object.kind])
    const taken = new Set<string>()
    const variableIds = identifiers(project.variables.map((variable) => variable.name), 'value', taken)
    const objectIds = identifiers(visible.map((object) => object.name || KINDS[object.kind]!.label), 'item', taken)
    const variableNames = new Map(project.variables.map((variable, i) => [variable.name, variableIds[i]!]))
    const names = new Map(visible.map((object, i) => [object.id, objectIds[i]!]))
    const kinds = new Map(project.objects.map((object) => [object.id, object.kind]))
    const variableName = (variable: string) => variableNames.get(variable) ?? variable
    const hidden = hiddenAtStart(project)
    const used = new Set<string>(['film'])
    const lines: string[] = []

    const out = (line = '') => lines.push(line ? `    ${line}` : '')
    if (project.variables.length) {
        out('// Numbers that beats can tween and drawings can read')
        project.variables.forEach((variable, i) => out(`const ${variableIds[i]} = s.value(${num(variable.value)})`))
        out()
    }
    if (visible.length) out('// Objects, back to front')
    const context = (name: string): CodeContext => ({ name, variables: project.variables.map((variable) => variable.name), variableName })
    for (const object of visible) {
        const name = names.get(object.id)!
        let code: CodeResult
        try {
            code = KINDS[object.kind]!.code(object.props, context(name))
        } catch (error) {
            // Line breaks would let a message escape the comment.
            out(`// ${name}: ${(error instanceof Error ? error.message : String(error)).replace(/[\r\n]+/g, ' ')}`)
            continue
        }
        const hide = hidden.has(object.id) ? '.hide()' : ''
        for (const line of code.setup ?? []) out(line)
        if (code.expr === name) out(`s.add(${name}${placement(object)}${hide})`)
        else out(`const ${name} = s.add(${code.expr}${placement(object)}${hide})`)
        for (const line of code.after ?? []) out(line)
    }

    const beats = sortedBeats(project.beats).filter((beat) => beat.target === VALUE_TRACK || names.has(beat.target))
    if (beats.length) {
        out()
        out('// Timeline')
    }
    for (const beat of beats) {
        const def = BEATS[beat.kind]
        if (!def) continue
        const body = def.code(beat, {
            name: names.get(beat.target) ?? 'value', names, variableName, objectKind: (id) => kinds.get(id),
        })
        if (!body) continue
        const ease = def.eases && beat.ease !== DEFAULT_EASE && EASES[beat.ease] ? EASES[beat.ease]! : null
        const smoothDefault = def.eases && !ease ? EASES[DEFAULT_EASE]!.code : null
        const opts = [`duration: ${num(beat.duration)}`]
        if (ease) opts.push(`ease: ${ease.code}`)
        else if (smoothDefault) opts.push(`ease: ${smoothDefault}`)
        out(`s.at(${num(beat.start)}, () => s.play(${body}, { ${opts.join(', ')} }))`)
    }
    const markers = [...project.markers].sort((a, b) => a.time - b.time)
    if (markers.length) {
        out()
        out('// Chapters')
        for (const marker of markers) out(`s.at(${num(marker.time)}, () => s.chapter(${str(marker.title)}))`)
    }
    out()
    out('// Hold on the final frame')
    out(`s.at(${num(projectDuration(project))}, () => {})`)

    const body = lines.join('\n')
    // Import exactly what the body names, in a stable order.
    for (const name of IMPORTABLE) if (new RegExp(`(^|[^.\\w'])${name}\\(?\\b`).test(body)) used.add(name)
    const imports = IMPORTABLE.filter((name, i) => used.has(name) && IMPORTABLE.indexOf(name) === i)
    const wrapped = wrapImports(imports)
    const optionParts = [`title: ${str(project.name)}`, `look: ${str(project.look)}`]
    if (project.aspect !== '16:9') optionParts.push(`aspect: ${str(project.aspect)}`)
    optionParts.push(`fps: ${project.fps}`)
    return `${wrapped}\n\nexport default film({ ${optionParts.join(', ')} }, (s) => {\n${body}\n})\n`
}

function wrapImports(names: readonly string[]): string {
    const single = `import { ${names.join(', ')} } from 'vizmatic/stage'`
    if (single.length <= 100) return single
    const rows: string[] = []
    let row = '   '
    for (const name of names) {
        if (row.length + name.length + 2 > 96) {
            rows.push(row)
            row = '   '
        }
        row += ` ${name},`
    }
    rows.push(row)
    return `import {\n${rows.join('\n')}\n} from 'vizmatic/stage'`
}
