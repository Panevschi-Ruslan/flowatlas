# lambda-terraform-bus-forward

A rule that hands events on to another team's bus (R174). `circulation` puts
`LoanCreated` and `LoanRenewed` on the bus `library`; its rule
`library-to-audit` takes every event whose source starts with `library.` and
targets the bus `library-audit`, which `audit` owns and looks up by name. The
events the rule matches are carried onto that bus, where `audit`'s rules see
them.

Type-checked, never executed or deployed.

| On `library` | Matched by `library-to-audit` | Carried onto | Read there by |
|---|---|---|---|
| `eventbridge/library/library.loans/LoanCreated` (`create-loan.ts`) | `source` by `prefix "library."`: `heuristic`, and the edge says why | `eventbridge/library-audit/library.loans/LoanCreated` | `library-audit-loan-created`, exact, onto `record-entry.ts` |
| `eventbridge/library/library.loans/LoanRenewed` (`renew-loan.ts`) | the same | `eventbridge/library-audit/library.loans/LoanRenewed` | `library-audit-renewals`, `prefix "library."` again, onto `flag-renewal.ts` |

Which events the rule carries on is whatever the project's publishers put, which
only the whole project knows, so the linker draws them: the rule's publisher
emits each matched channel under the other bus's name, at the confidence of the
match, with `forwardedFrom` on the edge. A rule on the other bus that takes its
events by a pattern is matched against those channels in turn.

`flow 'POST /loans/:param/renewals'` walks from the route through `PutEvents`,
the forwarding rule and the audit bus into the audit functions. The rule is one
node with one publisher, as a rule that forwards events it names exactly is, so a
walk through it reaches every channel it carries on, `LoanCreated` included.

`doctor` has nothing to say: no row.
