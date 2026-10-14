# lambda-terraform-shared-paths

Two repositories: `branch` declares two HTTP APIs that both answer `GET /status`
and two application load balancers that both forward `GET /health`, each to a
function of its own; `kiosk` calls them (P59).

Type-checked, never executed or deployed.

| Served by | Route | Function | Entry key |
|---|---|---|---|
| `library-loans-api`, HTTP | `GET /status` | `library-branch-loans-status` | `GET:/status@api:library-loans-api` |
| `library-events-api`, HTTP | `GET /status` | `library-branch-events-status` | `GET:/status@api:library-events-api` |
| `library-staff-lb`, ALB rule | `GET /health` | `library-branch-staff-health` | `GET:/health@api:library-staff-lb` |
| `library-public-lb`, ALB rule | `GET /health` | `library-branch-public-health` | `GET:/health@api:library-public-lb` |

Each method and path is served by more than one API of the deployment, so each
route is kept apart by its API's name. A route no other API serves keeps its
plain key, so a deployment with one API reads exactly as before.

`kiosk`'s status board reads four settings, which `branch` declares under
`baseUrlEnv`; which API each request means is decided by the setting's name,
as a guess, joined `heuristic` with a `route-api-guessed` row:

- `LOANS_API_URL` + `/status` joins `library-loans-api`;
- `EVENTS_API_URL` + `/status` joins `library-events-api`;
- `STAFF_LB_URL` + `/health` joins `library-staff-lb`;
- `BRANCH_URL` + `/status` names neither API, so nothing is joined and an
  `ambiguous-route-api` row names both.
