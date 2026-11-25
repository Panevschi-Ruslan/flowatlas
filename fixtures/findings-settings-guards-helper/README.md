# findings-settings-guards-helper fixture

The three bugs the benchmark's planted project hid from `findings` (P401),
each beside a twin that looks like it and is right: a setting renamed where
it is set, the one write left open among guarded ones, and a request made
through a helper that chooses its verb by a branch on what its caller hands
in. Six repositories and one configuration, so `flowatlas build` joins them.

Type-checked, never executed.

## The gateway - `gateway` (Nest) and `orders` (Nest, `ORDERS_URL`)

- `src/clients/forward.ts`: `forward(http, method, url, body)` sends
  `method === 'GET' ? http.get(url) : method === 'DELETE' ? http.delete(url) :
  method === 'PATCH' ? http.patch(url, body) : http.post(url, body)`.
- `NotesClient` calls it with `'GET'` for `/notes`, `'DELETE'` for
  `/notes/:id`, `'POST'` for `/notes/:id/export` and `'POST'` for
  `/notes/:id/archive`, and with its own parameter `verb` for
  `/notes/:id/flag`.
- `orders`' `NotesController` serves `GET /notes`, `DELETE /notes/:id` and
  `POST /notes/:id/export`; nothing serves `archive` or `flag`.

Each request is credited only to the callers that take its branch, so the
export joins `POST /notes/:param/export` and the delete `DELETE
/notes/:param` (before, every caller took the first branch's GET: the export
was a call to a missing route and the delete was joined to `GET`). The
archive is still a missing route, through the helper. The flag's verb is not
known (`api-method-dynamic`), so it joins nothing and is no missing route.

## The claims - `shipping` (Nest)

- `ClaimsController`: `POST /claims` and `POST /claims/:id/notes` have
  `StaffGuard` in front; `DELETE /claims/:id` has nothing (named);
  `GET /claims` has nothing (a read, never named).
- `ClaimRefundsController`: guarded as a whole, its delete included.
- `ParcelsController`: two guarded writes and `POST /parcels/:id/track`
  marked `@Public()` (never named).
- `PickupsController`: guarded as a whole; `DELETE /pickups/:id` switches the
  guard off with `@SkipStaffCheck()` (under `doctor.skipGuardDecorators`),
  which says nothing about being public (named).
- `DepotsController`: two open writes and one guarded (a pattern, not one left
  out: never named).

None of these routes reaches stored data, so `route-unguarded` never listed
them; `route-unguarded-among-guarded` is said on the deviance alone.

## The settings - `ledger`, `reports`, `mailer`

- `ledger` (Express) reads `LEDGER_REGION`, `PAYMENT_PROVIDER` and
  `CACHE_HOST` in `src/settings.ts`'s own statements; its compose file sets
  `PAYMENT_PROVIDER`, `LEDGER_ZONE` and `CACHE_PASSWORD`. `LEDGER_REGION` is
  `config-not-set` with `LEDGER_ZONE` named as the setting likely renamed
  (`nearest`); `CACHE_HOST` is `config-not-set` with no guess (a host and a
  password are two settings), and `CACHE_PASSWORD` is `config-never-read`.
- `reports` (Nest) reads `REPORTS_BUCKET` at module level; its compose file
  loads `./reports.env`, which is not in the checkout: held back with which.
- `mailer` (Express) reads `SMTP_RELAY`; its Dockerfile starts it through
  `doppler run`: held back with which.

| Kind | Listed | Not listed |
|---|---|---|
| `call-to-missing-route` | `POST /notes/:param/archive` | the export (exists, POST), the flag (verb not read) |
| `unguarded-among-guarded` (high) | `DELETE /claims/:param`, `DELETE /pickups/:param` | `GET /claims`, the refunds' delete, `POST /parcels/:param/track`, the depots |
| `config-not-set` (medium) | `LEDGER_REGION` (likely renamed from `LEDGER_ZONE`), `CACHE_HOST` | `PAYMENT_PROVIDER`; `REPORTS_BUCKET` and `SMTP_RELAY` held back |
