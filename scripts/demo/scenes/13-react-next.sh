rename=$(node -e "const g=JSON.parse(require('fs').readFileSync('.flowatlas/project-graph.json','utf8'));const n=g.nodes.find((x)=>x.type==='ui_action'&&/rename\(/.test(x.label||''));if(!n)process.exit(1);console.log(n.id)")
note "a React button in one repository, a Next.js API in another"
say "show web/src/components/OrdersPanel.tsx 20-22" 3
note "read both, and join them"
say "flowatlas build" 4
note "follow the Rename click across both repositories, down to the table"
say "flowatlas flow '$rename' --format tree" 7
note "hook, client, route, middleware, store, table: nothing unread along it"
pause 3
