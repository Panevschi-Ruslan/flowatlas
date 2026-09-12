#!/bin/bash
# Builds the demo project the recordings run against, from fixtures/multi-repo.
#
# Four services that do not share a repository, which is the shape flowatlas is
# for. Each one becomes its own git repository with a single commit, so that
# `flowatlas diff` has a base to compare a working-tree change against.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEMO=${DEMO_DIR:-/tmp/flowatlas-demo}

rm -rf "$DEMO"
mkdir -p "$DEMO"

for name in billing gateway orders web shared; do
  cp -R "$ROOT/fixtures/multi-repo/$name" "$DEMO/$name"
  rm -rf "$DEMO/$name/.flowatlas" "$DEMO/$name/.mcp.json"
done

for name in billing gateway orders web; do
  git -C "$DEMO/$name" init -q -b main
  git -C "$DEMO/$name" add -A
  git -C "$DEMO/$name" -c user.name=demo -c user.email=demo@example.com \
    commit -qm 'the project as it stands'
done

# `flowatlas` on PATH without asking the viewer to install anything first.
mkdir -p "$DEMO/.bin"
ln -sf "$ROOT/packages/cli/bin/flowatlas.js" "$DEMO/.bin/flowatlas"
ln -sf "$ROOT/scripts/demo/mcp-call.sh" "$DEMO/.bin/mcp-call"

echo "$DEMO"
