import { existsSync } from 'fs'
import { resolve } from 'path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import * as primitives from '../src/primitives'
import { Watermark } from '../src/brand'
import { preparePlaygroundSource } from '../src/playground-source'
import {
    catalogComponentCount,
    catalogUtilities,
    componentCatalog,
} from '../scripts/component-catalog'

describe('component catalog', () => {
    it('covers every public primitive function exactly once', () => {
        const primitiveFunctions = Object.entries(primitives)
            .filter(([, value]) => typeof value === 'function')
            .map(([name]) => name)
            .sort()
        const componentNames = componentCatalog.flatMap((category) =>
            category.components.map((component) => component.name))
        const primitiveComponentNames = componentNames.filter((name) => name !== Watermark.name)
        const coveredExports = [...primitiveComponentNames, ...catalogUtilities].sort()

        expect(new Set(componentNames).size).toBe(componentNames.length)
        expect(componentNames).toHaveLength(catalogComponentCount)
        expect(componentNames).toContain(Watermark.name)
        expect(coveredExports).toEqual(primitiveFunctions)
    })

    it('keeps every category useful and backed by a rendered example', () => {
        expect(componentCatalog.length).toBeGreaterThanOrEqual(6)
        for (const category of componentCatalog) {
            expect(category.description.length).toBeGreaterThan(20)
            expect(category.components.length).toBeGreaterThan(0)
            expect(existsSync(`examples/${category.source}.tsx`)).toBe(true)
            for (const component of category.components) {
                expect(component.description.length).toBeGreaterThan(20)
            }
        }
    })

    it('typechecks copied examples against the public component API', () => {
        const components = componentCatalog.flatMap((category) => category.components)
        const virtualPath = resolve('.catalog-example-check.tsx')
        const declarations = components.map(({ name }) =>
            `declare const ${name}: AutoTheme<typeof api.${name}>;`).join('\n')
        const examples = components.map(({ name, example }, index) => {
            const prepared = preparePlaygroundSource(example)
            return `// ${name}\n{\n${prepared.setup}\nconst example${index} = (\n${prepared.jsx}\n);\n}`
        }).join('\n')
        const source = `import React from 'react';
import * as api from './src/index';
type AutoTheme<T> = T extends (props: infer P) => infer R
    ? (props: Omit<P, 'c'> & { c?: api.ThemeColors }) => R : T;
declare const c: api.ThemeColors;
declare const wrapWithWatermark: typeof api.wrapWithWatermark;
${declarations}
${examples}`
        const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
        const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
        options.noUnusedLocals = false
        options.noUnusedParameters = false
        const host = ts.createCompilerHost(options)
        const getSourceFile = host.getSourceFile.bind(host)
        host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) =>
            fileName === virtualPath
                ? ts.createSourceFile(fileName, source, languageVersion, true, ts.ScriptKind.TSX)
                : getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        const program = ts.createProgram([virtualPath, resolve('src/types.d.ts')], options, host)
        const diagnostics = ts.getPreEmitDiagnostics(program)
        expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([])
    }, 15_000)
})
