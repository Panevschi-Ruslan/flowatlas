#!/usr/bin/env bash
#
# Checks the invariants that no unit test can express, because they are about
# what the source may not contain rather than about what it computes.
#
# I1  the core names no technology
# I2  no source carries a raw control character
# I11 fixture snapshots carry the current schema version
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

check_I2() {
  echo "I2  no source carries a raw control character"
  local found=0
  local file
  local count
  # A NUL byte written into a string literal instead of its escape compiled,
  # bundled, passed the tests and passed every other invariant, and at run time
  # every namespace read as unreadable. Nothing else in this repository looks at
  # the bytes of a source file, so nothing else could have caught it.
  while IFS= read -r file; do
    count="$(LC_ALL=C tr -d "$PRINTABLE" < "$file" | wc -c | tr -d ' ')"
    [ "$count" = "0" ] && continue
    echo "    $file: $count control character(s)"
    found=1
  done < <(find packages/*/src -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null | sort)
  if [ "$found" -ne 0 ]; then
    echo "    FAIL: a source file carries a raw control character."
    echo "    Run 'xxd <file> | grep -v ..' to find it, and write the escape instead."
    return 1
  fi
  echo "    ok"
}

check_I11() {
  echo "I11 schema version matches fixture snapshots"
  if node scripts/check-schema-version.mjs; then
    echo "    ok"
    return 0
  fi
  return 1
}

# The gates, in the order they are reported. A list and a name per function
# rather than a run of branches, so adding one is adding a name.
CHECKS='I1 I2 I11'

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
