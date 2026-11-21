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
uniform bool raw;
uniform vec3 background;
void main() {
    ivec2 start = ivec2(gl_FragCoord.xy) * factor;
    vec3 sum = vec3(0.0);
    for (int y = 0; y < factor; ++y)
        for (int x = 0; x < factor; ++x)
            sum += pixel(start + ivec2(x, y)).rgb;
    color = vec4(raw ? sum : max(vec3(0.0), sum / float(factor * factor) - background), 0.0);
}`

// Separable 1D box downsample for large non-divisible factors (e.g. prime 25, 31, 43 on Retina viewports).
// Produces exact integer sums identical to the 2D loop in 2*factor fetches instead of factor*factor.
const DOWNSAMPLE_H = `${HEADER}
uniform int factor;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int startX = p.x * factor;
    vec3 sum = vec3(0.0);
    for (int x = 0; x < factor; ++x)
        sum += pixel(ivec2(startX + x, p.y)).rgb;
    color = vec4(sum, 0.0);
}`

const DOWNSAMPLE_V = `${HEADER}
uniform int factor;
uniform bool raw;
uniform vec3 background;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int startY = p.y * factor;
    vec3 sum = vec3(0.0);
    for (int y = 0; y < factor; ++y)
        sum += texelFetch(source, ivec2(p.x, startY + y), 0).rgb;
    color = vec4(raw ? sum : max(vec3(0.0), sum / float(factor * factor) - background), 0.0);
}`

// Keep integer sums until every scale has been built. Clamping against the
// background first would incorrectly spread light from dark cells.
const REDUCE = `${HEADER}
uniform int factor;
void main() {
    ivec2 start = ivec2(gl_FragCoord.xy) * factor;
    vec3 sum = vec3(0.0);
    for (int y = 0; y < factor; ++y)
        for (int x = 0; x < factor; ++x)
            sum += texelFetch(source, start + ivec2(x, y), 0).rgb;
    color = vec4(sum, 0.0);
}`

const BLUR = `${HEADER}
uniform ivec2 direction;
uniform int radius;
uniform int factor;
uniform vec3 background;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy), end = textureSize(source, 0) - 1;
    vec3 sum = vec3(0.0);
    for (int k = -radius; k <= radius; ++k) {
        vec3 value = texelFetch(source, clamp(p + k * direction, ivec2(0), end), 0).rgb;
        sum += factor == 0 ? value : max(vec3(0.0), value / float(factor * factor) - background);
    }
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
    sep: Surface | null
    pyramid: boolean
    bytes: number
    textures: number
}

