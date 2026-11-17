#!/bin/sh
# Builds the demo site from the app's source on main.
#
#   _demo/build.sh /path/to/a/checkout/of/main [output-folder]
#
# With an output folder (empty, or not there yet), the site is built into it
# and this branch is left alone: what the release workflow does. Without one,
# it is built into this branch's root, for building by hand: the previous
# build is removed first, and _demo/, README.md, CNAME and .gitignore are kept.
# Either way the site is checked for what Jekyll, which publishes the branch,
# would leave out or process.
#
# Needs only podman. The app's source is copied into a container, the demo's
# files beside it, and the site written out; npm downloads the app's
# dependencies inside the container.
set -eu
usage='usage: _demo/build.sh /path/to/main-checkout [output-folder]'
main=$(cd "${1:?$usage}" && pwd)
[ -f "$main/source/package.json" ] || { echo "$main is not a checkout of main (no source/package.json)" >&2; exit 2; }
# This branch's root: where this script's _demo/ is, wherever it is run from.
branch=$(cd "$(dirname "$0")/.." && pwd)
[ -f "$branch/CNAME" ] || { echo "$branch has no CNAME: run this script from its place on the gh-pages branch" >&2; exit 2; }

# node:22-alpine, by digest: the image the app's own builds and tests use. The
# release workflow passes its own pin; this one is for builds by hand.
NODE_IMAGE=${NODE_IMAGE:-docker.io/library/node:22-alpine@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202}

if [ "$#" -ge 2 ]; then
  mkdir -p "$2"
  out=$(cd "$2" && pwd)
  [ -z "$(ls -A "$out")" ] || { echo "$out is not empty" >&2; exit 2; }
  case "$out/" in "$branch/"*) echo "$out is inside the branch; build there without an output folder" >&2; exit 2 ;; esac
else
  out=$branch
  for f in "$out"/* "$out"/.[!.]*; do
    case "$(basename "$f")" in _demo|README.md|CNAME|.gitignore|.git|'*'|'.[!.]*') ;; *) rm -rf "$f" ;; esac
  done
fi

podman run --rm \
  -v "$main/source":/app-src:ro,z -v "$branch/_demo":/demo-src:ro,z -v "$out":/out:z \
  -v radio-demo-npm-cache:/root/.npm \
  "$NODE_IMAGE" sh -c '
    set -e
    mkdir /w && cd /app-src && tar cf - --exclude=./node_modules --exclude=./dist . | tar xf - -C /w
    cp -r /demo-src /w/demo
    cd /w && npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null
    DEMO_OUT=/out npx vite build --config demo/vite.config.ts
  '

# Jekyll would leave out anything whose name starts with _ or . — the site must have none.
# In the branch, its own _demo/, .git and .gitignore are no part of the site; in
# an output folder, nothing is excused.
if [ "$out" = "$branch" ]; then
  bad=$(cd "$out" && find . \( -path ./_demo -o -path ./.git -o -path ./.gitignore \) -prune -o ! -path . \( -name '_*' -o -name '.*' \) -print)
else
  bad=$(cd "$out" && find . ! -path . \( -name '_*' -o -name '.*' \) -print)
fi
if [ -n "$bad" ]; then echo "built files Jekyll would not publish:" >&2; echo "$bad" >&2; exit 1; fi
[ -s "$out/index.html" ] || { echo "no index.html was built" >&2; exit 1; }
find "$out" -path "$out/_demo" -prune -o -path "$out/.git" -prune -o -type f -print | while IFS= read -r f; do
  # Through grep, not $(...): a binary file's bytes do not belong in the shell.
  if head -c 3 "$f" | grep -qx -- '---'; then echo "$f begins like front matter, which Jekyll would process" >&2; exit 1; fi
done
echo "built into $out: $(cd "$out" && ls)"
