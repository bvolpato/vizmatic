#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createGunzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'

// Reads one binary record, never deserializes pickle or extracts archive paths.
const url = 'https://www.cs.toronto.edu/~kriz/cifar-10-binary.tar.gz'
const member = 'cifar-10-batches-bin/data_batch_1.bin'
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 60_000)
let source, gzip
try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`CIFAR download failed: HTTP ${response.status}`)
    source = Readable.fromWeb(response.body)
    gzip = createGunzip()
    source.on('error', error => gzip.destroy(error))
    source.pipe(gzip)
    const chunks = gzip[Symbol.asyncIterator]()
    let pending = Buffer.alloc(0), consumed = 0
    const take = async count => {
        while (pending.length < count) {
            const next = await chunks.next()
            if (next.done) throw new Error('CIFAR archive ended before the selected record')
            pending = Buffer.concat([pending, next.value])
        }
        const result = pending.subarray(0, count)
        pending = pending.subarray(count)
        consumed += count
        if (consumed > 64 * 1024 * 1024) throw new Error('Selected record was not near the start of the archive')
        return result
    }
    let record
    for (;;) {
        const header = await take(512)
        if (header.every(byte => byte === 0)) throw new Error('Selected CIFAR batch was not found')
        const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
        const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
        if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid archive member size')
        const size = Number.parseInt(sizeText, 8)
        if (name === member) {
            if (size < 3073) throw new Error('Selected CIFAR batch is truncated')
            record = await take(3073)
            break
        }
        let remaining = Math.ceil(size / 512) * 512
        while (remaining) { const count = Math.min(remaining, 64 * 1024); await take(count); remaining -= count }
    }
    if (record[0] !== 6) throw new Error('Expected the first training record to be a frog')
    const sha256 = createHash('sha256').update(record).digest('hex')
    if (sha256 !== '945dc5584f8efcf7dc58367c3b072c0a23dacc05ae824d7c77a33874a8ec83c7') {
        throw new Error('The official sample differs from the reviewed CIFAR record')
    }
    const pixels = Array.from({ length: 32 }, (_, row) => Array.from({ length: 32 }, (_, column) => {
        const index = row * 32 + column
        return [record[1 + index], record[1025 + index], record[2049 + index]]
    }))
    const outputs = ['catalog-image-tensors.tsx']
        .map(name => fileURLToPath(new URL(`../examples/${name}`, import.meta.url)))
    const originals = await Promise.all(outputs.map(output => readFile(output, 'utf8')))
    const start = '// CIFAR_SAMPLE_START', end = '// CIFAR_SAMPLE_END'
    for (const original of originals) {
        if (!original.includes(start) || !original.includes(end)) throw new Error('The CIFAR sample markers are missing')
    }
    const block = `${start}\n// Official training batch 1, record 0, label 6 (frog). Record SHA-256: ${sha256}\nexport const cifar10Pixels: RgbPixel[][] = [\n${pixels.map(row => '    [' + row.map(pixel => '[' + pixel.join(',') + ']').join(',') + '],').join('\n')}\n]\n${end}`
    for (const [index, output] of outputs.entries()) {
        const original = originals[index]
        await writeFile(output, original.slice(0, original.indexOf(start)) + block + original.slice(original.indexOf(end) + end.length))
    }
    console.log(JSON.stringify({ source: url, member, recordIndex: 0, label: 6, className: 'frog', recordSha256: sha256, outputs }))
} finally {
    clearTimeout(timeout)
    source?.unpipe(gzip)
    source?.destroy()
    gzip?.destroy()
    controller.abort()
}
