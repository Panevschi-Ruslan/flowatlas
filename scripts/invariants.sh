#!/usr/bin/env bash
#
# Checks the invariants that no unit test can express, because they are about
# what the source may not contain rather than about what it computes.
#
# I1  the core names no technology
# I11 fixture snapshots carry the current schema version
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

status=0

# Word-bounded on purpose: without -w this matches identifiers that merely
# contain one of the words, such as the expression node types of the parser.
FORBIDDEN='typeorm|prisma|mongoose|mikro-orm|sequelize|knex|drizzle|kafka|rabbit|amqp|bullmq|ioredis|telegraf|angular|axios|express|fastify'

echo "I1  core is technology-agnostic"
if hits="$(grep -rEinw "$FORBIDDEN" packages/core/src 2>/dev/null)"; then
  echo "$hits" | sed 's/^/    /'
  echo "    FAIL: the core must not name a technology, in code or in comments."
  echo "    Move it behind an adapter, or into the package that owns that name."
  status=1
else
  echo "    ok"
fi

echo "I11 schema version matches fixture snapshots"
if node scripts/check-schema-version.mjs; then
  echo "    ok"
else
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "invariants ok"
else
  echo "invariants FAILED"
fi
exit "$status"
