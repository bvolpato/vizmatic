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
    ['.md', 'text/plain; charset=utf-8'],
    ['.mp4', 'video/mp4'],
    ['.vtt', 'text/vtt; charset=utf-8'],
    ['.tsx', 'text/plain; charset=utf-8'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.xml', 'application/xml; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.ttf', 'font/ttf'],
    ['.wasm', 'application/wasm'],
    ['.woff2', 'font/woff2'],
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

        const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/)
        const headers = {
            'Cache-Control': 'no-store',
            'Content-Length': fileStat.size,
            'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
            'Accept-Ranges': 'bytes',
        }
        if (req.headers.range) {
            const suffix = range && !range[1] && range[2] ? Number(range[2]) : undefined
            const start = suffix !== undefined ? Math.max(0, fileStat.size - suffix) : Number(range?.[1] ?? 0)
            const end = suffix !== undefined || !range?.[2] ? fileStat.size - 1 : Math.min(Number(range[2]), fileStat.size - 1)
            if (!range || (!range[1] && !range[2]) || suffix === 0 || (suffix !== undefined && !Number.isSafeInteger(suffix)) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= fileStat.size) {
                res.writeHead(416, { 'Content-Range': `bytes */${fileStat.size}` })
                res.end()
                return
            }
            res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${fileStat.size}` })
            if (req.method === 'HEAD') res.end()
            else createReadStream(file, { start, end }).pipe(res)
            return
        }
        res.writeHead(200, headers)
        if (req.method === 'HEAD') res.end()
        else createReadStream(file).pipe(res)
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
        console.log(`Vizmatic docs: http://127.0.0.1:${server.address().port}/`)
    })
}

listen(port, 20)
