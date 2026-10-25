# nest-check-through-helper fixture

A check thrown through a helper (P90): a community library's lending desk
(NestJS + TypeORM) with no guard anywhere. Each desk handler asks
`LibrarianAuth.verify(badge)` itself and turns a refusal into an exception
through a helper: `toHttpError` picks the class from a table
(`missing → UnauthorizedException`, `denied → ForbiddenException`,
`locked → LockedAccountError`, a 423 `HttpException`). Nothing is read as
public but what says so in words.

The hand-checked list, which the snapshot must match:

| Route | Expected |
|---|---|
| `POST /desk/renewals` | `if (!check.ok) throw toHttpError(check)`: fails with `toHttpError`, chosen from 401, 403, 423; `route-checked-in-body` at `info`, naming the helper and the statuses |
| `DELETE /desk/holds/:id` | `const error = toHttpError(check); throw error;`: the same |
| `GET /desk/overdue` | `throw this.reject(...)`, a helper that hands back what it is given, under `if (!(await this.librarianAuth.verify(badge)).ok)`: `family: auth`, no statuses; `route-checked-in-body` |
| `GET /desk/stats` | `throw toNotFound(period)`, a table of 404 and 410: listed as a failure, no check; `route-unguarded` |
| `GET /opening-hours`, `GET /opening-hours/today` | `/** @flowatlas-public opening hours are shown to anyone */` on the controller: `route-public-declared` at `info`, with the reason; no `route-unguarded` |
| `GET /catalogue/items` | a `GET` under a catalogue path, no guard, no marker: `route-unguarded` |
| `GET /catalogue/new-arrivals` | `/** @flowatlas-public */` with no reason: taken as public, `marker-reason-missing` at `info` |
