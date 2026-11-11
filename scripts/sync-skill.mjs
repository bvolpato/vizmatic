#!/usr/bin/env node
/**
 * Copy the skill from its one source to the second folder that tools read.
 *
 * The source is plugins/vizmatic/skills/vizmatic. The Codex plugin and the Claude Code plugin
 * install that folder. `npx skills add` and an agent that works in this repository read
 * .agents/skills/vizmatic. Each tool reads its folder from the repository, so both folders are
 * committed. Edit the source only, then run `pnpm sync:skill`. `pnpm docs:check` fails when the
 * two folders differ.
 */
import { cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'plugins', 'vizmatic', 'skills', 'vizmatic')
const copy = join(root, '.agents', 'skills', 'vizmatic')

// Remove the copy first. A file that the source no longer has must not stay in the copy.
await rm(copy, { recursive: true, force: true })
await cp(source, copy, { recursive: true })
console.log('copied plugins/vizmatic/skills/vizmatic to .agents/skills/vizmatic')
