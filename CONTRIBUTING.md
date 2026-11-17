# Contributing to Vizmatic

Contributions should keep Vizmatic deterministic, theme-aware, accessible, and useful as copied source. Small focused pull requests are easiest to review.

## Setup

Requirements:

- Node.js 22.12 or newer for development (the built package supports Node.js 20)
- Corepack with the pnpm version declared in `package.json`

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run the full local gate before opening a pull request:

```bash
./test.sh
```

This checks types, workflows, tests, rendered examples, docs, dependency advisories, package contents, and generated-file drift.

The image pixel parity test runs in the browser CI job. To run it locally:

```bash
pnpm exec playwright install chromium
VIZMATIC_BROWSER_TESTS=1 pnpm exec vitest run tests/stage-image.test.ts
```

The regular test suite runs the Node image checks without requiring a browser.

## Making changes

- Keep public APIs typed and export them from `src/index.ts`.
- Add focused tests when behavior or a public contract changes. Docs and static metadata usually need existing checks only.
- Keep examples self-contained. Gallery source should show how to build the result without hidden scenario-specific helpers.
- Support dark and light themes. Do not hardcode colors when a theme token expresses the same intent.
- Give rendered diagrams accessible labels where the primitive supports them.
- Preserve deterministic output. Generated assets should not change between identical runs.

## Generated files

The website is generated, and it is not committed. `pnpm site:build` writes it into `docs/`, beside its sources. `.gitignore` names each generated file. CI builds the website for each pull request, and fails when the build or `pnpm docs:check` fails.

Build the website before you open a page, run `pnpm site:serve`, or run `pnpm docs:check`:

```bash
pnpm build
pnpm site:build
```

| Files in `docs/` | Committed | How to change them |
|---|---|---|
| Templates (`*.template.html`), guides (`guides/*.md`), `site.js`, and the style sheets | Yes | Edit them. They are sources. |
| Pages, bundles, component previews, example source JSON, search index, sitemap, and the files for agents | No | Edit the source, then run `pnpm site:build`. |
| Example images and render manifests in `assets/examples/`, film posters, and measured data | Yes | Run the command that writes them, such as `pnpm render:examples`, and commit the result. |

Do not commit a website file with `git add -f`. If the build writes a new file, add an exact rule for it to `.gitignore`. CI fails when the build writes a file that has no rule, or changes a committed file.

The skill has one source: `plugins/vizmatic/skills/vizmatic/`. After you edit it, run `pnpm sync:skill` and commit both folders. The command copies the skill to `.agents/skills/vizmatic/`, which `npx skills add` reads.

### When the public site changes

The public site shows the last release. A merge to `main` does not deploy it. The `Release` workflow publishes the package, then starts the `Pages` workflow, which builds the site from the release tag and deploys it.

A maintainer can also start a deploy by hand, for example for a fix of the docs between two releases:

```bash
gh workflow run pages.yml -f ref=main      # Deploy the site of main.
gh workflow run pages.yml -f ref=main -F deploy=false  # Validate rendering and caches without publishing.
```

The `ref` input also accepts release tags containing the sharded catalog renderer. Older tags such as `v0.8.3` are rejected before building.

