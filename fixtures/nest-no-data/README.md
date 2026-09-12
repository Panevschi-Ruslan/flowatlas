# nest-no-data

A service that genuinely stores nothing: two providers, a controller, and a map
that lives as long as the process does.

It has no leaf of any kind — no data operation, no cache, no outgoing request,
no setting read — which is exactly the shape a rule phrased as "providers and no
leaves" would nag about. Nothing here is named like a data layer and nothing in
the manifest is a database, so there is no evidence any store was missed, and
`unresolved` must stay empty.

This is the counter-case to `nest-hidden-db`: the same silence, and the opposite
verdict.
