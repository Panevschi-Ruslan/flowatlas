note "traffic through three services: OpenTelemetry spans, and @nestjs/observe snapshots"
say "ls traces/*.json" 2.5
note "lay what really ran over the map. nothing is ever drawn from a trace"
say "flowatlas observe traces/checkout.otlp.json traces/orders.observe.json traces/billing.observe.json" 5
note "a status real traffic got that no failure in the code declares"
say "flowatlas doctor --reason failure-seen-undeclared | sed -n '3,8p'" 5
note "the same counts, timings and failures are on every step of the page"
pause 3
