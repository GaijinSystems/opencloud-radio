#!/bin/sh
# Tests ../haproxy-relay.cfg end to end: the relay's own backend lines, in a
# real HAProxy, in front of an origin that misbehaves on purpose (origin.mjs),
# asked by a client that plays the visitor's browser (check.mjs). Needs only
# podman; nothing is installed. The containers run on a network of their own
# with no way out; the only traffic off the machine is podman fetching the
# node and haproxy images the first time, if they are not here already.
#
#   deploy/relay-test/run.sh            HAProxy 2.4 and 3.0
#   deploy/relay-test/run.sh 2.8        one version of your choice
#
# Every line should read PASS, and KNOWN GAP the one thing the example
# documents it cannot close. Against the example as shipped in 1.1.9, the
# check failed 17 of the 23 checks it had then.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
versions=${*:-2.4 3.0}
net=radio-relay-test-$$
work=$(mktemp -d)
cleanup() {
  podman rm -f "$net-origin" "$net-relay" >/dev/null 2>&1 || true
  podman network rm "$net" >/dev/null 2>&1 || true
  rm -f "$work/haproxy.cfg"; rmdir "$work" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM   # so an interrupted run still cleans up, in every shell

podman run --rm --network none \
  -v "$here/build-config.mjs:/build-config.mjs:ro,z" -v "$here/../haproxy-relay.cfg:/haproxy-relay.cfg:ro,z" \
  -v "$work:/w:z" docker.io/library/node:22-alpine node /build-config.mjs /haproxy-relay.cfg /w/haproxy.cfg
podman network create --internal "$net" >/dev/null
podman run -d --name "$net-origin" --network "$net" --network-alias origin \
  -v "$here/origin.mjs:/origin.mjs:ro,z" docker.io/library/node:22-alpine node /origin.mjs >/dev/null

status=0
for v in $versions; do
  podman run -d --name "$net-relay" --network "$net" --network-alias relay \
    -v "$work/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro,z" "docker.io/library/haproxy:$v" >/dev/null
  sleep 2
  echo "=== HAProxy $v"
  podman run --rm --network "$net" -v "$here/check.mjs:/check.mjs:ro,z" docker.io/library/node:22-alpine \
    node /check.mjs || status=1
  podman rm -f "$net-relay" >/dev/null
done
exit $status