const CACHE_BYTES = 96 * 1024 * 1024
const MAX_LIVE_TEXTURES = 14
const SEPARABLE_THRESHOLD = 8

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
            [DOWNSAMPLE, ['source', 'factor', 'raw', 'background']],
            [REDUCE, ['source', 'factor']],
            [BLUR, ['source', 'direction', 'radius', 'factor', 'background']],
            [COMPOSITE, ['source', 'nearLight', 'middleLight', 'farLight', 'factors', 'gain', 'dither']],
            [DOWNSAMPLE_H, ['source', 'factor']],
            [DOWNSAMPLE_V, ['source', 'factor', 'raw', 'background']],
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
        const extras = size.sep ? [size.sep.texture] : []
        for (const texture of [size.source, ...extras, ...size.layers.flatMap(layer => layer.pair.map(surface => surface.texture))]) {
            gl.deleteTexture(texture)
            this.textures.delete(texture)
        }
        if (size.sep) {
            gl.deleteFramebuffer(size.sep.framebuffer)
            this.framebuffers.delete(size.sep.framebuffer)
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
        const pyramid = layers.some((layer, i) => layer.factor <= 256 && layers.slice(0, i).some(finer => finer.factor > 1 && layer.factor % finer.factor === 0))
        let sepWidth = 0
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i]!
            const tiled = pyramid && layer.factor <= 256 && layers.slice(0, i).some(finer => layer.factor % finer.factor === 0)
            if (!tiled && layer.factor > SEPARABLE_THRESHOLD && layer.factor <= 256) {
                sepWidth = Math.max(sepWidth, layer.width)
            }
        }
        const sepBytes = sepWidth > 0 ? sepWidth * height * 16 : 0
        const bytes = width * height * 4 + sepBytes + layers.reduce((sum, layer) => sum + layer.width * layer.height * 32, 0)
        if (bytes > CACHE_BYTES) return null
        const neededTextures = 1 + layers.length * 2 + (sepWidth > 0 ? 1 : 0)
        let held = [...this.sizes.values()].reduce((sum, size) => sum + size.bytes, 0)
        // Two hot sizes cover a gallery preview and its expanded player. Evict
        // before allocating, so alternating players cannot grow GPU memory.
        for (const [oldKey, old] of this.sizes) {
            if (this.sizes.size < 2 && held + bytes <= CACHE_BYTES && this.textures.size + neededTextures <= MAX_LIVE_TEXTURES) break
            this.release(old)
            this.sizes.delete(oldKey)
            held -= old.bytes
        }
        const size: Size = {
            source: this.texture(width, height, false), bytes, textures: neededTextures,
            sep: sepWidth > 0 ? this.surface(sepWidth, height) : null,
            // A full-size float intermediate costs more than it saves for tiny
            // previews. Nondivisible scales also keep the direct path.
            pyramid,
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

    private pass(surface: Surface, viewWidth = surface.width, viewHeight = surface.height): void {
        const gl = this.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, surface.framebuffer)
        gl.viewport(0, 0, viewWidth, viewHeight)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    paint(target: HTMLCanvasElement, main: CanvasRenderingContext2D | null, amount: number, background: readonly number[], dither: boolean): boolean {
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
        const [downsample, reduce, blur, composite, downsampleH, downsampleV] = this.programs
        gl.useProgram(downsample.value)
        gl.uniform1i(downsample.uniforms.raw, size.pyramid ? 1 : 0)
        gl.uniform3f(downsample.uniforms.background, background[0], background[1], background[2])
        // Reuse unblurred sums only when whole cells tile the coarser scale.
        // Odd output sizes use a separable 1D downsample when factor > 8 to avoid factor^2 loops.
        for (let i = 0; i < size.layers.length; i++) {
            const layer = size.layers[i]
            let finer: Size['layers'][number] | undefined
            // RGBA32F represents every possible byte sum exactly through 256² cells.
            for (let j = 0; size.pyramid && j < i; j++) if (layer.factor <= 256 && layer.factor % size.layers[j].factor === 0) finer = size.layers[j]
            if (!finer && size.sep && layer.factor > SEPARABLE_THRESHOLD && layer.factor <= 256) {
                gl.useProgram(downsampleH.value)
                this.bind(size.source)
                gl.uniform1i(downsampleH.uniforms.factor, layer.factor)
                this.pass(size.sep, layer.pair[0].width, height)
                gl.useProgram(downsampleV.value)
                this.bind(size.sep.texture)
                gl.uniform1i(downsampleV.uniforms.factor, layer.factor)
                gl.uniform1i(downsampleV.uniforms.raw, size.pyramid ? 1 : 0)
                gl.uniform3f(downsampleV.uniforms.background, background[0], background[1], background[2])
                this.pass(layer.pair[0])
                continue
            }
            const program = finer ? reduce : downsample
            gl.useProgram(program.value)
            this.bind(finer ? finer.pair[0].texture : size.source)
            gl.uniform1i(program.uniforms.factor, finer ? layer.factor / finer.factor : layer.factor)
            this.pass(layer.pair[0])
        }
        gl.useProgram(blur.value)
        gl.uniform3f(blur.uniforms.background, background[0], background[1], background[2])
        for (const layer of size.layers) {
            const [a, b] = layer.pair
            gl.uniform1i(blur.uniforms.radius, layer.radius)
            for (let repeat = 0; repeat < 2; repeat++) {
                this.bind(a.texture)
                gl.uniform1i(blur.uniforms.factor, size.pyramid && repeat === 0 ? layer.factor : 0)
                gl.uniform2i(blur.uniforms.direction, 1, 0)
                this.pass(b)
                this.bind(b.texture)
                gl.uniform1i(blur.uniforms.factor, 0)
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
        if (!main) return true
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

    dispose(loseContext = true): void {
        if (!this.gl.isContextLost()) {
            for (const program of this.programs) this.gl.deleteProgram(program.value)
            for (const framebuffer of this.framebuffers) this.gl.deleteFramebuffer(framebuffer)
            for (const texture of this.textures) this.gl.deleteTexture(texture)
        }
        this.programs.length = 0
        this.sizes.clear()
        this.framebuffers.clear()
        this.textures.clear()
        if (loseContext) this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
}

const ACCUM_ADD = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D source;
out vec4 color;
void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    color = texelFetch(source, p, 0);
}`

const ACCUM_RESOLVE = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D source;
uniform float scale;
out vec4 color;
void main() {
    ivec2 p = ivec2(gl_FragCoord.x, float(textureSize(source, 0).y) - gl_FragCoord.y);
    color = clamp(texelFetch(source, p, 0) * scale, 0.0, 1.0);
}`

/** Float32 WebGL2 subframe accumulator for lossless motion-blur averaging on dark scenes. */
export class WebGLSubframeAccumulator {
    private canvas: HTMLCanvasElement | null = null
    private gl: WebGL2RenderingContext | null = null
    private addProgram: WebGLProgram | null = null
    private resolveProgram: WebGLProgram | null = null
    private resolveScale: WebGLUniformLocation | null = null
    private srcTex: WebGLTexture | null = null
    private accumTex: WebGLTexture | null = null
    private accumFbo: WebGLFramebuffer | null = null
    private width = 0
    private height = 0
    private count = 0
    private broken = false

    private ensure(source: HTMLCanvasElement): boolean {
        if (this.broken) return false
        const { width, height } = source
        if (width < 1 || height < 1) return false
        if (!this.gl) {
            const canvas = source.ownerDocument.createElement('canvas')
            const gl = canvas.getContext('webgl2', {
                alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
                preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true,
            })
            if (!gl || !gl.getExtension('EXT_color_buffer_float')) { this.broken = true; return false }
            const link = (frag: string) => {
                const p = gl.createProgram()!
                const vs = gl.createShader(gl.VERTEX_SHADER)!
                const fs = gl.createShader(gl.FRAGMENT_SHADER)!
                gl.shaderSource(vs, VERTEX); gl.compileShader(vs)
                gl.shaderSource(fs, frag); gl.compileShader(fs)
                gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
                gl.deleteShader(vs); gl.deleteShader(fs)
                if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { gl.deleteProgram(p); return null }
                return p
            }
            const addProgram = link(ACCUM_ADD)
            const resolveProgram = link(ACCUM_RESOLVE)
            if (!addProgram || !resolveProgram) { this.broken = true; return false }
            gl.disable(gl.DITHER)
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
            gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
            this.canvas = canvas
            this.gl = gl
            this.addProgram = addProgram
            this.resolveProgram = resolveProgram
            this.resolveScale = gl.getUniformLocation(resolveProgram, 'scale')
        }
        const gl = this.gl
        if (gl.isContextLost()) { this.broken = true; return false }
        if (this.width !== width || this.height !== height) {
            if (this.srcTex) gl.deleteTexture(this.srcTex)
            if (this.accumTex) gl.deleteTexture(this.accumTex)
            if (this.accumFbo) gl.deleteFramebuffer(this.accumFbo)
            const makeTex = (internalFormat: number) => {
                const tex = gl.createTexture()!
                gl.bindTexture(gl.TEXTURE_2D, tex)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
                gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height)
                return tex
            }
            this.srcTex = makeTex(gl.RGBA8)
            this.accumTex = makeTex(gl.RGBA32F)
            this.accumFbo = gl.createFramebuffer()!
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo)
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.accumTex, 0)
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.broken = true; return false }
            this.canvas!.width = width
            this.canvas!.height = height
            this.width = width
            this.height = height
        }
        return true
    }

    begin(source: HTMLCanvasElement): boolean {
        if (!this.ensure(source)) return false
        const gl = this.gl!
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo)
        gl.viewport(0, 0, this.width, this.height)
        gl.disable(gl.BLEND)
        gl.clearColor(0, 0, 0, 0)
        gl.clear(gl.COLOR_BUFFER_BIT)
        this.count = 0
        return true
    }

    add(source: HTMLCanvasElement): boolean {
        if (!this.gl || this.broken || this.gl.isContextLost()) return false
        const gl = this.gl
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.accumFbo)
        gl.viewport(0, 0, this.width, this.height)
        gl.useProgram(this.addProgram)
        gl.enable(gl.BLEND)
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFunc(gl.ONE, gl.ONE)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        gl.disable(gl.BLEND)
        this.count++
        return !gl.isContextLost()
    }

    resolveTo(targetCtx: CanvasRenderingContext2D): boolean {
        if (!this.gl || !this.canvas || this.broken || this.count <= 0 || this.gl.isContextLost()) return false
        const gl = this.gl
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, this.width, this.height)
        gl.disable(gl.BLEND)
        gl.useProgram(this.resolveProgram)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.accumTex)
        gl.uniform1f(this.resolveScale, 1 / this.count)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        if (gl.isContextLost()) return false
        targetCtx.save()
        try {
            targetCtx.resetTransform()
            targetCtx.globalAlpha = 1
            targetCtx.globalCompositeOperation = 'copy'
            targetCtx.filter = 'none'
            targetCtx.shadowColor = 'transparent'
            targetCtx.drawImage(this.canvas, 0, 0)
        } finally { targetCtx.restore() }
        return true
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
                canvas.addEventListener('webglcontextlost', (event) => {
                    event.preventDefault()
                    renderer?.dispose(false)
                    renderer = null
                })
                canvas.addEventListener('webglcontextrestored', () => {
                    renderer = undefined
                })
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

