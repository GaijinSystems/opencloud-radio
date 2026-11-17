#!/bin/sh
# The release notes for a version, and the check that it is the version.
#
#   sh source/scripts/release-notes.sh [version]
#
# Run from the repository root. Fails, saying why, unless every place the
# project records its version agrees — source/package.json, both entries in
# source/package-lock.json, and the titles of INSTALL.md and CONTENTS.md — and
# CHANGELOG.md has a section "## <version>" (a date may follow) with something
# in it. Given a version, fails unless that is the version. Prints the section.
# POSIX sh, awk and sed only.
set -eu

fail() { echo "release-notes: $*" >&2; exit 1; }
for f in source/package.json source/package-lock.json INSTALL.md CONTENTS.md CHANGELOG.md; do
  [ -f "$f" ] || fail "$f not found; run this from the repository root"
done

# The n-th "version" in a file: package.json's own, and the lock file's two —
# its top level and the app's own entry (packages[""]), which come first.
nth_version() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" | sed -n "$2p"; }

version=$(nth_version source/package.json 1)
[ -n "$version" ] || fail "source/package.json has no version"
expect() { [ "$2" = "$version" ] || fail "$1 says '$2', source/package.json says '$version'"; }
expect "source/package-lock.json (top level)" "$(nth_version source/package-lock.json 1)"
expect "source/package-lock.json (the app's entry)" "$(nth_version source/package-lock.json 2)"
expect "INSTALL.md's title" "$(sed -n '1s/^# Installing OpenCloud Radio //p' INSTALL.md)"
expect "CONTENTS.md's title" "$(sed -n '1s/^# OpenCloud Radio \([^ ]*\) — what is here$/\1/p' CONTENTS.md)"
[ "${1:-$version}" = "$version" ] || fail "asked for $1, but the code is at $version"

# The section: from "## <version>" (alone, or followed by a space) to the next
# "## ", without the heading itself or the blank lines around it.
notes=$(awk -v v="$version" '
  /^## / { if (inside) exit; if (index($0 " ", "## " v " ") == 1) { inside = 1; next } }
  inside' CHANGELOG.md | sed -e '/./,$!d')
[ -n "$notes" ] || fail "CHANGELOG.md has no section for $version, or it is empty"
printf '%s\n' "$notes"
