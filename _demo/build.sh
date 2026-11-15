#!/bin/sh
# Builds the demo into this branch's root, from the app's source on main.
#
#   _demo/build.sh /path/to/a/checkout/of/main
#
# Run it from the root of the gh-pages branch. Needs only podman. The app's
# source is copied into a container, the demo's files beside it, and the built
# site written here. The previous build is removed first; _demo/, README.md,
# CNAME and .gitignore are kept.
set -eu
main=$(cd "${1:?usage: _demo/build.sh /path/to/main-checkout}" && pwd)
here=$(pwd)
[ -f "$main/source/package.json" ] || { echo "$main is not a checkout of main (no source/package.json)" >&2; exit 2; }
[ -d "$here/_demo" ] || { echo "run this from the root of the gh-pages branch" >&2; exit 2; }

for f in "$here"/* "$here"/.[!.]*; do
  case "$(basename "$f")" in _demo|README.md|CNAME|.gitignore|.git|'*'|'.[!.]*') ;; *) rm -rf "$f" ;; esac
done

podman run --rm \
  -v "$main/source":/app-src:ro,z -v "$here/_demo":/demo-src:ro,z -v "$here":/out:z \
  -v radio-demo-npm-cache:/root/.npm \
  docker.io/library/node:22-alpine sh -c '
    set -e
    mkdir /w && cd /app-src && tar cf - --exclude=./node_modules --exclude=./dist . | tar xf - -C /w
    cp -r /demo-src /w/demo
    cd /w && npm ci --legacy-peer-deps --no-audit --no-fund >/dev/null
    DEMO_OUT=/out npx vite build --config demo/vite.config.ts
  '

# Jekyll would leave out anything whose name starts with _ or . — the site must have none.
bad=$(cd "$here" && find . -path ./_demo -prune -o -path ./.git -prune -o \( -name '_*' -o -name '.*' \) -print | grep -v '^\.$' | grep -v '^\./\.gitignore$' || true)
if [ -n "$bad" ]; then echo "built files Jekyll would not publish:" >&2; echo "$bad" >&2; exit 1; fi
for f in "$here"/index.html "$here"/assets/*; do
  if [ "$(head -c 3 "$f")" = '---' ]; then echo "$f begins like front matter, which Jekyll would process" >&2; exit 1; fi
done
echo "built: $(cd "$here" && ls)"
