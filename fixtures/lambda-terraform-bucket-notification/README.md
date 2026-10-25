# lambda-terraform-bucket-notification

Functions run by what is written to S3 buckets (P52). `media` takes cover
images for a lending library: a route writes a cover to the uploads bucket, or
signs a URL for the browser to write it with; the bucket's notification runs
`make-thumbnail` for every `.png` created under `incoming/`, and hands what is
created under `thumbnails/` to a queue the index reads. The archive bucket sends
its events to EventBridge, where a rule on the default bus takes `Object
Created` from `aws.s3`.

Type-checked, never executed or deployed.

| Write | Bucket (`s3/...`) | Key | Taken by |
|---|---|---|---|
| `PutObjectCommand` in `upload-cover.ts` | `library-cover-uploads`, from `process.env.UPLOADS_BUCKET` | `incoming/*.png` | `make-thumbnail`, `static` |
| `getSignedUrl` of a `PutObjectCommand` in `sign-cover.ts` | the same | `incoming/*.png` | `make-thumbnail`, `heuristic`: `presigned` |
| `Upload` (`@aws-sdk/lib-storage`) in `make-thumbnail.ts` | the same | `thumbnails/*.png` | `index-thumbnail`, onto `sqs/library-thumbnails` |
| `CopyObjectCommand` in `make-thumbnail.ts` | `library-cover-archive`, a constant | `covers/*.png` | the bucket's EventBridge notification, onto `eventbridge/default/aws.s3/Object Created`, then `library-cover-archived` |
| `DeleteObjectCommand` in `make-thumbnail.ts` | `library-cover-uploads` | not read | nothing: `s3-write-matches-nothing` (info) |

Each write is a publisher on the bucket's channel, recorded as the event it
fires (`s3:ObjectCreated:Put`, ...) with the key it writes. Each notification
is a consumer carrying the events and key filters it takes, and the linker asks
of every write which take it: the edge says so in `takenBy`, and a walk through
the bucket from a write goes on to those alone.

`flow 'POST /covers/:param'` walks from the route through the write, the
bucket and the notification into `make-thumbnail`; `flow
invoke:library-make-thumbnail` from there into the queue, the archive and the
rule.

`doctor` has one `info` row: the delete that nothing is notified of.
