import ts from 'typescript'

const ALLOWED_IMPORTS = new Set(['vizmatic', 'react'])
const ANIMATION_EXPORTS = new Set(['createAnimation', 'createScenes'])

interface ModuleDimensions {
    width: number
    height: number
}

function modifiersOf(node: ts.Node): readonly ts.Modifier[] {
    return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    return modifiersOf(node).some((modifier) => modifier.kind === kind)
}

function moduleError(message: string): never {
    throw new Error(message)
}

function assertAllowedImports(sourceFile: ts.SourceFile): void {
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const moduleSpecifier = statement.moduleSpecifier
            if (!ts.isStringLiteral(moduleSpecifier) || !ALLOWED_IMPORTS.has(moduleSpecifier.text)) {
                moduleError('Playground example modules can only import from "vizmatic" or "react".')
            }
            continue
        }

        if (ts.isImportEqualsDeclaration(statement)) {
            moduleError('Playground example modules can only import from "vizmatic" or "react".')
        }

        if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
            moduleError('Playground example modules can only import from "vizmatic" or "react".')
        }
    }

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            moduleError('Playground example modules cannot load dynamic imports.')
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
}

function moduleExportNames(sourceFile: ts.SourceFile): Map<string, Set<string>> {
    const names = new Map<string, Set<string>>()
    for (const statement of sourceFile.statements) {
        if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue
        if (!ts.isNamedExports(statement.exportClause)) continue

        for (const element of statement.exportClause.elements) {
            const localName = element.propertyName?.text ?? element.name.text
            const exportedName = element.name.text
            const localNames = names.get(exportedName) ?? new Set<string>()
            localNames.add(localName)
            names.set(exportedName, localNames)
        }
    }
    return names
}

function isLocallyExported(
    statement: ts.Statement,
    localName: string,
    exportedName: string,
    exportedNames: Map<string, Set<string>>,
): boolean {
    return hasModifier(statement, ts.SyntaxKind.ExportKeyword) && localName === exportedName
        || exportedNames.get(exportedName)?.has(localName) === true
}

function getDimensions(sourceFile: ts.SourceFile, exportedNames: Map<string, Set<string>>): ModuleDimensions {
    const dimensions: Partial<ModuleDimensions> = {}

    for (const statement of sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue
            const name = declaration.name.text
            if (name !== 'width' && name !== 'height') continue
            if (!isLocallyExported(statement, name, name, exportedNames)) continue

            if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) {
                moduleError(`Playground example modules must export a numeric const ${name}.`)
            }
            if (!declaration.initializer || !ts.isNumericLiteral(declaration.initializer)) {
                moduleError(`Playground example modules must export a numeric const ${name}.`)
            }

            const value = Number(declaration.initializer.text)
            if (!Number.isSafeInteger(value) || value < 1 || value > 8192) {
                moduleError(`${name} must be an integer from 1 to 8192.`)
            }
            if (dimensions[name] !== undefined) moduleError(`Playground example modules must export only one ${name}.`)
            dimensions[name] = value
        }
    }

    if (dimensions.width === undefined) moduleError('Playground example modules must export a numeric const width.')
    if (dimensions.height === undefined) moduleError('Playground example modules must export a numeric const height.')
    return { width: dimensions.width, height: dimensions.height }
}

function isCallableDeclaration(statement: ts.Statement, name: string): boolean {
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === name
    if (!ts.isVariableStatement(statement)) return false

    return statement.declarationList.declarations.some((declaration) => {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) return false
        return ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)
    })
}

function hasExportedCallable(sourceFile: ts.SourceFile, name: string, exportedNames: Map<string, Set<string>>): boolean {
    return sourceFile.statements.some((statement) => isCallableDeclaration(statement, name)
        && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || exportedNames.get(name)?.has(name) === true))
}

function stripExportModifiers(statement: ts.Statement): ts.Statement {
    if (!ts.canHaveModifiers(statement)) return statement
    const modifiers = modifiersOf(statement).filter((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword
        && modifier.kind !== ts.SyntaxKind.DefaultKeyword)
    return ts.factory.replaceModifiers(statement, modifiers)
}

/**
 * Turns a trusted repository example module into the bare JSX form accepted by the browser
 * playground. Browser-authored snippets stay untouched and remain subject to its import guard.
 */
export function toPlaygroundExample(source: string): string {
    const sourceFile = ts.createSourceFile('playground-example.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const isModule = sourceFile.statements.some((statement) => ts.isImportDeclaration(statement)
        || ts.isImportEqualsDeclaration(statement)
        || ts.isExportDeclaration(statement)
        || ts.isExportAssignment(statement)
        || hasModifier(statement, ts.SyntaxKind.ExportKeyword))

    if (!isModule) return source

    assertAllowedImports(sourceFile)
    const exportedNames = moduleExportNames(sourceFile)

    if (!hasExportedCallable(sourceFile, 'create', exportedNames)) {
        moduleError('Playground example modules must export a create(theme) function.')
    }
    const dimensions = getDimensions(sourceFile, exportedNames)
    const statements = sourceFile.statements.filter((statement) => {
        if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)
            || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) return false
        return !Array.from(ANIMATION_EXPORTS).some((name) => isCallableDeclaration(statement, name)
            && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || exportedNames.get(name)?.has(name) === true))
    }).map(stripExportModifiers)

    const transformed = ts.factory.updateSourceFile(sourceFile, statements)
    const body = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(transformed).trim()
    const prelude = [
        `width = ${dimensions.width}`,
        `height = ${dimensions.height}`,
        `const __vizmaticExampleTheme = c.bg === getThemeColors('dark').bg ? 'dark' : 'light';`,
    ].join('\n')

    return `${prelude}\n${body}\n<React.Fragment>{create(__vizmaticExampleTheme)}</React.Fragment>`
}
