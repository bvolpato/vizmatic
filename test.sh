#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

before_diff="$(mktemp)"
after_diff="$(mktemp)"
before_status="$(mktemp)"
after_status="$(mktemp)"
trap 'rm -f "$before_diff" "$after_diff" "$before_status" "$after_status"' EXIT

# No committed file may match a rule of .gitignore. If one does, the rule is too wide and can
# hide a new source file, or a generated file was committed by mistake.
ignored_tracked="$(git ls-files --cached --ignored --exclude-standard)"
if [ -n "$ignored_tracked" ]; then
    printf '%s\n' "$ignored_tracked" >&2
    echo "These files are committed, but a rule of .gitignore matches them." >&2
    echo "Make the rule exact. If a file is generated, remove it with 'git rm --cached'." >&2
    exit 1
fi

git diff --binary > "$before_diff"
# The status lists each new file that git does not ignore. So the comparison below also finds a
# generated file that has no rule in .gitignore.
git status --short --untracked-files=all > "$before_status"

pnpm install --frozen-lockfile
pnpm verify

git diff --binary > "$after_diff"
git status --short --untracked-files=all > "$after_status"

changed=0
diff -u "$before_diff" "$after_diff" || changed=1
diff -u "$before_status" "$after_status" || changed=1
if [ "$changed" -ne 0 ]; then
    cat >&2 <<'EOF'

The build changed the working tree. The lines above show the difference.
- A new file (??) that the build writes: add an exact rule for it to .gitignore.
  The website is not committed.
- A new file (??) that is a source: commit it.
- A changed file (M): it is committed output, such as docs/assets/examples.
  Commit the new output.
EOF
    exit 1
fi
