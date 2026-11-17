# alias-reads-keyed-fields-dotted-workspaces fixture

Fields read through what stands for their class and written by a key, a
domain a Terraform workspace with a dot in its name maps, and a bus grant
under a statement id the files do not read. What P328 reads:

1. **A static field read through an alias.** `Registry` in
   `jobs/src/registry.ts` opens `mail` and `billing`. `signup.ts` holds the
   class as `const queues: any = Registry` and adds through
   `queues.mail.add`, reads `Registry[BILLING]` where
   `const BILLING = 'billing'`, and hands the class to
   `remind(target: any)`, which adds through `target.mail`: three producers,
   on `mail`, `billing` and `mail`.
2. **An instance field written by a key.** In `jobs/src/layers.ts`,
   `Notifier.escalate` writes `this['queue']`, so `notify` adds to one of
   two queues and is not read. `Digests` declares `queue` with no value and
   its constructor writes `this[QUEUE]` where `const QUEUE = 'queue'`, so
   `send` adds to `digests`. `Settings.apply` writes `this[key]` by a key
   that may be any, so `flush` is not read either.
3. **A workspace name with a dot.** Terraform takes any name URL path
   escaping leaves as it is, dots included. `gateway/infra/main.tf` maps the
   orders API onto `"${terraform.workspace}.orders.shop.example.test"`: the
   API is served at `**.orders.shop.example.test`, one label or several
   where the workspace is named, and `web/js/shop.js` calling
   `https://eu.staging.orders.shop.example.test/v1/orders` is joined to the
   route.
4. **A bus's statement id the files do not read.** `stock/cdk.json` turns
   `@aws-cdk/aws-events:requireEventBusPolicySid` on and the lockfile pins
   `aws-cdk-lib` 2.230.0. Both roles ask for their grants on the resources.
   `bus.grantPutEventsTo(mover, process.env.MOVER_SID)` may hand no id, on
   which the bus's policy takes nothing, so the mover's grant is unread
   saying so; `Fn.importValue('stock-counter-sid')` is a value another stack
   exports, an id all the same, so the counter's grant is read on the bus's
   own policy.
