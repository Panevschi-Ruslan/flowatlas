#!/usr/bin/env bash
#
# Checks the invariants that no unit test can express, because they are about
# what the source may not contain rather than about what it computes.
#
# I1  the core names no technology
# I2  no source carries a raw control character
# I11 fixture snapshots carry the current schema version
# I12 no extractor is reachable from a sibling extractor
# I13 every reason a row carries is a reason doctor knows
# I14 the coverage harness and the tool agree what a service is
#
# Usage: invariants.sh [--root DIR] [--only NAME]
#
# `--root` and `--only` exist so the gates can be run against a tree built for
# the purpose. A gate nobody has ever seen fail is not known to work, and the
# only honest way to watch one fail is to hand it a tree that breaks it; doing
# that inside this repository would mean committing the very thing being
# forbidden. `--only` is needed alongside it because a tree with one bad file in
# it has no fixture snapshots for I11 to read.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
only=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) root="$2"; shift 2 ;;
    --only) only="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$root" || exit 2

status=0

# Word-bounded on purpose: without -w this matches identifiers that merely
# contain one of the words, such as the expression node types of the parser.
#
# `next` is deliberately absent, and its absence is not an oversight. Word
# bounded it matches `const next = ...` in `core/src/trace.ts` and in
# `core/src/types/type-ref.ts`, where it is the ordinary English word for the
# following element and has nothing to do with any framework. A list that cannot
# carry a name says so here rather than looking incomplete.
FORBIDDEN='typeorm|prisma|mongoose|mikro-orm|sequelize|knex|drizzle|kafka|rabbit|amqp|bullmq|ioredis|telegraf|angular|axios|express|fastify|react|svelte|vue|nuxt|remix'

check_I1() {
  echo "I1  core is technology-agnostic"
  if hits="$(grep -rEinw "$FORBIDDEN" packages/core/src 2>/dev/null)"; then
    echo "$hits" | sed 's/^/    /'
    echo "    FAIL: the core must not name a technology, in code or in comments."
    echo "    Move it behind an adapter, or into the package that owns that name."
    return 1
  fi
  echo "    ok"
}

# Everything below the printable range except the two characters a text file is
# entitled to: the newline that ends a line and the tab that may indent one.
# Bytes at 0x80 and above are left alone because they are the continuation of a
# UTF-8 character, and the prose comments in this repository are full of them.
#
# Written with `tr` rather than `grep` because BSD `grep` will not match a NUL
# inside a line at all — which is exactly the byte this gate exists for, so the
# obvious spelling would have passed on the one case that motivated it.
PRINTABLE='[:print:]\n\t\200-\377'

# What I2 reads: every file in this tree, whatever its language, minus the two
# lists written out below. It used to be `packages/*/src` and `.ts`/`.tsx`, and
# the file that carried the NUL was `scripts/coverage/read-gate.mjs` — the gate
# was narrower than the hazard it was written for, and `scripts/` is where the
# counting rule, the read gate, the fixture harness and these invariants live,
# which is the last place a file may be unreadable to `grep` (R131).
#
# Stated here as two lists rather than implied by a glob nobody re-reads, so
# that widening the gate is deleting a line and narrowing it is adding one with
# a reason beside it.
#
# Directories holding nothing this repository maintains. `node_modules` is
# pruned everywhere except under `fixtures/`, where the type stubs a fixture
# ships are tracked source and are read like any other.
I2_PRUNED='.git .claude .idea dist node_modules .coverage-cache .demo-casts .flowatlas'

# Files entitled to a byte below the printable range, each with the reason:
#   *.gif, *.png  images — the bytes are the picture
#   *.ansi.txt    a recording of coloured terminal output — the ESC byte is the
#                 thing the snapshot exists to record, and one such expectation
#                 (`fixtures/multi-repo/expected.cli/...tree.ansi.txt`) is the
#                 only file in the tree that carries one today
#   .DS_Store     not this project's file at all: Finder writes it into any
#                 directory somebody has looked at, it is gitignored, and this
#                 gate reads the working tree rather than the index — on purpose,
#                 because its own test runs against a directory that is not a
#                 repository, where `git ls-files` would make it pass by reading
#                 nothing. So an untracked file has to be named to be skipped,
#                 and this is the one everybody on a Mac has.
I2_EXEMPT='*.gif *.png *.ansi.txt */.DS_Store'

