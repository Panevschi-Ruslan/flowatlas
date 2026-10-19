# lambda-terraform-shared-paths

Two repositories: `branch` declares two HTTP APIs that both answer `GET /status`,
two more whose names are not read that both answer `GET /hours`, and two
application load balancers that both forward `GET /health`, each to a function
of its own, the staff one from two listeners; `kiosk` calls them (P59, P61).

Type-checked, never executed or deployed.

| Served by | Route | Function | Entry key |
|---|---|---|---|
| `library-loans-api`, HTTP | `GET /status` | `library-branch-loans-status` | `GET:/status@api:library-loans-api` |
| `library-events-api`, HTTP | `GET /status` | `library-branch-events-status` | `GET:/status@api:library-events-api` |
| `library-staff-lb`, HTTPS:443 rule | `GET /health` | `library-branch-staff-health` | `GET:/health@api:library-staff-lb@listener:HTTPS:443` |
| `library-staff-lb`, HTTP:80 rule | `GET /health` | `library-branch-staff-plain-health` | `GET:/health@api:library-staff-lb@listener:HTTP:80` |
| `library-public-lb`, HTTPS:443 and HTTP:80 rules | `GET /health` | `library-branch-public-health` | `GET:/health@api:library-public-lb` |
| `aws_apigatewayv2_api.desk_hours`, HTTP, name unread | `GET /hours` | `library-branch-desk-hours` | `GET:/hours@api:aws_apigatewayv2_api.desk_hours` |
| `aws_apigatewayv2_api.lab_hours`, HTTP, name unread | `GET /hours` | `library-branch-lab-hours` | `GET:/hours@api:aws_apigatewayv2_api.lab_hours` |

Each method and path is served by more than one API of the deployment, so each
route is kept apart by its API's name, or by its declaration's address where
the name comes from a variable with no value. The staff load balancer's two
listeners send `GET /health` to two functions, so the listener is in the key
too; the public one's send it to one target group, which is one route. A route
no other API serves keeps its plain key, so a deployment with one API reads
exactly as before.

`kiosk`'s status board reads five settings, which `branch` declares under
`baseUrlEnv`; which API each request means is decided by the setting's name,
as a guess, joined `heuristic` with a `route-api-guessed` row:

- `LOANS_API_URL` + `/status` joins `library-loans-api`;
- `EVENTS_API_URL` + `/status` joins `library-events-api`;
- `STAFF_LB_URL` + `/health` narrows to `library-staff-lb`, whose two
  listeners nothing in the setting tells apart: an `ambiguous-route` row names
  those two;
- `BRANCH_URL` + `/status` names neither API, so nothing is joined and an
  `ambiguous-route-api` row names both.

Its `HoursBoard` builds both addresses at run time and says where they go with
`@CallsService('branch', 'GET /hours')`, which names the service but not which
of its APIs (P61):

- `deskHours` reads `DESK_HOURS_URL`, whose name chooses
  `aws_apigatewayv2_api.desk_hours` (`heuristic`, `route-api-guessed`);
- `anyHours` reads no setting, and `branch` names neither API, so an
  `ambiguous-route-api` row names both.
