import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'docs')
const port = Number(process.argv[3] ?? process.env.PORT ?? 4173)

const types = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
])

function resolvePath(url) {
    const parsed = new URL(url, `http://localhost:${port}`)
    const decoded = decodeURIComponent(parsed.pathname)
    const relativePath = normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
    const candidate = resolve(join(root, relativePath))
    const outsideRoot = relative(root, candidate).startsWith('..')

    return outsideRoot ? root : candidate
}

async function findFile(pathname) {
    const current = await stat(pathname).catch(() => null)
    if (current?.isFile()) return pathname
    if (current?.isDirectory()) {
        const index = join(pathname, 'index.html')
        const indexStat = await stat(index).catch(() => null)
        if (indexStat?.isFile()) return index
    }

    return join(root, 'index.html')
}

function createDocsServer() {
    return createServer(async (req, res) => {
        const file = await findFile(resolvePath(req.url ?? '/'))
        const fileStat = await stat(file).catch(() => null)

        if (!fileStat?.isFile()) {
            res.writeHead(404)
            res.end('Not found')
            return
        }

        res.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': fileStat.size,
            'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
        })
        createReadStream(file).pipe(res)
    })
}

function listen(nextPort, remainingAttempts) {
    const server = createDocsServer()
    server.on('error', (error) => {
        if (error.code === 'EADDRINUSE' && remainingAttempts > 0) {
            listen(nextPort + 1, remainingAttempts - 1)
            return
        }

        throw error
    })
    server.listen(nextPort, () => {
        console.log(`Vizmatic docs: http://127.0.0.1:${nextPort}/`)
    })
}

listen(port, 20)
