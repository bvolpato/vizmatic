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

## Making changes

- Keep public APIs typed and export them from `src/index.ts`.
- Add focused tests when behavior or a public contract changes. Docs and static metadata usually need existing checks only.
- Keep examples self-contained. Gallery source should show how to build the result without hidden scenario-specific helpers.
- Support dark and light themes. Do not hardcode colors when a theme token expresses the same intent.
- Give rendered diagrams accessible labels where the primitive supports them.
- Preserve deterministic output. Generated assets should not change between identical runs.

## Visual and animation changes

Examples under `examples/` generate tracked files under `docs/assets/examples/` and website source metadata. Regenerate them with:

```bash
pnpm render:examples
pnpm check:examples
pnpm docs:check
```

Review both themes at full size. Check labels, contrast, canvas edges, whitespace, motion continuity, loop transitions, and reduced-motion fallbacks. Animations should explain a state change or process, not add motion without teaching value.

Commit generated outputs when source changes affect them. `./test.sh` fails if regeneration leaves tracked changes.

## Film changes

Films under `examples/films/` use the engine in `src/stage/`. Run a film from a checkout with the source CLI, which needs no build:

```bash
node --import tsx src/cli.ts preview examples/films/euler-circle.ts
node --import tsx src/cli.ts check examples/films/euler-circle.ts --json
node --import tsx src/cli.ts film examples/films/euler-circle.ts --frame 3,8 --width 1280 --out /tmp/stills
```

Open the stills and review them at full size. The check finds clipped and crossed text, but it does not judge whether the film explains its idea.

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

Generated examples and website files are committed. CI fails when a build changes them without a matching source update.

| Gate | What it protects |
|---|---|
| `pnpm lint` | TypeScript coverage plus GitHub Actions validation with actionlint |
| `pnpm test` | Render pipeline behavior, watermark options, and output validation |
| `pnpm render:examples` | Dark/light PNGs, animated GIFs, source snippets, and website HTML |
| `pnpm check:examples` | Every example renders in both themes without errors or visual warnings |
| `pnpm docs:check` | Local asset references, `PROMPT.md` sync, source modal themes, and homepage affordances |
| `pnpm deps:check` | npm audit plus package tarball contents, size, and file-count budgets before release |
| `./test.sh` drift check | Confirms render and docs commands leave no uncommitted output |

Run the full local gate:

```bash
./test.sh
```

## Publishing

Prepare release commit locally, push it to protected `main`, and wait for required CI before pushing its tag:

```bash
npm version patch --no-git-tag-version
pnpm sync:plugin-versions
pnpm docs:check
git add package.json plugins/vizmatic/.codex-plugin/plugin.json plugins/vizmatic/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "Release v$(node -p "require('./package.json').version")"
git push origin main
# Push annotated vX.Y.Z tag only after CI passes on release commit.
```

Tag push starts GitHub `Release` workflow. It verifies exact commit again, publishes npm provenance, and creates release notes with compare link and commits since previous version. Retry existing tag with `gh workflow run release.yml --ref vX.Y.Z -f tag=vX.Y.Z`. Workflow requires `NPM_TOKEN` repository secret with publish access.

The workflow keeps package version, plugin metadata, tag, release notes, and npm provenance in sync.
