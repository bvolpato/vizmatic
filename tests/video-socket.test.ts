import { spawnSync } from 'child_process'
import { once } from 'events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import type { AddressInfo, Server, Socket } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderRgbaVideo } from '../src/video'

type Net = typeof import('net')

/**
 * The export gets `createServer` and `connect` through this record. So a test can see each socket of the
 * loopback pair, and it can put another connection in front of the pair.
 */
const watch = vi.hoisted(() => ({
    net: undefined as unknown,
    servers: [] as unknown[],
    addresses: [] as unknown[],
    accepted: [] as unknown[],
    clients: [] as unknown[],
    /** Replaces the connection of the export to its own port. */
    connect: undefined as unknown,
    /** Runs for each accepted connection, before the export sees it. */
    onConnection: undefined as unknown,
}))
vi.mock('net', async (importOriginal) => {
    const actual = await importOriginal<Net>()
    watch.net = actual
    return {
        ...actual,
        createServer: (...args: Parameters<Net['createServer']>) => {
            const server = actual.createServer(...args)
            watch.servers.push(server)
            server.prependListener('listening', () => { watch.addresses.push(server.address()) })
            server.prependListener('connection', (socket) => {
                watch.accepted.push(socket)
                ;(watch.onConnection as ((socket: Socket) => void) | undefined)?.(socket)
            })
            return server
        },
        connect: (port: number, host: string) => {
            const replace = watch.connect as ((port: number, host: string) => Socket) | undefined
            const socket = replace ? replace(port, host) : actual.connect(port, host)
            watch.clients.push(socket)
            return socket
        },
    }
})

const net = () => watch.net as Net
const servers = () => watch.servers as Server[]
const accepted = () => watch.accepted as Socket[]
const clients = () => watch.clients as Socket[]

const onMac = process.platform === 'darwin'
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0
const width = 640, height = 360
/** Frames larger than the buffers between the two programs, and no two of them equal. */
const frames = Array.from({ length: 4 }, (_, index) => {
    const frame = new Uint8Array(width * height * 4)
    let state = index + 1
    for (let i = 0; i < frame.length; i++) {
        state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
        frame[i] = state >> 16
    }
    return frame
})
const allFrames = Buffer.concat(frames)

let directory: string
/** A stand-in for FFmpeg: a shell script. `copy` writes its input to its last argument, the output path. */
async function encoder(name: string, body: string): Promise<string> {
    const path = join(directory, `${name}.sh`)
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    return path
}
const copy = () => encoder('copy', 'for last; do :; done\nexec cat > "$last"')
const options = (ffmpegPath: string | undefined, name = 'out.raw') => ({ width, height, duration: 400, fps: 10, outputPath: join(directory, name), ffmpegPath })
const renderAll = (ffmpegPath: string | undefined, name?: string) => renderRgbaVideo(({ index }) => frames[index]!, options(ffmpegPath, name))

beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vizmatic-video-socket-'))
    watch.servers.length = watch.addresses.length = watch.accepted.length = watch.clients.length = 0
    watch.connect = watch.onConnection = undefined
    delete process.env.VIZMATIC_FFMPEG_PIPE
})
afterEach(async () => {
    delete process.env.VIZMATIC_FFMPEG_PIPE
    for (const socket of [...accepted(), ...clients()]) socket.destroy()
    await rm(directory, { recursive: true, force: true })
})

/** Every socket and server that the export made is closed. */
function expectAllClosed(): void {
    expect(servers().map((server) => server.listening)).toEqual(servers().map(() => false))
    expect(accepted().map((socket) => socket.destroyed)).toEqual(accepted().map(() => true))
    expect(clients().map((socket) => socket.destroyed)).toEqual(clients().map(() => true))
}

