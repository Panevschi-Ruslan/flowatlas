#!/bin/bash
# Records the demo GIFs in docs/media, one per scene.
#
#   scripts/demo/record.sh            every scene
#   scripts/demo/record.sh 03 07      only those
#
# Needs asciinema and agg:  brew install asciinema agg
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEMO=/tmp/flowatlas-demo
OUT=$ROOT/docs/media
CASTS=$ROOT/.demo-casts
COLS=124

mkdir -p "$OUT" "$CASTS"

# Which state each scene starts from. A scene shows one idea; everything it
# needs to have happened already happens here, off camera.
state_of() {
  case $1 in
    01-*) echo raw ;;
    02-* | 03-*) echo built ;;
    08-* | 91-*) echo renamed ;;
    11-*) echo streams ;;
    12-*) echo folded ;;
    *) echo tuned ;;
  esac
}

# The two settings `flowatlas doctor` asks for in scene 02, applied off camera so
# that the later scenes start from a project that is configured.
tune() {
  jq '(.services[]|select(.name=="orders")).baseUrlEnv=["ORDERS_URL"]
    | (.services[]|select(.name=="web")).apiTarget={apiUrl:"gateway"}' \
    "$DEMO/flowatlas.config.json" > "$DEMO/c.tmp"
  mv "$DEMO/c.tmp" "$DEMO/flowatlas.config.json"
}

# Which fixture a state is built from, when it is not the four-service one.
fixture_of() {
  case $1 in
    streams) echo sse-stream ;;
    folded) echo folded-channels ;;
    *) echo '' ;;
  esac
}

prepare() {
  # A scene whose subject the four-service demo does not contain is built from
  # the fixture that does, configured — what those scenes show is not the
  # writing of a configuration.
  local other
  other=$(fixture_of "$1")
  if [ -n "$other" ]; then
    FIXTURE=$other WITH_CONFIG=1 "$ROOT/scripts/demo/reset.sh" > /dev/null
    (cd "$DEMO" && PATH="$DEMO/.bin:$PATH" flowatlas build) > /dev/null 2>&1
    return 0
  fi
  "$ROOT/scripts/demo/reset.sh" > /dev/null
  [ "$1" = raw ] && return 0
  (cd "$DEMO" && PATH="$DEMO/.bin:$PATH" flowatlas init --dir . --yes) > /dev/null 2>&1
  [ "$1" = built ] || tune
  (cd "$DEMO" && PATH="$DEMO/.bin:$PATH" flowatlas build) > /dev/null 2>&1
  if [ "$1" = renamed ]; then
    sed -i '' "s/@Get(':id')/@Get('detail\/:id')/" \
      "$DEMO/orders/src/orders/orders.controller.ts"
  fi
  return 0
}

# Writes the runner the recording actually executes. `fast` runs the same scene
# with the typing and the pauses removed, which is how the scene gets measured.
runner() {
  local scene=$1 fast=${2:-}
  {
    echo '#!/bin/bash'
    echo "source '$ROOT/scripts/demo/lib.sh'"
    echo "export PATH='$DEMO/.bin':\$PATH"
    echo "cd '$DEMO'"
    if [ -n "$fast" ]; then
      echo 'DEMO_TYPE_DELAY=0'
      echo 'sleep() { :; }'
    else
      echo 'clear'
      echo 'sleep 0.8'
    fi
    echo "source '$scene'"
  } > "$DEMO/.bin/scene"
  chmod +x "$DEMO/.bin/scene"
}

# How tall the terminal has to be for the whole scene to stay on screen. Runs it
# once with the typing and the pauses removed, in a terminal of the same width,
# and counts the lines it prints, wrapping included. Measuring through a pseudo
# terminal matters: `ls` and everything else print differently into a pipe.
height_of() {
  local scene=$1 txt=$CASTS/.measure.txt
  runner "$scene" fast
  rm -f "$txt"
  asciinema rec --quiet --window-size "${COLS}x400" --output-format txt \
    --command "$DEMO/.bin/scene" "$txt" > /dev/null 2>&1
  awk -v cols="$COLS" '
    { lines[NR] = $0; if (length($0)) last = NR }
    END {
      for (i = 1; i <= last; i++) n += 1 + int(length(lines[i]) / cols)
      print n + 2
    }' "$txt"
}

record() {
  local scene=$1 name state rows
  name=$(basename "$scene" .sh)
  state=$(state_of "$name")

  prepare "$state"
  rows=$(height_of "$scene")
  echo "── $name (from $state, ${COLS}x${rows})"

  prepare "$state"
  runner "$scene"

  rm -f "$CASTS/$name.cast"
  asciinema rec --quiet --window-size "${COLS}x${rows}" \
    --command "$DEMO/.bin/scene" "$CASTS/$name.cast"

  agg --font-size 14 --line-height 1.35 --theme asciinema \
    --idle-time-limit 2 --last-frame-duration 4 --fps-cap 20 \
    "$CASTS/$name.cast" "$OUT/$name.gif" > /dev/null 2>&1

  printf '   %s  %s\n' "docs/media/$name.gif" \
    "$(du -h "$OUT/$name.gif" | tr -d '\t ' | sed 's|/.*||')"
}

scenes=()
if [ $# -eq 0 ]; then
  scenes=("$ROOT"/scripts/demo/scenes/*.sh)
else
  for pick in "$@"; do scenes+=("$ROOT"/scripts/demo/scenes/"$pick"-*.sh); done
fi

for scene in "${scenes[@]}"; do record "$scene"; done
