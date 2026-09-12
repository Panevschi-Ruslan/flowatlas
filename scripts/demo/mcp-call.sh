#!/bin/bash
# Calls one tool on `flowatlas mcp` the way an agent would: JSON-RPC over stdio.
#
# Usage: mcp-call tools/list
#        mcp-call get_flow '{"entry":"POST /orders/:id/invoice"}'
set -euo pipefail

method=$1
args=${2:-'{}'}

if [ "$method" = tools/list ]; then
  request='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
else
  request=$(jq -cn --arg name "$method" --argjson args "$args" \
    '{jsonrpc:"2.0",id:2,method:"tools/call",params:{name:$name,arguments:$args}}')
fi

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  "$request" |
  flowatlas mcp 2>/dev/null |
  jq -c 'select(.id == 2) | .result'
