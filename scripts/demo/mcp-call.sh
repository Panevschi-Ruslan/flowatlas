#!/bin/bash
# Calls one tool on `flowatlas mcp` the way an agent would: JSON-RPC over stdio.
# Prints the answer the way a person reads it: the tools by name and title, a
# text answer as written, anything else as indented keys and values.
#
# Usage: mcp-call tools/list
#        mcp-call find_symbol query=osc
#        mcp-call get_flow entry='POST /orders/:id/invoice'
set -euo pipefail

method=$1
shift

if [ "$method" = tools/list ]; then
  request='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
else
  # Each key=value is one argument; a value that reads as JSON (a number,
  # true, a list) is passed as that, anything else as a string.
  request=$(node -e '
    const [name, ...pairs] = process.argv.slice(1);
    const args = {};
    for (const pair of pairs) {
      const at = pair.indexOf("=");
      const value = pair.slice(at + 1);
      try { args[pair.slice(0, at)] = JSON.parse(value); } catch { args[pair.slice(0, at)] = value; }
    }
    console.log(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }));
  ' "$method" "$@")
fi

printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  "$request" |
  flowatlas mcp 2>/dev/null |
  node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
    const { result } = lines.map((line) => JSON.parse(line)).find((message) => message.id === 2);
    if (result.tools !== undefined) {
      const width = Math.max(...result.tools.map((tool) => tool.name.length));
      for (const tool of result.tools) console.log(`${tool.name.padEnd(width)}  ${tool.title ?? ""}`);
      process.exit(0);
    }
    const text = result.content?.[0]?.text ?? "";
    let answer;
    try { answer = JSON.parse(text); } catch { console.log(text); process.exit(0); }
    if (typeof answer.markdown === "string") { process.stdout.write(answer.markdown); process.exit(0); }
    const say = (value, indent) => {
      const pad = " ".repeat(indent);
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && typeof item === "object") {
            const [first, ...rest] = Object.entries(item);
            console.log(`${pad}- ${first[0]}: ${first[1]}`);
            say(Object.fromEntries(rest), indent + 2);
          } else console.log(`${pad}- ${item}`);
        }
        return;
      }
      for (const [key, item] of Object.entries(value)) {
        if (item !== null && typeof item === "object") { console.log(`${pad}${key}:`); say(item, indent + 2); }
        else console.log(`${pad}${key}: ${item}`);
      }
    };
    say(answer, 0);
  '