export interface WebGLBloomPresenter {
    paint(source: HTMLCanvasElement, amount: number, background: readonly number[], dither?: boolean): boolean
    dispose(): void
}

/**
 * Present WebGL bloom directly on a visible canvas, skipping the WebGL2-to-2D
 * drawImage copy on every frame (a major bottleneck in Firefox).
 */
export function createWebGLBloomPresenter(display: HTMLCanvasElement): WebGLBloomPresenter | null {
    if (!supportsWebGLBloom(display)) return null
    let instance: BloomRenderer | null = null
    let broken = false
    const onLost = (event: Event) => {
        event.preventDefault()
        broken = true
        instance?.dispose(false)
        instance = null
    }
    try {
        const gl = display.getContext('webgl2', {
            alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
            preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: true,
        })
        if (!gl) return null
        instance = new BloomRenderer(display, gl)
        instance.init()
        display.addEventListener?.('webglcontextlost', onLost)
        return {
            paint(source: HTMLCanvasElement, amount: number, background: readonly number[], dither = true): boolean {
                if (broken || !instance || !Number.isFinite(amount) || amount < 0 || !background.slice(0, 3).every(Number.isFinite)) return false
                try {
                    return instance.paint(source, null, amount, background, dither)
                } catch {
                    broken = true
                    instance?.dispose(false)
                    instance = null
                    return false
                }
            },
            dispose(): void {
                broken = true
                display.removeEventListener?.('webglcontextlost', onLost)
                instance?.dispose(true)
                instance = null
            },
        }
    } catch {
        display.removeEventListener?.('webglcontextlost', onLost)
        instance?.dispose(true)
        return null
    }
}
