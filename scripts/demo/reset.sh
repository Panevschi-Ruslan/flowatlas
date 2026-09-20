#!/bin/bash
# Builds the demo project the recordings run against, from a fixture.
#
# Services that do not share a repository, which is the shape flowatlas is for.
# Each one becomes its own git repository with a single commit, so that
# `flowatlas diff` has a base to compare a working-tree change against.
#
#   scripts/demo/reset.sh                          fixtures/multi-repo
#   FIXTURE=sse-stream WITH_CONFIG=1 …/reset.sh    another fixture, configured
#
# `WITH_CONFIG=1` copies the fixture's configuration in, for a scene that shows
# something other than writing one. Without it the demo starts where a reader
# does: repositories, and nothing joining them yet.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEMO=${DEMO_DIR:-/tmp/flowatlas-demo}
FIXTURE=${FIXTURE:-multi-repo}
SRC=$ROOT/fixtures/$FIXTURE

rm -rf "$DEMO"
mkdir -p "$DEMO"

# Every directory of the fixture is part of the project; the files beside them
# are the fixture's own scaffolding and belong to the test suite, not the demo.
for path in "$SRC"/*/; do
  name=$(basename "$path")
  # `expected.*` holds what the suite compares against, and `node_modules` the
  # stubs it type-checks with. Neither is part of the project being shown.
  case $name in node_modules | expected.*) continue ;; esac
  cp -R "$path" "$DEMO/$name"
  rm -rf "$DEMO/$name/.flowatlas" "$DEMO/$name/.mcp.json"
done
[ "${WITH_CONFIG:-}" = 1 ] && cp "$SRC/flowatlas.config.json" "$DEMO/flowatlas.config.json"

# The stubs the fixtures type-check against live above them, shared by all of
# them. Without a path to those, a repository reads with its imports unresolved
# and the summary says so — true, and not what any of these scenes is about.
[ -d "$ROOT/fixtures/node_modules" ] && ln -sfn "$ROOT/fixtures/node_modules" "$DEMO/node_modules"

# A repository is one a service points at. The rest — a shared package of types,
# say — is carried along without a history of its own.
for repo in $(node -e "
  const { services } = require('$SRC/flowatlas.config.json');
  for (const service of services) console.log(require('node:path').basename(service.repo));
"); do
  [ -d "$DEMO/$repo" ] || continue
  git -C "$DEMO/$repo" init -q -b main
  git -C "$DEMO/$repo" add -A
  git -C "$DEMO/$repo" -c user.name=demo -c user.email=demo@example.com \
    commit -qm 'the project as it stands'
done

# `flowatlas` on PATH without asking the viewer to install anything first.
mkdir -p "$DEMO/.bin"
ln -sf "$ROOT/packages/cli/bin/flowatlas.js" "$DEMO/.bin/flowatlas"
ln -sf "$ROOT/scripts/demo/mcp-call.sh" "$DEMO/.bin/mcp-call"

echo "$DEMO"
