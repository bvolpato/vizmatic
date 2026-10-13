import { resolve } from 'path'
import ts from 'typescript'

export type ComponentPropLiteral = string | number | boolean | null

export interface ComponentPropMetadata {
    name: string
    type: string
    required: boolean
    allowedValuesRef?: string
    literalValuesRef?: string
    description?: string
}

export interface ComponentPropMetadataBundle {
    enums: Record<string, ComponentPropLiteral[]>
    propsByComponent: Record<string, ComponentPropMetadata[]>
}

interface ExtractedProp extends ComponentPropMetadata {
    finiteValues?: ComponentPropLiteral[]
    literalSuggestions?: ComponentPropLiteral[]
    enumName?: string
}

function readLiteralValues(checker: ts.TypeChecker, type: ts.Type): ComponentPropLiteral[] | undefined {
    const members = type.isUnion() ? type.types : [type]
    const values: ComponentPropLiteral[] = []

    for (const member of members) {
        if (member.flags & ts.TypeFlags.Undefined) continue
        if (member.flags & ts.TypeFlags.StringLiteral) {
            values.push((member as ts.StringLiteralType).value)
            continue
        }
        if (member.flags & ts.TypeFlags.NumberLiteral) {
            values.push((member as ts.NumberLiteralType).value)
            continue
        }
        if (member.flags & ts.TypeFlags.BooleanLiteral) {
            values.push(checker.typeToString(member) === 'true')
            continue
        }
        if (member.flags & ts.TypeFlags.Null) {
            values.push(null)
            continue
        }
        return undefined
    }

    return values.length > 0 ? values : undefined
}

/** Literal branches are useful presets when the remaining branch is source-only, such as a callback. */
function readLiteralSuggestions(checker: ts.TypeChecker, type: ts.Type): ComponentPropLiteral[] | undefined {
    const members = type.isUnion() ? type.types : [type]
    const values: ComponentPropLiteral[] = []
    let hasCallableBranch = false

    for (const member of members) {
        if (member.flags & ts.TypeFlags.Undefined) continue
        if (member.flags & ts.TypeFlags.StringLiteral) values.push((member as ts.StringLiteralType).value)
        else if (member.flags & ts.TypeFlags.NumberLiteral) values.push((member as ts.NumberLiteralType).value)
        else if (member.flags & ts.TypeFlags.BooleanLiteral) values.push(checker.typeToString(member) === 'true')
        else if (member.flags & ts.TypeFlags.Null) values.push(null)
        else if (member.getCallSignatures().length > 0) hasCallableBranch = true
        else return undefined
    }

    return hasCallableBranch && values.length > 0 ? values : undefined
}

function aliasName(type: ts.Type): string | undefined {
    if (type.aliasSymbol?.name && type.aliasSymbol.name !== '__type') return type.aliasSymbol.name
    if (!type.isUnion()) return undefined

    const names = [...new Set(type.types
        .filter((member) => !(member.flags & ts.TypeFlags.Undefined))
        .map((member) => member.aliasSymbol?.name)
        .filter((name): name is string => Boolean(name && name !== '__type')))]
    return names.length === 1 ? names[0] : undefined
}

function componentExports(program: ts.Program): Map<string, ts.Symbol> {
    const entry = program.getSourceFile(resolve('src/index.ts'))
    if (!entry) throw new Error('Could not load src/index.ts for component prop extraction.')
    const moduleSymbol = program.getTypeChecker().getSymbolAtLocation(entry)
    if (!moduleSymbol) throw new Error('Could not resolve the package exports in src/index.ts.')
    return new Map(program.getTypeChecker().getExportsOfModule(moduleSymbol).map((symbol) => [symbol.name, symbol]))
}

function buildProgram(): ts.Program {
    const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
    if (config.error) {
        throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
    }
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd(), {}, 'tsconfig.json')
    const diagnostics = parsed.errors
    if (diagnostics.length > 0) {
        throw new Error(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'))
    }
    return ts.createProgram({ rootNames: [resolve('src/index.ts')], options: parsed.options })
}

