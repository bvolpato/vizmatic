import { defineConfig } from 'tsup'

export default defineConfig({
    noExternal: ['fast-png', 'iobuffer'],
})