Do not add `--ref` to these commands. The workflow must start on `main`, which is the default, because the `github-pages` environment accepts a deployment from `main` only. The runs are on the [page of the Pages workflow](https://github.com/bvolpato/vizmatic/actions/workflows/pages.yml), which also has a "Run workflow" button.

## Visual and animation changes

The site build reads `examples/*.tsx` to generate the highlighted source index and the editable playground examples. To refresh the rendered previews as well, run the following commands.

```bash
pnpm render:examples
pnpm check:examples
pnpm docs:check
```

Review both themes at full size. Check labels, contrast, canvas edges, whitespace, motion continuity, loop transitions, and reduced-motion fallbacks. Animations should explain a state change or process, not add motion without teaching value.

Commit the rendered examples when a source change affects them. Do not commit the website: see [Generated files](#generated-files). `./test.sh` fails if regeneration leaves tracked changes.

## Film changes

Films under `examples/films/` use the engine in `src/stage/`. Run a film from a checkout with the source CLI, which needs no build:

```bash
node --import tsx src/cli.ts preview examples/films/euler-circle.ts
node --import tsx src/cli.ts check examples/films/euler-circle.ts --json
node --import tsx src/cli.ts film examples/films/euler-circle.ts --frame 3,8 --width 1280 --out /tmp/stills
```

Open the stills and review them at full size. The check finds clipped and crossed text, but it does not judge whether the film explains its idea.

### Export performance

Build the package, then compare the same range and quality on an idle machine:

```bash
pnpm build
pnpm benchmark:export examples/films/lorenz.ts --from 33 --to 39 --quality master --backend cpu
pnpm benchmark:export examples/films/lorenz.ts --from 33 --to 39 --quality master --backend gpu
pnpm benchmark:export examples/films/lorenz.ts --from 33 --to 39 --quality master --backend auto
```

The report includes wall time, renderer selection, encoder, frame construction, rasterization, bloom, and encoder waits. Automatic selection keeps CPU if adjacent samples are identical or projected GPU savings cannot cover the full elapsed probe. Probing costs time even when CPU wins, so compare total wall time for both complex motion blur and ordinary exports. See the [exporting guide](docs/guides/exporting.md#speed) for the selection thresholds.

`--encoder nvenc` probes NVIDIA hardware with the requested output dimensions and settings. It uses NVENC CQ, not x264 CRF, so numerical quality settings are not equivalent. The default retains x264 animation/grain tuning. No CUDA toolkit is required. CI catalog rendering explicitly uses `backend: 'cpu'` and `h264Encoder: 'libx264'`.

The Pages workflow builds once at the selected commit and renders four balanced CPU shards. Cache keys include CPU renderer inputs, film dependencies, TypeScript configuration, assets, and the encoder toolchain; cached MP4s also have verified content digests. Changes confined to the excluded Canvas/GPU implementation files do not invalidate CPU movies. Lockfile and TypeScript configuration changes still invalidate conservatively. Assembly requires every film to be cached and fails on missing or corrupt output. Refs predating shard support are rejected before rendering.

### Browser performance

Profile representative films from the current source with an otherwise idle machine:

```bash
pnpm benchmark:browser --channel chrome --out /tmp/vizmatic-profile
pnpm benchmark:browser --film examples/films/lorenz.ts --from 37 --dpr 1,2 --profile --out /tmp/lorenz-profile
```

The first command uses installed Google Chrome. Omit `--channel chrome` to use Playwright's Chromium. The benchmark requests GPU acceleration and records the actual GPU, browser, CPU, source commit, and dirty state. Playback uses CPU bloom when WebGL reports a software renderer. Check `environment.json` before comparing runs: a software renderer does not measure hardware performance.

`results.json` separates frame construction, Canvas command submission, bloom, pixel readback, and animation-frame intervals, with median and p95 timings. The default suite covers planetary geometry, Saturn's raster portrait, Lorenz, Downhill, Fourier, and Euler at 1280 CSS pixels and device ratios 1 and 2. `--width`, `--frames`, and `--look` select other conditions. `--profile` uses unminified code, retains its bundles and source maps, and saves `.cpuprofile` files for Chrome DevTools. Normal runs use minified code.

GPU commands run asynchronously. Low JavaScript time alone does not establish smooth playback; compare animation-frame intervals and inspect the film visually. Keep resolution, look, browser, profiling options, and machine load consistent between runs. Run the browser pixel tests when changing rendering code.

## Dependency updates

Use pnpm so `package.json` and `pnpm-lock.yaml` stay synchronized:

```bash
pnpm update --latest <package>
pnpm audit --audit-level low
./test.sh
```

Check `pnpm-workspace.yaml` when updating an overridden package. Update its override in the same change so CI tests the requested version instead of an older forced version.

TypeScript remains on the latest compatible 6.x release while tsup's declaration build is incompatible with TypeScript 7. Do not remove the `<7` constraint without proving ESM and CommonJS declaration generation through the full gate.

## Pull requests

- Explain user-visible behavior and why the change is needed.
- Include before and after images or GIFs for visual changes.
- Keep unrelated refactors out of the same pull request.
- Ensure `git status --short` is clean after `./test.sh`.
- Do not bump package version or create release tags unless a maintainer requests a release.

Use the pull request checklist in `.github/pull_request_template.md`. Releases are maintainer-managed through the signed tag workflow documented in `README.md`.

## Repository checks

Rendered examples are committed. The website is not: see [Generated files](#generated-files). CI fails when a build changes a committed file, or writes a file that `.gitignore` does not name.

| Gate | What it protects |
|---|---|
| `pnpm lint` | TypeScript coverage plus GitHub Actions validation with actionlint |
| `pnpm test` | Render pipeline behavior, watermark options, and output validation |
| `pnpm render:examples` | Dark/light PNGs, animated GIFs, source snippets, and website HTML |
| `pnpm check:examples` | Every example renders in both themes without errors or visual warnings |
| `pnpm docs:check` | Local asset references, `PROMPT.md` sync, source modal themes, and homepage affordances |
| `pnpm deps:check` | npm audit plus package tarball contents, size, and file-count budgets before release |
| `./test.sh` drift check | Confirms that the build changes no committed file and writes no file that `.gitignore` does not name |

Run the full local gate:

```bash
./test.sh
```

## Publishing

Prepare release commit locally, push it to protected `main`, and wait for required CI before pushing its tag:

```bash
npm version patch --no-git-tag-version
pnpm sync:plugin-versions
pnpm site:build # The pages carry the version, and the check below compares it.
pnpm docs:check
git add package.json plugins/vizmatic/.codex-plugin/plugin.json plugins/vizmatic/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "Release v$(node -p "require('./package.json').version")"
git push origin main
# Push annotated vX.Y.Z tag only after CI passes on release commit.
```

Tag push starts GitHub `Release` workflow. It verifies exact commit again, publishes to npm with provenance via OpenID Connect (OIDC) Trusted Publishing (`id-token: write`, no `NPM_TOKEN` secret), and creates release notes with compare link and commits since previous release. Its last step starts the `Pages` workflow, which deploys the site of that tag. Retry existing tag with `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`.

The workflow keeps package version, plugin metadata, tag, release notes, and npm provenance in sync.
