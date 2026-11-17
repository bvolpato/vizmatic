// Browser-only implementation of bloom-kernel.mjs. One context serves every player;
// the CPU kernel remains the fallback and the reference for export parity.
const VERTEX = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D source;
out vec4 color;
// Keep the upload premultiplied and control nearest-byte rounding here, instead
// of relying on the browser's unpremultiplication during texture upload.
vec4 pixel(ivec2 p) {
    vec4 stored = floor(texelFetch(source, p, 0) * 255.0 + 0.5);
    return vec4(stored.a == 0.0 ? vec3(0.0) : floor(stored.rgb * 255.0 / stored.a + 0.5), stored.a);
}
`

const DOWNSAMPLE = `${HEADER}
uniform int factor;
uniform vec3 background;
void main() {
    ivec2 start = ivec2(gl_FragCoord.xy) * factor;
    vec3 sum = vec3(0.0);
    for (int y = 0; y < factor; ++y)
        for (int x = 0; x < factor; ++x)
            sum += pixel(start + ivec2(x, y)).rgb;
    color = vec4(max(vec3(0.0), sum / float(factor * factor) - background), 0.0);
}`

const BLUR = `${HEADER}
uniform ivec2 direction;
uniform int radius;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy), end = textureSize(source, 0) - 1;
    vec3 sum = vec3(0.0);
    for (int k = -radius; k <= radius; ++k)
        sum += texelFetch(source, clamp(p + k * direction, ivec2(0), end), 0).rgb;
    color = vec4(sum / float(2 * radius + 1), 0.0);
}`

const COMPOSITE = `${HEADER}
uniform sampler2D nearLight;
uniform sampler2D middleLight;
uniform sampler2D farLight;
uniform vec3 factors;
uniform float gain;
uniform bool dither;
// Explicit interpolation preserves the kernel's cell centers and dropped edge
// cells, without depending on float-linear filtering or its subtexel precision.
vec3 light(sampler2D layer, vec2 p, float factor) {
    vec2 at = (p + 0.5) / factor - 0.5;
    ivec2 end = textureSize(layer, 0) - 1;
    ivec2 a = clamp(ivec2(floor(at)), ivec2(0), end), b = min(a + 1, end);
    vec2 t = clamp(at - vec2(a), 0.0, 1.0);
    return mix(mix(texelFetch(layer, a, 0).rgb, texelFetch(layer, ivec2(b.x, a.y), 0).rgb, t.x),
               mix(texelFetch(layer, ivec2(a.x, b.y), 0).rgb, texelFetch(layer, b, 0).rgb, t.x), t.y);
}
void main() {
    // Uploaded row zero is the top of the 2D canvas. Only this final pass flips
    // rows into the WebGL drawing buffer's bottom-left coordinate system.
    ivec2 p = ivec2(gl_FragCoord.x, float(textureSize(source, 0).y) - gl_FragCoord.y);
    vec4 original = pixel(p);
    vec3 glow = (light(nearLight, vec2(p), factors.x) * 0.55
               + light(middleLight, vec2(p), factors.y) * 0.30
               + light(farLight, vec2(p), factors.z) * 0.15) * gain;
    float noise = fract(52.9829189 * fract(dot(vec2(p), vec2(0.06711056, 0.00583715))));
    float threshold = !dither || original.a == 0.0 ? 0.0 : (floor(noise * 256.0) + 0.5) / 256.0;
    vec3 rgb = floor(original.rgb + min(vec3(255.0), glow) * (255.0 - original.rgb) / 255.0 + threshold);
    float alpha = original.a / 255.0;
    color = vec4(rgb / 255.0 * alpha, alpha);
}`

interface Program {
    value: WebGLProgram
    uniforms: Record<string, WebGLUniformLocation | null>
}

interface Surface {
    texture: WebGLTexture
    framebuffer: WebGLFramebuffer
    width: number
    height: number
}

interface Size {
    source: WebGLTexture
    layers: { factor: number; radius: number; pair: [Surface, Surface] }[]
    bytes: number
}

const CACHE_BYTES = 96 * 1024 * 1024

class BloomRenderer {
    private readonly programs: Program[] = []
    private readonly textures = new Set<WebGLTexture>()
    private readonly framebuffers = new Set<WebGLFramebuffer>()
    private readonly sizes = new Map<string, Size>()
    private readonly maxSize: number

    constructor(private readonly canvas: HTMLCanvasElement, private readonly gl: WebGL2RenderingContext) {
        this.maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    }

    init(): void {
        const gl = this.gl
        // Some Chromium versions accept failIfMajorPerformanceCaveat even for
        // SwiftShader. Software WebGL adds a costly extra rasterization process.
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
        if (/SwiftShader|llvmpipe|softpipe|software rasterizer|Microsoft Basic Render/i.test(renderer)) {
            throw new Error('Use CPU bloom for software WebGL')
        }
        if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float bloom targets unavailable')
    }

    private initPrograms(): void {
        const gl = this.gl
        gl.disable(gl.DITHER)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
        for (const [fragment, uniforms] of [
            [DOWNSAMPLE, ['source', 'factor', 'background']],
            [BLUR, ['source', 'direction', 'radius']],
            [COMPOSITE, ['source', 'nearLight', 'middleLight', 'farLight', 'factors', 'gain', 'dither']],
        ] as const) this.programs.push(this.program(fragment, uniforms))
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Bloom initialization failed')
    }

    private program(fragment: string, names: readonly string[]): Program {
        const gl = this.gl, value = gl.createProgram()
        if (!value) throw new Error('Bloom program allocation failed')
        const shaders: WebGLShader[] = []
        try {
            for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, fragment]] as const) {
                const shader = gl.createShader(type)
                if (!shader) throw new Error('Bloom shader allocation failed')
                shaders.push(shader)
                gl.shaderSource(shader, source)
                gl.compileShader(shader)
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Bloom shader failed')
                gl.attachShader(value, shader)
            }
            gl.linkProgram(value)
            if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) ?? 'Bloom program failed')
            return { value, uniforms: Object.fromEntries(names.map(name => [name, gl.getUniformLocation(value, name)])) }
        } catch (error) {
            gl.deleteProgram(value)
            throw error
        } finally {
            for (const shader of shaders) gl.deleteShader(shader)
        }
    }

    private texture(width: number, height: number, float: boolean): WebGLTexture {
        const gl = this.gl, texture = gl.createTexture()
        if (!texture) throw new Error('Bloom texture allocation failed')
        this.textures.add(texture)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RGBA32F : gl.RGBA8, width, height)
        return texture
    }

    private surface(width: number, height: number): Surface {
        const gl = this.gl, texture = this.texture(width, height, true), framebuffer = gl.createFramebuffer()
        if (!framebuffer) throw new Error('Bloom framebuffer allocation failed')
        this.framebuffers.add(framebuffer)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete bloom framebuffer')
        return { texture, framebuffer, width, height }
    }

    private release(size: Size): void {
        const gl = this.gl
        for (const texture of [size.source, ...size.layers.flatMap(layer => layer.pair.map(surface => surface.texture))]) {
            gl.deleteTexture(texture)
            this.textures.delete(texture)
        }
        for (const layer of size.layers) for (const surface of layer.pair) {
            gl.deleteFramebuffer(surface.framebuffer)
            this.framebuffers.delete(surface.framebuffer)
        }
    }

    private size(width: number, height: number): Size | null {
        if (width < 1 || height < 1 || width > this.maxSize || height > this.maxSize) return null
        const key = `${width}x${height}`, cached = this.sizes.get(key)
        if (cached) {
            this.sizes.delete(key)
            this.sizes.set(key, cached)
            return cached
        }
        const layers = [[4, 3], [8, 4], [16, 4]].map(([base, radius]) => {
            const factor = Math.max(1, Math.min(width, height, Math.round(base * width / 1920)))
            return { factor, radius, width: Math.max(1, Math.floor(width / factor)), height: Math.max(1, Math.floor(height / factor)) }
        })
        const bytes = width * height * 4 + layers.reduce((sum, layer) => sum + layer.width * layer.height * 32, 0)
        if (bytes > CACHE_BYTES) return null
        let held = [...this.sizes.values()].reduce((sum, size) => sum + size.bytes, 0)
        // Two hot sizes cover a gallery preview and its expanded player. Evict
        // before allocating, so alternating players cannot grow GPU memory.
        for (const [oldKey, old] of this.sizes) {
            if (this.sizes.size < 2 && held + bytes <= CACHE_BYTES) break
            this.release(old)
            this.sizes.delete(oldKey)
            held -= old.bytes
        }
        const size: Size = {
            source: this.texture(width, height, false), bytes,
            layers: layers.map(layer => ({ ...layer, pair: [this.surface(layer.width, layer.height), this.surface(layer.width, layer.height)] })),
        }
        if (this.gl.getError() !== this.gl.NO_ERROR) throw new Error('Bloom target allocation failed')
        this.sizes.set(key, size)
        return size
    }

    private bind(texture: WebGLTexture, unit = 0): void {
        this.gl.activeTexture(this.gl.TEXTURE0 + unit)
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    }

    private pass(surface: Surface): void {
        const gl = this.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer)
        gl.viewport(0, 0, surface.width, surface.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    paint(target: HTMLCanvasElement, main: CanvasRenderingContext2D, amount: number, background: readonly number[], dither: boolean): boolean {
        const gl = this.gl, { width, height } = target
        if (gl.isContextLost()) return false
        const size = this.size(width, height)
        if (!size) return false
        if (!this.programs.length) this.initPrograms()
        if (this.canvas.width !== width) this.canvas.width = width
        if (this.canvas.height !== height) this.canvas.height = height
        if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) return false
        this.bind(size.source)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, target)
        const [downsample, blur, composite] = this.programs
        for (const layer of size.layers) {
            const [a, b] = layer.pair
            gl.useProgram(downsample.value)
            this.bind(size.source)
            gl.uniform1i(downsample.uniforms.factor, layer.factor)
            gl.uniform3f(downsample.uniforms.background, background[0], background[1], background[2])
            this.pass(a)
            gl.useProgram(blur.value)
            gl.uniform1i(blur.uniforms.radius, layer.radius)
            for (let repeat = 0; repeat < 2; repeat++) {
                this.bind(a.texture)
                gl.uniform2i(blur.uniforms.direction, 1, 0)
                this.pass(b)
                this.bind(b.texture)
                gl.uniform2i(blur.uniforms.direction, 0, 1)
                this.pass(a)
            }
        }
        gl.useProgram(composite.value)
        this.bind(size.source)
        for (let i = 0; i < size.layers.length; i++) this.bind(size.layers[i].pair[0].texture, i + 1)
        gl.uniform1i(composite.uniforms.nearLight, 1)
        gl.uniform1i(composite.uniforms.middleLight, 2)
        gl.uniform1i(composite.uniforms.farLight, 3)
        gl.uniform3f(composite.uniforms.factors, size.layers[0].factor, size.layers[1].factor, size.layers[2].factor)
        gl.uniform1f(composite.uniforms.gain, amount * 2.4)
        gl.uniform1i(composite.uniforms.dither, dither ? 1 : 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, width, height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        if (gl.isContextLost()) return false
        // Do not touch the source before all passes succeed. A failed/lost
        // context can then run the unchanged CPU kernel on this same frame.
        main.save()
        try {
            main.resetTransform()
            main.globalAlpha = 1
            main.globalCompositeOperation = 'copy'
            main.filter = 'none'
            main.shadowColor = 'transparent'
            main.drawImage(this.canvas, 0, 0)
        } finally { main.restore() }
        return true
    }

    dispose(): void {
        for (const program of this.programs) this.gl.deleteProgram(program.value)
        for (const framebuffer of this.framebuffers) this.gl.deleteFramebuffer(framebuffer)
        for (const texture of this.textures) this.gl.deleteTexture(texture)
        this.sizes.clear()
        this.framebuffers.clear()
        this.textures.clear()
        this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
}

let renderer: BloomRenderer | null | undefined

/** Select the canvas backing before its first paint; repeated CPU readbacks can otherwise change rasterization. */
export function supportsWebGLBloom(target: HTMLCanvasElement): boolean {
    try {
        if (renderer === undefined) {
            renderer = null
            const canvas = target.ownerDocument.createElement('canvas')
            const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true })
            if (gl) {
                renderer = new BloomRenderer(canvas, gl)
                renderer.init()
                canvas.addEventListener('webglcontextlost', () => { renderer?.dispose(); renderer = null }, { once: true })
            }
        }
        return renderer !== null
    } catch {
        renderer?.dispose()
        renderer = null
        return false
    }
}

/** Private fast path. False leaves the target intact for paintCanvasBloom's CPU fallback. */
export function paintWebGLBloom(target: HTMLCanvasElement, main: CanvasRenderingContext2D, amount: number, background: readonly number[], dither = true): boolean {
    if (!Number.isFinite(amount) || amount < 0 || !background.slice(0, 3).every(Number.isFinite) || !supportsWebGLBloom(target)) return false
    try {
        return renderer!.paint(target, main, amount, background, dither)
    } catch {
        renderer?.dispose()
        renderer = null
        return false
    }
}
