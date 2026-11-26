# multi-repo-jinja-files fixture

A sceptre project whose Jinja names other files of the repository, read as
sceptre's Jinja reads them (P273): a stack configuration that imports a macro
from a file beside it and includes a part, and a template that extends a base
template and imports a macro that writes the function.

| Service | Deployed by | What it does |
|---|---|---|
| `platform` | Terraform (`platform/infra/main.tf`) | the queues `shop-prod-jobs` and `shop-prod-audit`, each worked through by a function of its own name |
| `orders` | sceptre (`orders/config`, `orders/templates`), launched by `sceptre launch -y prod` in its workflow | `shop-prod-ship` hands a job to `JOBS_QUEUE_URL` and an audit record to `AUDIT_QUEUE_URL` |

How the names are written:

- `orders/config/prod/orders.yaml` begins `{% from 'names.j2' import queue with context %}`:
  `names.j2` beside it defines the macro `queue(name, stage=stack_group_config.stage)`
  over a top-level `{% set separator = '-' %}`, so `JobsName` is `shop-prod-jobs`
  and `sceptre_user_data.queues.audit` is `shop-prod-audit`. Imported with the
  current names, the macro reads `stack_group_config`; without them it could not.
- The same file `{% include 'tags.yaml.j2' %}`, a part beside it that writes
  `stack_tags` from `stack_group_config`.
- `orders/templates/orders.yaml.j2` is `{% extends 'base.yaml.j2' %}`: the base
  writes the template's parameters and role and leaves `{% block resources %}`
  and `{% block description %}` (replaced here, with `super()`) to it. It
  `{% import 'macros/function.j2' as functions %}`, whose macro `function(id,
  name, handler, queues)` writes the function and loops over the queues it is
  handed into its environment.

`orders.yaml.j2` declares nothing of its own (no format version, no
resources): it is a template because a stack names it. `base.yaml.j2` and
`macros/function.j2` are parts another file names, and no stack does: they are
not read as templates of their own.

## Expected

```
shop-prod-ship -> sqs/shop-prod-jobs (JOBS_QUEUE_URL, via the parameter JobsName)
shop-prod-ship -> sqs/shop-prod-audit (AUDIT_QUEUE_URL, from sceptre_user_data)
both queues read by the platform's mappings; no row
```

Measured with the tool at the commit before P273 over the same tree: both
sends were `channel-from-environment` (the configuration's `{% from %}` was a
statement not run, so no stack deployed the template), and `base.yaml.j2` was
read as a template of its own and was `infra-file-unparsed`, its `{% block %}`
not rendered.
