#!/bin/bash
# Prints lines of a file with their numbers, for a scene that points at code.
#
#   show api/src/orders/orders.service.ts 21-27
#   show api/src/orders/order.dto.ts 7
set -euo pipefail

file=$1
range=${2:-1-$(wc -l < "$file" | tr -d ' ')}
from=${range%-*}
to=${range#*-}

printf '\033[38;5;245m%s\033[0m\n' "── $file"
awk -v from="$from" -v to="$to" \
  'NR >= from && NR <= to { printf "\033[38;5;245m%4d\033[0m  %s\n", NR, $0 }' "$file"
