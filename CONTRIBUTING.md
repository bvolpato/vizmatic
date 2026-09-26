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
