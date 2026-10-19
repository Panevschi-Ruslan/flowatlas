# lambda-terraform-bucket-module

Bucket notifications declared through the `s3-bucket` module's `notification`
submodule and in Terraform's JSON form, a bucket that keeps versions, and the
writes P52 named but no fixture made (P56). `scans` keeps a lending library's
scanned pages.

Type-checked, never executed or deployed.

| Write | Bucket (`s3/...`) | Recorded as | Taken by |
|---|---|---|---|
| `CompleteMultipartUploadCommand` in `store-page.ts` | `library-page-scans` | `s3:ObjectCreated:CompleteMultipartUpload`, `pages/*.tiff` | the module's `index-page`, `static` |
| version 2's `s3.upload` in `import-batch.ts` | the same | any of `s3:ObjectCreated:*`, `imports/*.tiff` | the module's `catalogue-import` onto `sqs/library-scan-imports`, `heuristic`: it takes `CompleteMultipartUpload` alone |
| `DeleteObjectCommand` naming no version in `withdraw-page.ts` | the same, versioned | `s3:ObjectRemoved:Delete` | the module's `withdrawn` (`s3:ObjectRemoved:DeleteMarkerCreated`) onto `sns/library-scan-withdrawn`, `static` |
| the second `DeleteObjectCommand` naming no version in `withdraw-page.ts` | `library-page-archive`, the `s3-bucket` module's, versioned by its `versioning = { enabled = true }` input (P60) | `s3:ObjectRemoved:Delete` | `note-withdrawal` (`s3:ObjectRemoved:DeleteMarkerCreated`), `static` |
| `DeleteObjectsCommand` in `withdraw-page.ts` | `library-page-thumbs` | `s3:ObjectRemoved:Delete`, both keys | `forget-thumbs`, declared in `thumbs.tf.json`, `static` |
| `DeleteObjectCommand` with a `VersionId` in `purge-version.ts` | `library-page-scans` | `s3:ObjectRemoved:Delete`, `VersionId` written and not read | nothing: a delete naming a version leaves no marker, `s3-write-matches-nothing` (info) |

`aws_s3_bucket_versioning` with `status = "Enabled"` marks each notification of
the pages bucket as of a versioned bucket, and the linker takes a delete that
writes no `VersionId` as the delete marker it leaves.

`flow invoke:library-scans-withdraw-page` walks through both buckets into
`note-withdrawal` and `forget-thumbs`; `flow invoke:library-scans-import-batch`
into the queue and `catalogue-import`.

`doctor` has one `info` row: the purge of a version, which nothing is notified of.
