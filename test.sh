#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

before_diff="$(mktemp)"
after_diff="$(mktemp)"
before_status="$(mktemp)"
after_status="$(mktemp)"
trap 'rm -f "$before_diff" "$after_diff" "$before_status" "$after_status"' EXIT

git diff --binary > "$before_diff"
git status --short --untracked-files=all > "$before_status"

pnpm install --frozen-lockfile
pnpm verify

git diff --binary > "$after_diff"
git status --short --untracked-files=all > "$after_status"

diff -u "$before_diff" "$after_diff"
diff -u "$before_status" "$after_status"
