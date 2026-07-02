#!/usr/bin/env node

import { readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const version = packageJson.version

if (!version) {
    throw new Error('package.json version is required')
}

async function updateJson(path, update) {
    const fullPath = join(root, path)
    const data = JSON.parse(await readFile(fullPath, 'utf8'))
    update(data)
    await writeFile(fullPath, `${JSON.stringify(data, null, 2)}\n`)
}

await updateJson('plugins/vizmatic/.codex-plugin/plugin.json', (plugin) => {
    plugin.version = version
})

await updateJson('plugins/vizmatic/.claude-plugin/plugin.json', (plugin) => {
    plugin.version = version
})

await updateJson('.claude-plugin/marketplace.json', (marketplace) => {
    const plugin = marketplace.plugins?.find((entry) => entry.name === 'vizmatic')
    if (!plugin) {
        throw new Error('Claude marketplace missing vizmatic plugin')
    }
    plugin.version = version
})