// The export uses the loopback socket on macOS only, so these tests skip on every other system.
describe.skipIf(!onMac)('the loopback socket to the encoder (macOS only)', () => {
    it('carries every frame through a pair on the loopback address, and closes each end and the server', async () => {
        const output = await renderAll(await copy())
        expect(Buffer.compare(await readFile(output.outputPath), allFrames)).toBe(0)
        // One server, and it listens on the loopback address only.
        expect(watch.addresses).toEqual([{ address: '127.0.0.1', family: 'IPv4', port: (watch.addresses[0] as AddressInfo).port }])
        expect(accepted()).toHaveLength(1)
        expect(clients()).toHaveLength(1)
        // The frames went through the pair, and not through the pipe of the child.
        expect(accepted()[0]!.bytesWritten).toBe(allFrames.length)
        expectAllClosed()
    })

    it('closes each end and the server after the encoder fails', async () => {
        const failing = await encoder('fail', 'head -c 100000 > /dev/null\necho "stopped early" >&2\nexit 4')
        await expect(renderAll(failing)).rejects.toThrow(/FFmpeg failed.*stopped early/s)
        expect(accepted()).toHaveLength(1)
        expectAllClosed()
    })

    it('closes each end and the server after an abort', async () => {
        const controller = new AbortController()
        const pending = renderRgbaVideo(({ index }) => index === 0 ? frames[0]! : new Promise<Uint8Array>(() => {}), { ...options(await copy()), signal: controller.signal })
        setTimeout(() => controller.abort(), 150)
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(accepted()).toHaveLength(1)
        expectAllClosed()
    })

    it('takes the pipe, and destroys every connection, when another connection reaches the port first', async () => {
        let other: Socket | undefined
        // Two connections go to the port in one turn of the loop. The one that is not the export's is first.
        watch.connect = (port: number, host: string) => {
            other = net().connect(port, host)
            other.on('error', () => {})
            return net().connect(port, host)
        }
        const output = await renderAll(await copy())
        // The export did not trust the first connection: the frames went through the pipe.
        expect(Buffer.compare(await readFile(output.outputPath), allFrames)).toBe(0)
        expect(accepted().length).toBeGreaterThanOrEqual(1)
        expect(accepted().map((socket) => socket.bytesWritten)).toEqual(accepted().map(() => 0))
        expectAllClosed()
        // The other connection was closed from the side of the export.
        if (!other!.destroyed) await once(other!, 'close')
        expect(other!.bytesRead).toBe(0)
    })

    it.each([
        ['another address, with the port of its client', 'remoteAddress', '192.0.2.7'],
        ['another port of the loopback address', 'remotePort', 9],
    ] as const)('does not take a connection from %s', async (_name, property, value) => {
        // The one connection that arrives, seen as if it came from another place than the client of the export.
        watch.onConnection = (socket: Socket) => { Object.defineProperty(socket, property, { value }) }
        const output = await renderAll(await copy())
        expect(Buffer.compare(await readFile(output.outputPath), allFrames)).toBe(0)
        expect(accepted()).toHaveLength(1)
        expect(accepted()[0]!.bytesWritten).toBe(0)
        expectAllClosed()
    })

    it('takes the pipe after 2 seconds when the connection never completes, and closes the server', async () => {
        // A socket that never connects, as when a firewall drops the packets.
        watch.connect = () => new (net().Socket)()
        const started = performance.now()
        const output = await renderAll(await copy())
        const elapsed = performance.now() - started
        expect(Buffer.compare(await readFile(output.outputPath), allFrames)).toBe(0)
        expect(elapsed).toBeGreaterThan(1_900)
        expect(accepted()).toHaveLength(0)
        expectAllClosed()
    }, 30_000)

    it('stops listening at the first connection, also while it waits for its own', async () => {
        let other: Socket | undefined
        // Another connection reaches the port, and the connection of the export never completes.
        watch.connect = (port: number, host: string) => {
            other = net().connect(port, host)
            other.on('error', () => {})
            return new (net().Socket)()
        }
        let listening: boolean | undefined
        setTimeout(() => { listening = servers()[0]?.listening }, 900)
        const output = await renderAll(await copy())
        expect(Buffer.compare(await readFile(output.outputPath), allFrames)).toBe(0)
        expect(accepted()).toHaveLength(1)
        expect(listening).toBe(false)
        expect(accepted()[0]!.bytesWritten).toBe(0)
        expectAllClosed()
        if (!other!.destroyed) await once(other!, 'close')
    }, 30_000)

    it('reports an encoder that closes its input and keeps running', async () => {
        // The encoder closes its input at once, and stays alive. The first frame comes after that.
        const closing = await encoder('close-input', 'exec 0<&-\nexec sleep 3')
        const late = async ({ index }: { index: number }) => {
            if (index === 0) await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
            return frames[index]!
        }
        await expect(renderRgbaVideo(late, options(closing))).rejects.toThrow(/FFmpeg failed/)
        expectAllClosed()
    }, 30_000)

    it('reports a write that the connection resets as a failure of the encoder', async () => {
        // The write of a frame fails as the kernel reports a reset: an error on the socket, and the same error for the write.
        watch.onConnection = (socket: Socket) => {
            socket.write = ((_chunk: unknown, ...rest: unknown[]) => {
                const done = rest.find((entry) => typeof entry === 'function') as ((error: Error) => void) | undefined
                const reset = Object.assign(new Error('write ECONNRESET'), { code: 'ECONNRESET', syscall: 'write' })
                process.nextTick(() => {
                    socket.emit('error', reset)
                    done?.(reset)
                })
                return false
            }) as Socket['write']
        }
        await expect(renderAll(await encoder('wait', 'exec sleep 3'))).rejects.toThrow(/FFmpeg failed.*ECONNRESET/s)
        expectAllClosed()
    }, 30_000)

    it.skipIf(!hasFfmpeg)('fails when the encoder gets no frame, and does not report a movie with no frames', async () => {
        // Another program takes the frames: the export writes them with success, and FFmpeg reads the end of
        // its input with no frame. To get there, the end that goes to FFmpeg is a connection to another
        // server, with the port and the address of the connection that takes the frames. That server closes
        // the input of FFmpeg when all the frames are taken.
        let toFfmpeg: Socket | undefined
        const elsewhere = net().createServer((socket) => { toFfmpeg = socket })
        elsewhere.listen(0, '127.0.0.1')
        await once(elsewhere, 'listening')
        let taker: Socket | undefined
        watch.connect = (port: number, host: string) => {
            const other = net().connect(port, host)
            other.on('error', () => {})
            other.on('data', () => { if (other.bytesRead === allFrames.length) toFfmpeg?.end() })
            taker = other
            const forFfmpeg = net().connect((elsewhere.address() as AddressInfo).port, '127.0.0.1')
            Object.defineProperty(forFfmpeg, 'localPort', { get: () => other.localPort })
            Object.defineProperty(forFfmpeg, 'localAddress', { get: () => other.localAddress })
            return forFfmpeg
        }
        try {
            await expect(renderAll(undefined, 'empty.mp4')).rejects.toThrow(/FFmpeg failed/)
            // The frames did go to the other program, so only the encoder can tell that it got none.
            expect(taker!.bytesRead).toBe(allFrames.length)
            expect(await readdir(directory)).toEqual([])
        } finally {
            taker?.destroy()
            elsewhere.close()
        }
    }, 30_000)
})

