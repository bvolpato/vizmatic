import ts from 'typescript'
import type { ComponentControl, ComponentControlType } from '../src/component-controls'
import { componentControlSpecs, controlLabel, numberRange, tones } from '../src/component-control-specs'

function jsxTagNameMatches(tagName: ts.JsxTagNameExpression, componentName: string): boolean {
    return ts.isIdentifier(tagName) && tagName.text === componentName
}

function firstComponentElement(sourceFile: ts.SourceFile, componentName: string): ts.JsxOpeningLikeElement | undefined {
    let match: ts.JsxOpeningLikeElement | undefined
    const visit = (node: ts.Node): void => {
        if (match) return
        if (ts.isJsxElement(node) && jsxTagNameMatches(node.openingElement.tagName, componentName)) {
            match = node.openingElement
            return
        }
        if (ts.isJsxSelfClosingElement(node) && jsxTagNameMatches(node.tagName, componentName)) {
            match = node
            return
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return match
}

function stringValue(attribute: ts.JsxAttribute): string | undefined {
    const initializer = attribute.initializer
    if (initializer && ts.isStringLiteral(initializer)) return initializer.text
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    return ts.isStringLiteral(initializer.expression) ? initializer.expression.text : undefined
}

function numberValue(attribute: ts.JsxAttribute): number | undefined {
    const initializer = attribute.initializer
    if (!initializer || !ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    const expression = initializer.expression
    if (ts.isNumericLiteral(expression)) return Number(expression.text.replaceAll('_', ''))
    if (ts.isPrefixUnaryExpression(expression)
        && (expression.operator === ts.SyntaxKind.MinusToken || expression.operator === ts.SyntaxKind.PlusToken)
        && ts.isNumericLiteral(expression.operand)) {
        const value = Number(expression.operand.text.replaceAll('_', ''))
        return expression.operator === ts.SyntaxKind.MinusToken ? -value : value
    }
    return undefined
}

function booleanValue(attribute: ts.JsxAttribute): boolean | undefined {
    const initializer = attribute.initializer
    if (!initializer) return true
    if (!ts.isJsxExpression(initializer) || !initializer.expression) return undefined
    if (initializer.expression.kind === ts.SyntaxKind.TrueKeyword) return true
    if (initializer.expression.kind === ts.SyntaxKind.FalseKeyword) return false
    return undefined
}

function addControl(
    controls: ComponentControl[],
    sourceFile: ts.SourceFile,
    attribute: ts.JsxAttribute,
    componentName: string,
    prop: string,
    type: ComponentControlType,
    value: string | number | boolean,
    options?: readonly string[],
): void {
    const control: ComponentControl = {
        prop,
        label: controlLabel(prop),
        type,
        value,
        start: attribute.getStart(sourceFile),
        end: attribute.getEnd(),
    }
    if (options) control.options = [...options]
    if (type === 'number') Object.assign(control, numberRange(prop, componentName))
    controls.push(control)
}

/** Finds editable literal attributes on the first JSX element with this exact component name. */
export function getComponentControls(source: string, componentName: string): ComponentControl[] {
    const spec = componentControlSpecs[componentName]
    if (!spec || !componentName) return []
    const sourceFile = ts.createSourceFile('component-example.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const element = firstComponentElement(sourceFile, componentName)
    if (!element) return []

    const controls: ComponentControl[] = []
    const seen = new Set<string>()
    for (const item of element.attributes.properties) {
        if (!ts.isJsxAttribute(item) || !ts.isIdentifier(item.name)) continue
        const prop = item.name.text
        if (seen.has(prop)) continue

        if (spec.text?.includes(prop)) {
            const value = stringValue(item)
            if (value !== undefined) addControl(controls, sourceFile, item, componentName, prop, 'text', value)
        } else if (prop === 'tone' && spec.tone) {
            const value = stringValue(item)
            if (value !== undefined && (tones as readonly string[]).includes(value)) {
                addControl(controls, sourceFile, item, componentName, prop, 'select', value, tones)
            }
        } else if (spec.selects?.[prop]) {
            const options = spec.selects[prop]!
            const value = stringValue(item)
            if (value !== undefined && options.includes(value)) addControl(controls, sourceFile, item, componentName, prop, 'select', value, options)
        } else if (spec.numbers?.includes(prop)) {
            const value = numberValue(item)
            const range = numberRange(prop, componentName)
            if (value !== undefined && Number.isFinite(value) && value >= range.min && value <= range.max) {
                addControl(controls, sourceFile, item, componentName, prop, 'number', value)
            }
        } else if (spec.booleans?.includes(prop)) {
            const value = booleanValue(item)
            if (value !== undefined) addControl(controls, sourceFile, item, componentName, prop, 'boolean', value)
        }

        if (controls.length >= 8) break
        if (controls.some((control) => control.prop === prop)) seen.add(prop)
    }
    return controls
}
