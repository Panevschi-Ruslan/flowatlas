# lambda-workspace-root

A lending library's loans service whose repository is the root of a workspace:
the functions are in its own `src/`, and the client they start workflows
through is a member in `packages/workflows`, inside the same directory (R175).
The service declares the member in its manifest and imports it by name, and
nothing is installed: `node_modules` holds only the stubs of the AWS SDK and
`@types/aws-lambda`.

Synthetic, in the shape of the aws-samples serverless projects. Type-checked,
never executed or deployed.

## What is read

| Directory | Read | Why |
|---|---|---|
| `src/` | yes | the tsconfig's `include` |
| `packages/workflows` | yes | the service declares `@library/workflows` and it is a member of the service's own workspace |
| `packages/catalogue-tools` | no | a member nobody declares |

`flow 'POST /loans'` walks from the route into `WorkflowClient.start`, whose
`StartExecutionCommand` is handed its ARN as a parameter. That is followed out
to `create-loan`, read there as `process.env.LOAN_APPROVAL_ARN`, and completed
from the function's Terraform: `start lending-loan-approval`, `static`, and on
into the state machine and the two functions it invokes.

## Before

A workspace root was read as nothing but itself, and a member inside the
service's directory added no directory because its files were taken to be
under the first one already. They were not: the service's own code is read
from `src/`. The handler's call into `workflows.start` resolved to nothing,
the start was never drawn, and no row said so.
