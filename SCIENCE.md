# Scientific videos and diagrams

Vizmatic combines mathematical typesetting, coordinate plots, diagrams, and
deterministic animation. Scientific components use the same public API and scene
registry in native rendering and the in-browser editor. They require no network
requests or scientific drawing service.

## Scientific films

Use `vizmatic/stage` for new animations. A film supplies its equations and model;
the engine supplies typesetting, geometry, scales, layout, and deterministic
playback. The same source runs in browser previews and video exports.

| Capability | Reusable tools | Film |
|---|---|---|
| Equations and derivations | `tex`, structural `.part()` / `.parts()`, `morphMatching`, baseline-aligned `row` | [Euler's circle](examples/films/euler-circle.ts) |
| Scalar fields and concentrations | `scalarField`, `colorBar`, `contourPaths` | [Reaction and diffusion](examples/films/reaction-diffusion.ts) |
| Scales and differential equations | `axes` with `xScale` / `yScale`, `integrateTrajectory` | [Lorenz](examples/films/lorenz.ts) |
| Waves and polarization | `scene3d`, `curve3d`, `vector3d`, `parametricSurface` | [Maxwell](examples/films/maxwell.ts) |
| Orbital motion and shaded geometry | `scene3d`, `curve3d`, `parametricSurface`, `scalarField` | [Eight worlds, one gravity](examples/films/planetary-orbits.ts) |
| Implicit surfaces and probability | `isosurface`, `scalarField`, `colorBar` | [Hydrogen orbitals](examples/films/hydrogen-orbitals.ts) |
| Molecular geometry and reaction paths | `molecule3d`, `tex` with `\ce`, `axes` | [Catalysis](examples/films/catalysis.ts) |

`axes({ x: [1, 100], xScale: 'log', yScale: 'symlog' })` applies the same transform to
coordinates, inverse coordinates, ticks, and plots. Log domains must be positive.
`plot(f, { adaptive: { tolerance: 0.5 }, discontinuities: [[0, 0]] })` refines sampled
geometry in stage pixels and leaves specified discontinuities open. Adaptive
sampling is bounded and cannot discover every narrow feature of an arbitrary
function. Series retain their original points; uniform sampling remains the
default.
Zero-baseline areas and Riemann rectangles cannot use a logarithmic y axis.
Use a positive `over` curve or `band` to fill a region on that scale.

`parametric(f, from, to, { adaptive: true })` uses the same bounded sampler for
curves such as particle trajectories. Its tolerance is in local pixels at
construction time, before later node or parent transforms. It accepts the same
parameter-interval exclusions; the default uniform spline remains unchanged.

`scalarField((x, y, t) => value, { x, y, domain, colors, scale })` draws a sampled
image, with positive y upward. Keep `domain`, `colors`, and `scale` identical in
its `colorBar`; do not renormalize each frame. Missing samples become transparent
holes. Spatial resolution is explicit, from 2 to 512 samples per axis. A field
supports the same placement, clipping, opacity, and blending as other nodes.
`contourPaths(f, { x, y, levels, resolution })` returns connected polylines in
data coordinates, for either 2D plots or projected 3D geometry.

`integrateTrajectory((t, state) => derivative, { initial, to, step })` precomputes
fixed-step RK4 with cubic interpolation. Sampling is independent of seek order.
Use it for time-dependent particle paths as well as autonomous systems. It is
not a stiff or adaptive solver; compare smaller steps and check the model's
invariants. `streamLines` depicts the geometry of a steady field, not the particle
paths of a changing field.

`isosurface(f, { x, y, z, level, resolution })` creates a cached, bounded
marching-tetrahedra mesh inside `scene3d`. The grid approximates the level set;
surfaces that touch the sampling box remain open. For density lobes, use
`normals: 'decreasing'`. A displayed probability isosurface is a chosen density
threshold, not an electron boundary or orbit.

## Still figures

| Subject | Components and helpers | Worked examples |
|---|---|---|
| Mathematics | `NumberLine`, `GeometryDiagram`, `AxisPlot`, `MathText`, `EquationCard`, matrices, function sampling | [Intervals and geometry](examples/catalog-science-math.tsx), [secant to tangent](examples/videos/calculus-tangent.tsx) |
| Physics | `FreeBodyDiagram`, `WaveDiagram`, vectors, coordinate paths, `sumForces`, `waveValue`, `sampleWave` | [Forces and interference](examples/catalog-science-physics.tsx), [wave superposition](examples/videos/wave-interference.tsx) |
| Chemistry | `MoleculeDiagram`, `ReactionEquation`, `ReactionEnergyDiagram`, `reactionBalance` | [Structures, conservation, and energy](examples/catalog-science-chemistry.tsx), [catalyst pathways](examples/videos/catalyst-pathway.tsx) |
| Artificial intelligence | `AttentionMatrix`, `scaledDotProductAttention`, `TransformerTopology`, `LayeredNetwork`, convolution kernels, `Heatmap`, `Matrix`, tensor shapes and collectives | [Causal probabilities](examples/catalog-science-ai.tsx), [convolution filter](examples/catalog-convolution-kernel.tsx), [computed attention](examples/videos/causal-attention.tsx) |

The component explorer includes runnable snippets and typed props for every
component. The four subject examples render in dark and light themes. Video
sources export a static `create(theme)` and a deterministic
`createAnimation(theme)` timeline, so the same numerical state can drive an
equation, diagram, and explanation.

## Make the mechanism visible

For numerical linear algebra, start with
[numeric matrices](examples/catalog-numeric-matrices.tsx) and the
[animated dot product](examples/videos/matrix-multiplication.tsx). `Matrix` and
`Heatmap` support readable `fontSize`, row/column/cell highlights, and an explicit
`colorDomain` that changes the color scale without changing the displayed
numbers. `multiplyMatrices` computes the result; `transposeMatrix` exchanges
rows and columns without mutating the input.

For computer vision, use [the actual CIFAR-10 sample](examples/catalog-image-tensors.tsx)
and its [image-to-matrix animation](examples/videos/image-to-matrix.tsx).
`PixelGrid` displays row-major RGB byte tuples as square pixels. `rgbChannel`
extracts one 0–255 matrix, `cropRgbImage` copies a rectangular region, and
`flattenRgbImage(pixels, 'CHW')` reproduces channel-first storage. Use `'HWC'`
for interleaved storage and the third argument `true` to divide by 255.
The helpers reject invalid bytes and support up to 1,024 pixels. A 32×32 color
image contains three 32×32 matrices, or 3,072 values; a single scalar matrix
does not preserve its RGB colors.

For deep-learning filters, see the [single-channel kernel example](examples/catalog-convolution-kernel.tsx)
and its [animated lesson](examples/videos/convolution-kernel.tsx). It uses a
synthetic image and one hand-set edge filter to show each multiply and sum,
then applies ReLU. The weights are illustrative, not learned. `crossCorrelate2d`
implements the unflipped cross-correlation convention used by deep-learning
`Conv2d` layers; it handles one 2D input and one 2D kernel, with no channel
stacking, bias, or learned parameters. The default stride is 1 and
`padding: 'valid'` emits only fully covered windows. `padding: 'same'` uses
SAME_UPPER zero padding, returns `ceil(input / stride)` output dimensions, and
places any odd extra padding at the bottom or right. Padding a blur with zeros
can dim the image edges; a constant image stays constant only where the full
kernel fits. This helper supports strides greater than 1 with `same`; PyTorch
`Conv2d` currently limits `padding='same'` to stride 1.

For smoothing, the [Gaussian blur example](examples/catalog-gaussian-blur.tsx)
and [animation](examples/videos/gaussian-blur.tsx) follow a normalized kernel
through a bright point and its neighbors. `gaussianKernel(size, sigma)` samples
and normalizes a finite, odd-sized 2D Gaussian kernel. The displayed 3×3
`[[1,2,1],[2,4,2],[1,2,1]] / 16` kernel is a separable binomial approximation
to a Gaussian, not the exact sampled kernel. `crossCorrelate2d` preserves
floating-point results.

For an actual photo, the [photo blur example](examples/catalog-photo-blur.tsx)
and [animation](examples/videos/photo-gaussian-blur.tsx) use a sharp 384 × 256
CC0 coffee photograph. They compute nine outputs at σ = 0, 0.5, …, 4 using a
25 × 25 Gaussian footprint; σ = 0 is the unchanged identity crop. The source
crop and each valid-convolution output share a 360 × 232 field of view. Each
animation stage displays its computed result. The numerical matrix shows the
center 5 × 5 weights, rounded to six decimals, with the center coefficient
highlighted. The sum readout covers all 625 weights, including the 600 omitted
from the excerpt. The separable implementation
returns floating-point RGB values; the lesson rounds them only for the byte
readout and PNG encoding. Blur uses stored, gamma-encoded channel values and
does not linearize RGB before filtering.

The full SDK exposes `RgbRaster`, `decodeRgbPng`, `encodeRgbPng`,
`cropRgbRaster`, and `gaussianBlurRgb` to imported scene modules and the full
browser Playground. A raster is a flat, row-major RGB buffer. PNG decoding
accepts opaque, noninterlaced 8-bit images up to 2 MiB and 1,048,576 pixels; it
rejects embedded ICC profiles. Raster operations also cap dimensions at
1,048,576 pixels. Gaussian blur uses valid convolution, returns a `Float64Array`,
accepts σ ≥ 0 and integer radius 0–64, and defaults the radius to `ceil(3σ)`.
An explicit radius at σ = 0 keeps the matching valid crop while leaving its
pixels unchanged. These helpers are not part of the bare QuickJS author-code
environment.

See [PyTorch Conv2d](https://docs.pytorch.org/docs/stable/generated/torch.nn.Conv2d.html)
for learned spatial filters and [OpenCV image filtering](https://docs.opencv.org/4.x/d4/d86/group__imgproc__filter.html)
for Gaussian blur and border handling.

The CIFAR image-to-matrix example embeds training batch 1, record 0 (frog), so
preview and rendering need no runtime downloads. It shows the full image and
three full channel planes, then enlarges the same 4×4 crop into numerical
matrices. Moving values land in the corresponding row and column. Regenerate
the pinned record in `examples/catalog-image-tensors.tsx` with
`node scripts/extract-cifar-sample.mjs`; the photo lesson has its own prepared
sample from `node scripts/prepare-photo-sample.mjs`. Provenance and third-party
notices are in `assets/THIRD_PARTY_LICENSES.md`.

Start with the objects the lesson explains. Keep the coordinate system and color
meaning stable while the relevant quantity changes. A force diagram keeps one
scale for every vector; an interference diagram adds signed displacements; an
attention diagram displays the probabilities that actually produce its output.

Sample frames from explicit time or timeline state. Avoid accumulated updates
such as `position += velocity`, which make seeking depend on previously rendered
frames. Label units and numerical examples. Keep generated or illustrative data
distinct from measurements.

The worked lessons use these contracts:

- **Derivative:** for `f(x) = x²` at `x = 1`, the secant slope is `2 + h`,
  approaching the tangent slope `2` as a nonzero `h` shrinks.
- **Interference:** two equal sinusoidal waves add to amplitude `2A` in phase
  and cancel at a relative phase of `π`. The displayed domain stays fixed.
- **Catalysis:** both pathways share reactant and product energy levels. The
  numerical energy profile is illustrative; a catalyst provides a different
  activation barrier without changing the energy difference between endpoints.
- **Attention:** the example computes `softmax(QKᵀ / √dₖ)V` from explicit small
  tensors. Causal masking removes future keys, each visible row sums to one,
  and the weighted output uses that same row.

## Chemistry data contracts

`MoleculeDiagram` renders supplied 2D atom positions and bond orders. It checks
elements, identifiers, endpoints, and finite geometry. Supply the molecular
structure deliberately: the renderer does not infer bonds, valence, a 3D
conformation, stereochemistry, or chemical validity from a formula. Single bonds
accept `stereo: 'wedge' | 'hashed'`; the narrow end is `from`, so atom order matters.

For films, `molecule3d({ atoms, bonds }, options)` places explicit 3D coordinates
in a `Scene3D`. `atom(id)` and `bond(from, to)` expose parts for animation. Display
radii are illustrative, not measured atomic radii. The same function accepts one
V2000 MOL/SDF string containing plain element atoms and explicit bonds. Unsupported
stereochemistry, charges, isotopes, query atoms, and property blocks are rejected;
V3000 and multiple SDF records are not supported. A planar input remains planar.
Vizmatic does not generate conformers or add missing hydrogens.

`tex` bundles MathJax's `mhchem` extension, including `\ce` and `\pu`, for formulas,
reaction arrows, charges, and units. This typesets the author's chemistry; it does
not infer its meaning or balance a reaction.

`ReactionEquation` displays supplied formulas, coefficients, and phase labels.
For conservation checks, supply an explicit `composition` map and optional
integer `charge` for each term. `reactionBalance` compares coefficient-weighted
element counts and charge. Missing composition means balance is unavailable;
the rendered formula is not parsed or automatically balanced. An electron term
uses `composition: {}` and `charge: -1`; it contributes charge without an element.

`ReactionEnergyDiagram` accepts absolute energy levels in one explicitly named
unit. The barrier is the peak energy, not activation energy itself. Activation
energy is `barrier - reactants`; the endpoint change is `products - reactants`.
Its horizontal axis is reaction coordinate, not elapsed time. It does not
estimate a reaction rate or convert units.

## Attention data contracts

`scaledDotProductAttention(queries, keys, values, options)` computes one head
without dropout or learned projections. `mask[i][j] = true` permits a query/key
pair. With `causal: true`, key index `j` must also satisfy `j <= i`, using
top-left alignment for rectangular matrices. Fully masked rows are rejected;
their softmax is undefined by this API. Masked scores are returned as `null`,
weights as zero, and outputs as finite numbers.

`AttentionMatrix` accepts normalized probabilities, explicit query/key labels,
and the same optional mask. Its shared color scale is zero to one. Attention
weights are a computation view, not an explanation of a model's reasoning.

## Render and reuse

Run from a checkout containing the scientific components:

```sh
pnpm build
pnpm exec tsx scripts/render-examples.ts --only=catalog-science-math,catalog-science-physics,catalog-science-chemistry,catalog-science-ai
node dist/cli.js render examples/catalog-science-chemistry.tsx --theme dark,light --out /tmp/science
node dist/cli.js gif examples/videos/wave-interference.tsx --theme dark,light --fps 20 --out /tmp/science
node dist/cli.js video examples/videos/causal-attention.tsx --theme dark --fps 30 --out /tmp/science
```

The scoped gallery command retains existing assets and refreshes all source
metadata. It requires the other examples to have been rendered already. The
default `pnpm render:examples` still rebuilds the complete gallery.

MP4 output requires FFmpeg with `libx264`. Captions and narration can be added
through the existing video APIs. The examples are visual lesson segments, not
narrated or publication-approved full videos.

Bare scenes in the editor use the same component names without imports:

```tsx
<WaveDiagram
  waves={[
    { amplitude: 1, wavelength: 4, phase: 0 },
    { amplitude: 1, wavelength: 4, phase: progress * Math.PI },
  ]}
  time={time}
  xMin={-4} xMax={4} yMin={-2.5} yMax={2.5}
  width={760} height={420}
  showComponents showSum
/>
```

The editor validates bounded collection sizes before rendering. Scientific
components also reject invalid dimensions, nonfinite values, missing endpoints,
and data that would silently distort their stated numerical contract.

## Scientific references

- [OpenStax Calculus Volume 1: Defining the Derivative](https://openstax.org/books/calculus-volume-1/pages/3-1-defining-the-derivative)
- [OpenStax University Physics Volume 1: Interference of Waves](https://openstax.org/books/university-physics-volume-1/pages/16-5-interference-of-waves)
- [OpenStax Chemistry 2e: Catalysis](https://openstax.org/books/chemistry-2e/pages/12-7-catalysis)
- [Vaswani et al.: Attention Is All You Need](https://arxiv.org/abs/1706.03762)

## Lesson sources

Use this guide for mathematical plots and geometry,
force and wave diagrams, molecular structures, reaction equations and energy
profiles, and computed attention. Eight subject components complement the
existing equations, matrices, graphs, and transformer tools. Each is available
in the component explorer and the isolated browser scene renderer.

The [animated lesson sources](examples/videos/README.md) demonstrate a
secant approaching a tangent, signed wave superposition, catalyst pathways,
and causal attention with a computed weighted output. Render the checked-out
sources to GIF or MP4; examples use explicit numerical state and both themes.

For numbers and computer vision, try the [numeric matrix example](examples/catalog-numeric-matrices.tsx)
or the [actual CIFAR-10 image split into RGB matrices](examples/catalog-image-tensors.tsx).
The latter reconstructs one original 32×32 frog image from byte data and follows
the same selected pixel into three numerical channel crops. `PixelGrid`, channel
and tensor helpers, and matrix focus controls are reusable in browser previews
and native video renders.

For deep learning and image smoothing, try the [convolution filter](examples/catalog-convolution-kernel.tsx)
and [Gaussian blur](examples/catalog-gaussian-blur.tsx) examples. They show an
unflipped, single-channel filter calculation and a normalized blur kernel; the
weights are illustrative. The [mechanism section](#make-the-mechanism-visible)
covers stride, padding, Gaussian sampling, and border behavior.

The [photo blur lesson](examples/catalog-photo-blur.tsx) uses a sharp CC0 coffee
photo. Its [animation](examples/videos/photo-gaussian-blur.tsx) computes and
shows actual 25 × 25 Gaussian results from σ = 0 to 4, with σ = 0 as the
unchanged identity crop. A numerical matrix shows the center 5 × 5 weights
rounded to six decimals; the sum covers the full 25 × 25 filter. The sharp
source and filtered image use the same size and crop. The embedded 384 × 256
sample is prepared by
[`scripts/prepare-photo-sample.mjs`](scripts/prepare-photo-sample.mjs), which
requires Node.js and FFmpeg. The photo and codec notices are in
[`assets/THIRD_PARTY_LICENSES.md`](assets/THIRD_PARTY_LICENSES.md).

The raster helpers `decodeRgbPng`, `encodeRgbPng`, `cropRgbRaster`, and
`gaussianBlurRgb` operate on flat row-major RGB data. Decoding accepts opaque,
noninterlaced 8-bit PNG data URIs up to 2 MiB and 1,048,576 pixels and rejects
embedded ICC profiles. Raster operations use the same 1,048,576-pixel limit.
Blur uses the stored, gamma-encoded channel values without linearizing them and
returns floating-point RGB with valid convolution and an integer radius from 0
to 64, defaulting to `ceil(3σ)`. PNG encoding rounds values when writing the
output image. These helpers are available from full Vizmatic SDK modules and
the full Playground, not from the isolated QuickJS author-code environment
described above.
