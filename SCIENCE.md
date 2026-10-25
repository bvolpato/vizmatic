# Scientific videos and diagrams

Vizmatic combines mathematical typesetting, coordinate plots, diagrams, and
deterministic animation. Scientific components use the same public API and scene
registry in native rendering and the in-browser editor. They require no network
requests or scientific drawing service.

## Choose a foundation

| Subject | Components and helpers | Worked examples |
|---|---|---|
| Mathematics | `NumberLine`, `GeometryDiagram`, `AxisPlot`, `MathText`, `EquationCard`, matrices, function sampling | [Intervals and geometry](examples/catalog-science-math.tsx), [secant to tangent](examples/videos/calculus-tangent.tsx) |
| Physics | `FreeBodyDiagram`, `WaveDiagram`, vectors, coordinate paths, `sumForces`, `waveValue`, `sampleWave` | [Forces and interference](examples/catalog-science-physics.tsx), [wave superposition](examples/videos/wave-interference.tsx) |
| Chemistry | `MoleculeDiagram`, `ReactionEquation`, `ReactionEnergyDiagram`, `reactionBalance` | [Structures, conservation, and energy](examples/catalog-science-chemistry.tsx), [catalyst pathways](examples/videos/catalyst-pathway.tsx) |
| Artificial intelligence | `AttentionMatrix`, `scaledDotProductAttention`, `TransformerTopology`, `LayeredNetwork`, `Heatmap`, `Matrix`, tensor shapes and collectives | [Causal probabilities](examples/catalog-science-ai.tsx), [computed attention](examples/videos/causal-attention.tsx) |

The component explorer includes runnable snippets and typed props for every
component. The four subject examples render in dark and light themes. Video
sources export a static `create(theme)` and a deterministic
`createAnimation(theme)` timeline, so the same numerical state can drive an
equation, diagram, and explanation.

## Make the mechanism visible

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
conformation, stereochemistry, or chemical validity from a formula.

`ReactionEquation` displays supplied formulas, coefficients, and phase labels.
For conservation checks, supply an explicit `composition` map and optional
integer `charge` for each term. `reactionBalance` compares coefficient-weighted
element counts and charge. Missing composition means balance is unavailable;
the rendered formula is not parsed or automatically balanced.

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