function extractComponentProps(
    checker: ts.TypeChecker,
    exports: Map<string, ts.Symbol>,
    componentName: string,
): ExtractedProp[] {
    const exportedSymbol = exports.get(componentName)
    if (!exportedSymbol) throw new Error(`Component ${componentName} is not exported from src/index.ts.`)
    const symbol = exportedSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exportedSymbol)
        : exportedSymbol
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!declaration) throw new Error(`Component ${componentName} has no value declaration.`)

    const componentType = checker.getTypeOfSymbolAtLocation(symbol, declaration)
    const signature = componentType.getCallSignatures()[0]
    const propsParameter = signature?.getParameters()[0]
    if (!signature || !propsParameter) {
        throw new Error(`Component ${componentName} does not expose a callable props signature.`)
    }

    const parameterLocation = propsParameter.valueDeclaration ?? signature.declaration ?? declaration
    const propsType = checker.getTypeOfSymbolAtLocation(propsParameter, parameterLocation)
    return checker.getPropertiesOfType(propsType).map((prop) => {
        const propDeclaration = prop.valueDeclaration ?? prop.declarations?.[0] ?? parameterLocation
        const propDeclarationType = ts.isPropertySignature(propDeclaration) || ts.isPropertyDeclaration(propDeclaration)
            ? propDeclaration.type
            : undefined
        const propType = propDeclarationType
            ? checker.getTypeFromTypeNode(propDeclarationType)
            : checker.getTypeOfSymbolAtLocation(prop, propDeclaration)
        const docs = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim()
        const extracted: ExtractedProp = {
            name: prop.name,
            type: checker.typeToString(propType, propDeclaration),
            required: !(prop.flags & ts.SymbolFlags.Optional),
        }
        const values = readLiteralValues(checker, propType)
        if (values) {
            extracted.finiteValues = values
            extracted.enumName = aliasName(propType)
        } else {
            const suggestions = readLiteralSuggestions(checker, propType)
            if (suggestions) {
                extracted.literalSuggestions = suggestions
                extracted.enumName = aliasName(propType)
            }
        }
        if (docs) extracted.description = docs
        return extracted
    }).sort((left, right) => left.name.localeCompare(right.name))
}

/** Extract compact prop contracts from the real package-root component signatures. */
export function buildComponentPropMetadata(componentNames: readonly string[]): ComponentPropMetadataBundle {
    const program = buildProgram()
    const checker = program.getTypeChecker()
    const exports = componentExports(program)
    const extracted = new Map(componentNames.map((name) => [name, extractComponentProps(checker, exports, name)]))
    const enumValues = new Map<string, ComponentPropLiteral[]>()
    const enumIdsByValues = new Map<string, string>()
    const usedEnumIds = new Set<string>()
    let generatedEnumId = 1

    for (const props of extracted.values()) {
        for (const prop of props) {
            const values = prop.finiteValues ?? prop.literalSuggestions
            if (!values) continue
            const valuesKey = literalValuesKey(values)
            if (enumIdsByValues.has(valuesKey)) continue

            const preferred = prop.enumName
            let id = preferred && !usedEnumIds.has(preferred) ? preferred : undefined
            if (!id) {
                while (usedEnumIds.has(`values${generatedEnumId}`)) generatedEnumId += 1
                id = `values${generatedEnumId++}`
            }
            usedEnumIds.add(id)
            enumValues.set(id, values)
            enumIdsByValues.set(valuesKey, id)
        }
    }

    const propsByComponent: Record<string, ComponentPropMetadata[]> = {}
    for (const [name, props] of extracted) {
        propsByComponent[name] = props.map(({ finiteValues, literalSuggestions, enumName: _enumName, ...prop }) => {
            if (finiteValues) prop.allowedValuesRef = enumIdsByValues.get(literalValuesKey(finiteValues))
            if (literalSuggestions) prop.literalValuesRef = enumIdsByValues.get(literalValuesKey(literalSuggestions))
            return prop
        })
    }

    return {
        enums: Object.fromEntries(enumValues),
        propsByComponent,
    }
}

function literalValuesKey(values: ComponentPropLiteral[]): string {
    return JSON.stringify([...values].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))))
}
