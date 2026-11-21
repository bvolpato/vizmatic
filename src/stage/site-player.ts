/**
 * Minimal browser player entry for the website.
 *
 * Registers `<vz-film>` and loads films on demand without pulling the checker,
 * narration helpers, 3D engine, or widgets into the initial page chunk. Films
 * import what they need from `vizmatic/stage`, and esbuild splitting shares the
 * core clock, asset base, and look state across `stage.js` and every film.
 */
export { FilmPlayer, defineFilmElement, type PlayerOptions, type FilmLoadOptions, type VzFilmElement } from './player'
export { setAssetBase } from './assets'
export { resolveLook } from './look'
export { compileFilm, isFilm, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

import { setAssetBase } from './assets'
import { resolveLook } from './look'
import { defineFilmElement, type FilmLoadOptions } from './player'
import { compileFilm, isFilm, type CompiledFilm, type CompileOverrides, type FilmDefinition } from './stage'

declare const __VIZMATIC_ASSET_PATH__: string | undefined
setAssetBase(new URL(typeof __VIZMATIC_ASSET_PATH__ === 'string' ? __VIZMATIC_ASSET_PATH__ : './assets/', import.meta.url).href)

const MAX_COMPILED_FILMS = 10
const compiled = new Map<string, Promise<CompiledFilm>>()

/** Load a film module by URL and compile it once per look and background, bounded by LRU. */
export function loadFilm(src: string, options: FilmLoadOptions = {}): Promise<CompiledFilm> {
    const url = new URL(src, document.baseURI).href
    const key = `${url}|${options.look ?? ''}|${options.background ?? ''}`
    let film = compiled.get(key)
    if (film) {
        compiled.delete(key)
        compiled.set(key, film)
        return film
    }
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
    }).catch((error) => {
        compiled.delete(key)
        throw error
    })
    compiled.set(key, film)
    if (compiled.size > MAX_COMPILED_FILMS) {
        const oldest = compiled.keys().next().value
        if (oldest !== undefined) compiled.delete(oldest)
    }
    return film
}

defineFilmElement(loadFilm)
