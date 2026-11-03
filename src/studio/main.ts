import { setAssetBase } from '../stage/assets'
import { App } from './app'

const assets = new URL('assets/studio/', document.baseURI).href
setAssetBase(new URL('assets/', assets).href)

const mount = document.getElementById('studio')
if (!mount) throw new Error('The Studio page is missing its mount point.')
const app = new App(assets)
mount.replaceWith(app.root)
app.view.layout()
void app.start()
;(window as unknown as { vizmaticStudio?: App }).vizmaticStudio = app
