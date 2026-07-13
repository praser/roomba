#!/usr/bin/env bash
#
# Release changed packages in the roomba monorepo.
#
# For each package whose files changed in this push, compute the next version
# as patch+1 of max(latest git tag, package.json version), publish it to npm,
# and push a git tag + GitHub Release. We never commit a version bump back to
# main — the tag is the source of truth — so this is safe against a protected
# main and never re-triggers itself.
#
# Env (from the workflow): BEFORE, SHA (commit SHAs), NODE_AUTH_TOKEN, GH_TOKEN.
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Determine which files changed in this push. On the first push (or a force
# push) BEFORE may be all-zeros / unknown; fall back to the previous commit.
if git cat-file -e "${BEFORE}^{commit}" 2>/dev/null; then
  range_base="$BEFORE"
elif git rev-parse --verify --quiet "${SHA}~1" >/dev/null; then
  range_base="$(git rev-parse "${SHA}~1")"
else
  range_base=""
fi

if [ -n "$range_base" ]; then
  changed="$(git diff --name-only "$range_base" "$SHA")"
else
  changed="$(git ls-files)"
fi

# Higher of two dotted semver strings (x.y.z), printed to stdout.
higher() {
  node -e '
    const p = (s) => s.split(".").map(Number);
    const [a1,a2,a3] = p(process.argv[1]);
    const [b1,b2,b3] = p(process.argv[2]);
    const aWins = a1>b1 || (a1===b1 && (a2>b2 || (a2===b2 && a3>=b3)));
    console.log(aWins ? process.argv[1] : process.argv[2]);
  ' "$1" "$2"
}

# release_pkg <dir> <tag-prefix>
release_pkg() {
  local dir="$1" prefix="$2"
  local name pkgver lasttag base next
  name="$(node -p "require('./${dir}/package.json').name")"
  pkgver="$(node -p "require('./${dir}/package.json').version")"

  lasttag="$(git tag -l "${prefix}-v*" --sort=-v:refname | head -n1)"
  base="$pkgver"
  if [ -n "$lasttag" ]; then
    base="$(higher "$pkgver" "${lasttag#"${prefix}"-v}")"
  fi
  next="$(node -e 'const [x,y,z]=process.argv[1].split(".").map(Number);console.log(`${x}.${y}.${z+1}`)' "$base")"

  if npm view "${name}@${next}" version >/dev/null 2>&1; then
    echo "::notice::${name}@${next} already published; skipping"
    return 0
  fi

  echo "::notice::releasing ${name}@${next}"
  # Bump in-place only (no commit); pnpm rewrites workspace: deps on publish.
  ( cd "$dir" && npm version "$next" --no-git-tag-version >/dev/null )
  ( cd "$dir" && pnpm publish --no-git-checks --access public )

  git tag "${prefix}-v${next}" "$SHA"
  git push origin "${prefix}-v${next}"
  gh release create "${prefix}-v${next}" \
    --title "${name} v${next}" \
    --notes "Automated release of ${name}@${next}." \
    --target "$SHA"
}

# Publish core before cli so a same-run core bump flows into cli's dependency.
if grep -q '^packages/core/' <<<"$changed"; then
  release_pkg "packages/core" "core"
else
  echo "core unchanged; skipping"
fi

if grep -q '^apps/cli/' <<<"$changed"; then
  release_pkg "apps/cli" "roomba"
else
  echo "cli unchanged; skipping"
fi