describe('the pipe to the encoder', () => {
    it('is forced by VIZMATIC_FFMPEG_PIPE=1, and gives the same bytes as the socket', async () => {
        const stand = await copy()
        process.env.VIZMATIC_FFMPEG_PIPE = '1'
        const piped = await renderAll(stand, 'pipe.raw')
        expect(servers()).toHaveLength(0)
        expect(Buffer.compare(await readFile(piped.outputPath), allFrames)).toBe(0)
        delete process.env.VIZMATIC_FFMPEG_PIPE
        const standard = await renderAll(stand, 'default.raw')
        // The socket is the default on macOS only.
        expect(servers()).toHaveLength(onMac ? 1 : 0)
        expect(Buffer.compare(await readFile(standard.outputPath), allFrames)).toBe(0)
    })

    it.skipIf(!hasFfmpeg)('gives the same MP4 as the default path', async () => {
        const standard = await renderAll(undefined, 'default.mp4')
        process.env.VIZMATIC_FFMPEG_PIPE = '1'
        const piped = await renderAll(undefined, 'pipe.mp4')
        expect(servers()).toHaveLength(onMac ? 1 : 0)
        expect(Buffer.compare(await readFile(piped.outputPath), await readFile(standard.outputPath))).toBe(0)
    }, 60_000)
})
