# react-client-base

One repository, one segment, and two ends that have to agree about it.

The server mounts its router at `/api`, so the route written as
`POST /documents.info` is served at `POST /api/documents.info`. The browser
writes every request through a client of its own whose base is `/api`, so the
call site writes `/documents.info` and nothing else. Neither half is wrong and
neither half can be read without the other.

That is the fixture. Two fixes that were each correct alone cancelled here: one
branch taught the route reader to read the mount prefix, and another taught the
request reader to recognise a client a project wrote itself. Alone, each improved
a real measurement. Together, the route gained `/api` and the request did not,
and twenty-six joins on the measured repository went to seven — the seven that
survived being the ones whose *route* was also still missing the segment, which
is the same accident wearing the other hat (R114).

So the base is read where it is written — once, on the class — and folded into
the address the graph records. Not forgiven in the linker: `impact`, `dead` and
`contracts` all read the recorded address, and an address missing a segment is
wrong in the graph whether or not the join happens to survive it. The linker is
left with one question and one string to answer it with.

`reportOpened` is the other half of the claim. It names a host outright, so it
was never relative to anything the client holds, and `/api` in front of it would
be an address nobody writes. Its address stays `/events` under
`telemetry.example.com`, it draws the edge to the external service, and no route
here answers it — which the report says, as it says of any address nothing
serves.

The verbs are read exactly as `react-local-client` proves them; what is new here
is only that the class carries a base, and that the base is set the way this
shape is nearly always written — in the constructor, with a default beside it,
where a caller who passes nothing gets `/api`.

## A base the call overrides (R128)

The base is written on the class, and a call may write it again. `registerPasskey`
spells `{ baseUrl: '/auth' }` beside its body, and the route it means is mounted
at `/auth` by `app.ts` — so the call's own word is the true one, and the address
recorded is `POST /auth/passkeys.generateRegistrationOptions`, which joins. Under
the client's default it was `POST /api/passkeys.generateRegistrationOptions`, an
address nothing in this repository serves and nothing said so. That is outline's
last three unjoined browser requests exactly: the route side had already been
placed at `/auth/…` and the two halves disagreed by precisely the base the call
overrides.

`verifyPasskey` writes the same option with a value nothing static settles. The
address keeps what was read — `POST /passkeys.verify`, the path alone — because
the one base now known to be wrong is the client's default: the call said it was
not that. A row names the line, and a second row says no service serves the
address, which is true and is the honest pair.

The transport takes the base as an argument now, so the address inside it is
assembled from two things that are both unreadable there. That is why the
dynamic-address row is written against `get` and `post` rather than against the
`fetch` call: the reader forwards a request whose address is a parameter out to
the members that pass it. Nothing about it is new behaviour; it is the same
forwarding this fixture always exercised, one hop further out.
