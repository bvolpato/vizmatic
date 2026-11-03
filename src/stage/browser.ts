/** Browser entry: the engine, the player, and the <vz-film> element. */
export * from './index'
export { FilmPlayer, defineFilmElement, type PlayerOptions, type FilmLoadOptions } from './player'
import { setAssetBase } from './assets'
import { resolveLook } from './look'
import { defineFilmElement, type FilmLoadOptions } from './player'
import { compileFilm, isFilm, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

// Fonts sit beside this module on the site. In the npm package they sit at the package
// root, so the package build defines this path, and CDNs that serve the package work.
declare const __VIZMATIC_ASSET_PATH__: string | undefined
setAssetBase(new URL(typeof __VIZMATIC_ASSET_PATH__ === 'string' ? __VIZMATIC_ASSET_PATH__ : './assets/', import.meta.url).href)

const compiled = new Map<string, Promise<CompiledFilm>>()

/** Load a film module by URL and compile it once per look and background. */
export function loadFilm(src: string, options: FilmLoadOptions = {}): Promise<CompiledFilm> {
    const url = new URL(src, document.baseURI).href
    const key = `${url}|${options.look ?? ''}|${options.background ?? ''}`
    let film = compiled.get(key)
    if (!film) {
        film = import(/* @vite-ignore */ url).then((module: { default?: FilmDefinition }) => {
            if (!isFilm(module.default)) throw new Error(`${src} must export a film as its default export.`)
            const overrides: CompileOverrides = {}
            if (options.look) overrides.look = options.look as CompileOverrides['look']
            if (options.background) {
                // The ground token follows the background, so a panel filled with 'bg' still matches the page.
                const base = resolveLook(overrides.look ?? module.default.options.look)
                overrides.look = { ...base, background: options.background, colors: { ...base.colors, bg: options.background } }
                overrides.background = options.background
            }
            return compileFilm(module.default, overrides)
        })
        compiled.set(key, film)
    }
    return film
}

defineFilmElement(loadFilm)