# Every file the gate reads, built from the list above rather than from a second
# copy of it written into a `find` expression.
i2_files() {
  local prune=()
  local dir
  for dir in $I2_PRUNED; do
    # `-o` between the rows, so the first row is added without one.
    [ "${#prune[@]}" -eq 0 ] || prune+=( -o )
    if [ "$dir" = 'node_modules' ]; then
      prune+=( '(' -name node_modules -not -path './fixtures/*' ')' )
    else
      prune+=( -name "$dir" )
    fi
  done
  find . '(' "${prune[@]}" ')' -prune -o -type f -print 2>/dev/null | sort
}

# Whether a path is on the exempt list above.
#
# `set -f` first, and it is load-bearing rather than tidy: without it the `for`
# expands each pattern against the working directory before the `case` ever sees
# it, so `*/.DS_Store` arrives as the name of a file that happens to exist and
# matches nothing. The older entries only looked correct because nothing in the
# root matches `*.gif`.
#
# The option is saved and put back by hand rather than with `local -`, because
# `local -` is bash 4.4 and the bash macOS ships is 3.2: there it prints
# "not a valid identifier" once per file - two and a half thousand lines a run -
# and leaves `set -f` on for the rest of the script, which is the opposite of
# what the line beside it claimed.
i2_exempt() {
  local pattern
  local was_off=1
  case $- in *f*) was_off=0 ;; esac
  set -f
  local found=1
  for pattern in $I2_EXEMPT; do
    # shellcheck disable=SC2254 — the list is a list of globs, on purpose.
    case "$1" in $pattern) found=0; break ;; esac
  done
  [ "$was_off" = 1 ] && set +f
  return "$found"
}

check_I2() {
  echo "I2  no source carries a raw control character"
  local found=0
  local read_count=0
  local file
  local count
  # A NUL byte written into a string literal instead of its escape compiled,
  # bundled, passed the tests and passed every other invariant, and at run time
  # every namespace read as unreadable. Nothing else in this repository looks at
  # the bytes of a source file, so nothing else could have caught it.
  while IFS= read -r file; do
    i2_exempt "$file" && continue
    read_count=$((read_count + 1))
    count="$(LC_ALL=C tr -d "$PRINTABLE" < "$file" | wc -c | tr -d ' ')"
    [ "$count" = "0" ] && continue
    echo "    $file: $count control character(s)"
    found=1
  done < <(i2_files)
  if [ "$found" -ne 0 ]; then
    echo "    FAIL: a source file carries a raw control character."
    echo "    Run 'xxd <file> | grep -v ..' to find it, and write the escape instead."
    return 1
  fi
  echo "    ok ($read_count files; every file in the tree except $I2_EXEMPT,"
  echo "        and except $I2_PRUNED)"
}

check_I11() {
  echo "I11 schema version matches fixture snapshots"
  if node scripts/check-schema-version.mjs; then
    echo "    ok"
    return 0
  fi
  return 1
}

# The extractors are siblings and none of them is above any other, so none of
# them should be buildable only by building another. I1 keeps a technology out
# of the core; this keeps an ecosystem out of the extractor for a different one.
# The reasoning, and the one chain that is still allowed, are in the script.
check_I12() {
  echo "I12 no extractor is reachable from a sibling extractor"
  if node scripts/check-extractor-siblings.mjs; then
    echo "    ok"
    return 0
  fi
  return 1
}

# An unregistered reason does not break a report, which is why this has to be a
# gate. The row's own hint wins over the catalogue, so a reason whose rows all
# carry their own hint reads perfectly while `isKnownReason` says no, and the
# only thing that ever says so is one line in a footer. Twice in one month that
# line was the only notice anybody got. The script explains what it can and
# cannot see; the blind spots are written down there on purpose.
check_I13() {
  echo "I13 every reason a row carries is a reason doctor knows"
  if node scripts/check-doctor-reasons.mjs; then
    echo "    ok"
    return 0
  fi
  return 1
}

# The coverage harness works out a service's extent from the repository's
# manifests rather than asking the tool, so that a denominator can disagree with
# the numerator; the price is two implementations of one question, and this is
# what is paid instead of letting them drift in silence. The script explains the
# trade and what it can and cannot see.
check_I14() {
  echo "I14 the coverage harness and the tool agree what a service is"
  if node scripts/check-coverage-extent.mjs; then
    echo "    ok"
    return 0
  fi
  return 1
}

# The gates, in the order they are reported. A list and a name per function
# rather than a run of branches, so adding one is adding a name.
CHECKS='I1 I2 I11 I12 I13 I14'

for name in $CHECKS; do
  [ -n "$only" ] && [ "$only" != "$name" ] && continue
  "check_$name" || status=1
done

if [ "$status" -eq 0 ]; then
  echo "invariants ok"
else
  echo "invariants FAILED"
fi
exit "$status"
