import { readdir, readFile, writeFile } from 'node:fs/promises'
import { brotliCompressSync, constants } from 'node:zlib'

const sourceDir = new URL('../assets/emoji/', import.meta.url)
const output = new URL('../assets/emoji.json.br', import.meta.url)
const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.svg')).sort()
const entries = await Promise.all(files.map(async (file) => [file, await readFile(new URL(file, sourceDir), 'utf8')]))
const json = Buffer.from(JSON.stringify(Object.fromEntries(entries)))
const compressed = brotliCompressSync(json, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
})

const summary = `${files.length} emoji assets: ${json.length.toLocaleString()} -> ${compressed.length.toLocaleString()} bytes`
if (process.argv.includes('--check')) {
    const existing = await readFile(output).catch(() => undefined)
    if (!existing?.equals(compressed)) {
        throw new Error('assets/emoji.json.br is stale; run pnpm assets:emoji')
    }
    console.log(`emoji bundle ok: ${summary}`)
} else {
    await writeFile(output, compressed)
    console.log(`bundled ${summary}`)
}
