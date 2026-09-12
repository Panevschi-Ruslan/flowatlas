note "init also registered the graph server in every repository"
say "cat orders/.mcp.json" 3
note "an agent connects over stdio and gets ten tools"
say "mcp-call tools/list | jq -r '.tools[].name'" 4
note "camel-case initials are enough to find a symbol"
say "mcp-call find_symbol '{\"query\":\"osc\"}' | jq -r '.content[0].text' | jq -r '.matches[].id'" 3.5
note "and this is the answer to what a change to that table would reach"
say "mcp-call impact '{\"symbol\":\"table:orders#Order\"}' | jq -r '.content[0].text' | jq -r '.entries[] | \"\\(.service)  \\(.label)\"'" 4
pause 2
