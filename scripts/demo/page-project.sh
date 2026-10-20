#!/bin/bash
# Builds the page the screenshots and the page tours are taken of: the
# four-service demo, configured, with the traces beside it laid over the map.
#
#   scripts/demo/page-project.sh       prints the page's path
#
# Its own directory, so a recording running at the same time is not disturbed.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEMO=${DEMO_DIR:-/tmp/flowatlas-page}

DEMO_DIR=$DEMO WITH_CONFIG=1 "$ROOT/scripts/demo/reset.sh" > /dev/null
cd "$DEMO"
export PATH="$DEMO/.bin:$PATH"
{
  flowatlas build
  flowatlas observe traces/checkout.otlp.json traces/orders.observe.json traces/billing.observe.json traces/web.har --shapes
  flowatlas visualise --out page.html --title Shop
} > "$DEMO/.page.log" 2>&1
echo "$DEMO/page.html"
