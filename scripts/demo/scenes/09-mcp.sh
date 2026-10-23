note "init also registered the graph server in every repository"
say "cat orders/.mcp.json" 3
note "an agent connects over stdio and gets the tools this project can answer"
say "mcp-call tools/list" 4
note "camel-case initials are enough to find a symbol"
say "mcp-call find_symbol query=osc" 3.5
note "and before it changes the orders table, it reads a summary of it, written for a prompt"
say "mcp-call describe_for_prompt id=table:orders#orders" 4
pause 2
