# same-service

One repository, and the whole of the fixture is one sentence: a screen in it
asks for an address a route in it answers, and the tool says so.

That is the commonest shape a web application has and it was the one shape the
join could not see. A relative `fetch('/api/things')` names no service and has
no base-address setting behind it, so nothing in the configuration could say
where it goes; the only reading available is that it goes to the service it was
written in — and that service was the one struck out of the search (R93). On
A scheduling app that lost every one of thirty-two requests its browser makes and
produced twenty-three rows saying no configured service serves an address
sitting in the same graph.

So the edge here carries `via: same-service`, and it is `static` rather than
`heuristic`: a path matching a route in the very repository the call was written
in is one reading of one directory, not a guess between services.

`deleteThing` is here for the other half of the same claim. `DELETE
/api/things/:param` is answered by nothing, and the report still says so, with
the verbs that path *does* answer named beside it — so the fix for the join did
not turn the tool into something that always finds a route.
