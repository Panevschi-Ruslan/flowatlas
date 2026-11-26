# serverless-compose

One repository, `jobs`, of three Serverless Framework services; a
`serverless-compose.yml` deploys two of them together (P249).

Type-checked, never executed or deployed.

| Service | In the compose file | What it declares |
|---|---|---|
| `shared` (`jobs-shared`) | yes | the REST API (`GET /health`), the queue `jobs-queue` and the worker that reads it; outputs `RestApiId`, `RestApiRootResourceId`, `JobsQueueUrl` |
| `api` (`jobs-api`) | yes, with `params: { restApiId: ${shared.RestApiId}, restApiRootResourceId: ..., jobsQueueUrl: ${shared.JobsQueueUrl} }` | `POST /jobs`, on the shared API through `provider.apiGateway.restApiId: ${param:restApiId}`, publishing to the queue through `JOBS_QUEUE_URL: ${param:jobsQueueUrl}` |
| `ghost` | yes | nothing: its folder is not there |
| `tools` (`jobs-tools`) | no, read on its own | an hourly sweep publishing to the queue through `${cf:jobs-shared-dev.JobsQueueUrl}` |

A compose param `${shared.JobsQueueUrl}` is the output `JobsQueueUrl` of the
stack `shared` deploys as, `jobs-shared-dev`: an import of
`stack:jobs-shared-dev#JobsQueueUrl`, which `shared`'s own output answers, so
`api`'s publish and `tools`' land on `sqs/jobs-queue`, where `shared`'s worker
reads. `POST /jobs` hangs from the shared API's root and has its full path
(`expected.cli/flow.post-jobs.tree.txt`).

| Row | Where | Why |
|---|---|---|
| `compose-service-unread` | `jobs/serverless-compose.yml:15` | `ghost`'s folder is not there |
