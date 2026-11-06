import { defineConfig } from 'tsup'

export default defineConfig({
    noExternal: ['fast-png', 'iobuffer'],
    dts: {
        resolve: true,
        compilerOptions: {
            paths: { 'satori/standalone': ['./node_modules/satori/dist/standalone.d.ts'] },
        },
    },
    esbuildPlugins: [{
        name: 'bundled-satori',
        setup(context) {
            context.onResolve({ filter: /^satori$/ }, () => ({ path: './satori.cjs', external: true }))
        },
    }],
})
