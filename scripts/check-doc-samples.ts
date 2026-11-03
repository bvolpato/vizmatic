import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import { SAMPLE_DIR } from './guide-paths'

/**
 * Compile every code sample from the guides. Only errors inside the samples
 * count, so a sample fails when the API it shows has changed.
 */
export async function checkDocSamples(): Promise<{ count: number; errors: string[] }> {
    const names = (await readdir(SAMPLE_DIR).catch(() => [] as string[])).filter((name) => /\.tsx?$/.test(name))
    const files = names.map((name) => join(SAMPLE_DIR, name))
    const configPath = ts.findConfigFile('.', ts.sys.fileExists, 'tsconfig.json')!
    const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, '.')
    const paths = { ...parsed.options.paths, 'vizmatic/stage/browser': ['./src/stage/browser.ts'] }
    const program = ts.createProgram(files, { ...parsed.options, paths, noEmit: true, noUnusedLocals: false, noUnusedParameters: false })
    const sampleSet = new Set(files.map((file) => ts.sys.resolvePath(file)))
    const errors: string[] = []
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
        const path = diagnostic.file?.fileName
        if (!path || !sampleSet.has(ts.sys.resolvePath(path))) continue
        const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
        errors.push(`${path}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
    }
    return { count: files.length, errors }
}
