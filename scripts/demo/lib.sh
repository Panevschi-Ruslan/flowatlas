# Typing helpers for the recorded demos. Sourced by every scene.
#
# A scene is a shell script so that what the viewer sees is what actually ran:
# `say` types a command out, then executes that same string. Nothing is faked.

DEMO_TYPE_DELAY=${DEMO_TYPE_DELAY:-0.022}
PROMPT=$'\033[38;5;114m$\033[0m '

# The repository this demo is recorded from, so that a scene can reach its
# scripts without knowing where it was sourced from.
FLOWATLAS_REPO=${FLOWATLAS_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}

# The id of one node of the demo project, asked for by what it is:
#
#   node_id ui_action handling 'web#src/app/checkout.component.ts:Component.method'
#
# A scene types a real command at a real prompt, so one that shows a node id has
# to have the real id to type. Node ids carry the line the thing was written at,
# and a scene with one written into it holds that fixture line in place. This
# asks the built graph instead, and fails loudly rather than typing nothing.
node_id() {
  node "$FLOWATLAS_REPO/scripts/fixture-node-id.mjs" "$PWD/.flowatlas/project-graph.json" "$@"
}

# Types a command one character at a time, then runs it.
say() {
  printf '%s' "$PROMPT"
  local i c
  for ((i = 0; i < ${#1}; i++)); do
    c="${1:$i:1}"
    printf '%s' "$c"
    sleep "$DEMO_TYPE_DELAY"
  done
  printf '\n'
  sleep 0.35
  eval "$1"
  sleep "${2:-1.8}"
}

# A comment line, typed at the prompt and not run. Explains the next step.
note() {
  printf '%s\033[38;5;245m' "$PROMPT"
  local i
  for ((i = 0; i < ${#1}; i++)); do
    printf '%s' "${1:$i:1}"
    sleep "$DEMO_TYPE_DELAY"
  done
  printf '\033[0m\n'
  sleep "${2:-1.2}"
}

# Runs something the viewer does not need to watch, e.g. setting the scene.
quietly() { eval "$1" >/dev/null 2>&1; }

pause() { sleep "${1:-1.5}"; }
