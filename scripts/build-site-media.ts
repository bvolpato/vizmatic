import { mkdir } from 'node:fs/promises'
import { compileFilm } from '../src/stage/index'
import { renderFilmFrame } from '../src/stage/export'
import og from './site-films/og'

/** Render the social preview card. It is a film too, so it shares the site's look. */
export async function buildSiteMedia(): Promise<void> {
    await mkdir('docs/assets/site', { recursive: true })
    const compiled = await compileFilm(og, { background: '#0c0b09' })
    await renderFilmFrame(compiled, compiled.duration, 'docs/assets/site/og.png')
}
