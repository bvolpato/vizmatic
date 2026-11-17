import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import type { CompiledFilm, CompileOverrides } from './stage'

export interface GpuFilmSource {
    file: string
    overrides: CompileOverrides
    expected: { width: number; height: number; fps: number; duration: number; title: string }
}

const sources = new WeakMap<CompiledFilm, GpuFilmSource>()

/** The CLI already knows the source module; retaining that association avoids transferring every draw list. */
export function rememberGpuSource(film: CompiledFilm, file: string): void {
    sources.set(film, {
        file: resolve(file),
        overrides: { look: film.look, fps: film.fps, bloom: film.bloom, background: film.background, imageNetwork: 'deny' },
        expected: { width: film.width, height: film.height, fps: film.fps, duration: film.duration, title: film.title },
    })
}

export function gpuSourceOf(film: CompiledFilm): GpuFilmSource | undefined { return sources.get(film) }

/** esbuild is already supplied by tsx, as it is for the local preview server. */
export async function bundleGpuFilm(source: GpuFilmSource): Promise<Uint8Array> {
    const from = createRequire(import.meta.url || __filename)
    let esbuild: typeof import('esbuild')
    try { esbuild = from('esbuild') } catch { esbuild = createRequire(from.resolve('tsx/package.json'))('esbuild') }
    const result = await esbuild.build({
        entryPoints: [source.file], bundle: true, format: 'esm', target: 'es2022', platform: 'browser',
        write: false, outfile: 'film.js', minify: true, logLevel: 'silent', jsx: 'automatic',
        plugins: [{
            name: 'vizmatic-gpu-film',
            setup(build) {
                build.onResolve({ filter: /^vizmatic\/stage$/ }, () => ({ path: './engine/stage.js', external: true }))
                build.onResolve({ filter: /^vizmatic(?:\/stage\/export)?$/ }, ({ path }) => ({
                    errors: [{ text: `GPU films import vizmatic/stage; ${path} requires the CPU backend.` }],
                }))
            },
        }],
    })
    return result.outputFiles[0].contents
}
