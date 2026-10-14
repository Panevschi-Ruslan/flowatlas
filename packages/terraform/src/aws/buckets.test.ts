import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig, type Deployment } from '@flowatlas/core';
import { terraformReader } from '../index.js';

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures');

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const readHcl = (text: string): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-buckets-'));
  scratch.push(dir);
  writeFileSync(join(dir, 'main.tf'), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

const BUCKET = `
resource "aws_s3_bucket" "covers" { bucket = "library-covers" }
resource "aws_lambda_function" "thumbnail" {
  function_name = "library-thumbnail"
  handler       = "thumbnail.handler"
  runtime       = "nodejs20.x"
  role          = "arn:aws:iam::111122223333:role/x"
}
resource "aws_sqs_queue" "index" { name = "library-index" }
resource "aws_sns_topic" "removed" { name = "library-removed" }
`;

describe('bucket notifications (P52)', () => {
  it('reads each target block as a delivery from the bucket, with its events and key filters', () => {
    const deployment = readHcl(`${BUCKET}
resource "aws_s3_bucket_notification" "covers" {
  bucket = aws_s3_bucket.covers.id
  lambda_function {
    id                  = "thumbnail"
    lambda_function_arn = aws_lambda_function.thumbnail.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "incoming/"
    filter_suffix       = ".png"
  }
  queue {
    queue_arn     = aws_sqs_queue.index.arn
    events        = ["s3:ObjectCreated:Put", "s3:ObjectCreated:Copy"]
    filter_prefix = "thumbnails/"
  }
  topic {
    topic_arn = "arn:aws:sns:eu-west-1:111122223333:library-removed"
    events    = ["s3:ObjectRemoved:*"]
  }
}`);
    expect(deployment.deliveries.map(({ address, by, name, from, to }) => ({ address, by, name, from, to }))).toEqual([
      {
        address: 'aws_s3_bucket_notification.covers.lambda_function[0]',
        by: 'notification',
        name: 'thumbnail',
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:*'], prefix: 'incoming/', suffix: '.png' },
        to: { kind: 'function', function: 0 },
      },
      {
        address: 'aws_s3_bucket_notification.covers.queue[0]',
        by: 'notification',
        name: undefined,
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:Put', 's3:ObjectCreated:Copy'], prefix: 'thumbnails/' },
        to: { kind: 'queue', name: 'library-index' },
      },
      {
        address: 'aws_s3_bucket_notification.covers.topic[0]',
        by: 'notification',
        name: undefined,
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectRemoved:*'] },
        to: { kind: 'topic', name: 'library-removed' },
      },
    ]);
    expect(deployment.rows.filter((row) => row.reason === 'bucket-notification-unread')).toEqual([]);
  });

  it('puts the events of a bucket that sends to EventBridge on the default bus, as aws.s3', () => {
    const deployment = readHcl(`${BUCKET}
resource "aws_s3_bucket_notification" "covers" {
  bucket      = "library-covers"
  eventbridge = true
}`);
    expect(deployment.deliveries.map(({ from, to }) => ({ from, to }))).toEqual([
      {
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:*'] },
        to: { kind: 'bus', name: 'default', fields: { source: 'aws.s3', 'detail-type': 'Object Created' } },
      },
      {
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectRemoved:*'] },
        to: { kind: 'bus', name: 'default', fields: { source: 'aws.s3', 'detail-type': 'Object Deleted' } },
      },
    ]);
  });

  it('says what it could not read: a bucket, and a dynamic block over what the files do not settle', () => {
    const deployment = readHcl(`${BUCKET}
variable "targets" {}
variable "bucket" {}
resource "aws_s3_bucket_notification" "unknown" {
  bucket = var.bucket
}
resource "aws_s3_bucket_notification" "dynamic" {
  bucket = aws_s3_bucket.covers.id
  dynamic "queue" {
    for_each = var.targets
    content {
      queue_arn = queue.value
      events    = ["s3:ObjectCreated:*"]
    }
  }
}`);
    expect(deployment.deliveries).toEqual([]);
    const rows = deployment.rows.filter((row) => row.reason === 'bucket-notification-unread');
    expect(rows.map((row) => row.symbol)).toEqual(['aws_s3_bucket_notification.unknown', 'aws_s3_bucket_notification.dynamic']);
  });
});

describe('fixtures/lambda-terraform-bucket-notification', () => {
  it('reads both notifications, and names the bucket a function is deployed with', () => {
    const path = join(FIXTURES, 'lambda-terraform-bucket-notification');
    const deployment = terraformReader.read({
      repoDir: join(path, 'media'),
      config: parseConfig(JSON.parse(readFileSync(join(path, 'flowatlas.config.json'), 'utf8'))),
    });
    expect(deployment.deliveries.filter((delivery) => delivery.by === 'notification').map((delivery) => delivery.address)).toEqual([
      'aws_s3_bucket_notification.uploads.lambda_function[0]',
      'aws_s3_bucket_notification.uploads.queue[0]',
      'aws_s3_bucket_notification.archive.eventbridge["Object Created"]',
      'aws_s3_bucket_notification.archive.eventbridge["Object Deleted"]',
    ]);
    const upload = deployment.functions.find((fn) => fn.name === 'library-upload-cover');
    expect(upload?.environment?.['UPLOADS_BUCKET']?.names).toEqual({ kind: 'bucket', name: 'library-cover-uploads' });
  });
});

const readFiles = (files: Readonly<Record<string, string>>): Deployment => {
  const dir = mkdtempSync(join(tmpdir(), 'flowatlas-buckets-'));
  scratch.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return terraformReader.read({ repoDir: dir, config: parseConfig({}) });
};

describe('bucket notifications in other forms (P56)', () => {
  it('reads the JSON form, where each target is a list of objects', () => {
    const deployment = readFiles({
      'main.tf': BUCKET,
      'notification.tf.json': JSON.stringify({
        resource: {
          aws_s3_bucket_notification: {
            covers: {
              bucket: '${aws_s3_bucket.covers.id}',
              lambda_function: [{ id: 'thumbnail', lambda_function_arn: '${aws_lambda_function.thumbnail.arn}', events: ['s3:ObjectCreated:*'], filter_suffix: '.png' }],
              queue: [{ queue_arn: '${aws_sqs_queue.index.arn}', events: ['s3:ObjectRemoved:*'] }],
            },
          },
        },
      }),
    });
    expect(deployment.deliveries.map(({ address, name, from, to }) => ({ address, name, from, to }))).toEqual([
      {
        address: 'aws_s3_bucket_notification.covers.lambda_function[0]',
        name: 'thumbnail',
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:*'], suffix: '.png' },
        to: { kind: 'function', function: 0 },
      },
      {
        address: 'aws_s3_bucket_notification.covers.queue[0]',
        name: undefined,
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectRemoved:*'] },
        to: { kind: 'queue', name: 'library-index' },
      },
    ]);
  });

  it("reads the s3-bucket module's notification submodule into the same deliveries", () => {
    const deployment = readHcl(`${BUCKET}
module "covers_notification" {
  source  = "terraform-aws-modules/s3-bucket/aws//modules/notification"
  version = "~> 4.0"

  bucket      = aws_s3_bucket.covers.id
  eventbridge = true

  lambda_notifications = {
    thumbnail = {
      function_arn  = aws_lambda_function.thumbnail.arn
      function_name = aws_lambda_function.thumbnail.function_name
      events        = ["s3:ObjectCreated:*"]
      filter_prefix = "incoming/"
    }
  }
  sqs_notifications = {
    index = {
      queue_arn = aws_sqs_queue.index.arn
      events    = ["s3:ObjectCreated:Put"]
    }
  }
  sns_notifications = {
    removed = {
      topic_arn = aws_sns_topic.removed.arn
      events    = ["s3:ObjectRemoved:*"]
    }
  }
}`);
    expect(deployment.deliveries.map(({ name, from, to }) => ({ name, from, to }))).toEqual([
      {
        name: 'thumbnail',
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:*'], prefix: 'incoming/' },
        to: { kind: 'function', function: 0 },
      },
      { name: 'index', from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:Put'] }, to: { kind: 'queue', name: 'library-index' } },
      { name: 'removed', from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectRemoved:*'] }, to: { kind: 'topic', name: 'library-removed' } },
      {
        name: undefined,
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectCreated:*'] },
        to: { kind: 'bus', name: 'default', fields: { source: 'aws.s3', 'detail-type': 'Object Created' } },
      },
      {
        name: undefined,
        from: { kind: 'bucket', name: 'library-covers', events: ['s3:ObjectRemoved:*'] },
        to: { kind: 'bus', name: 'default', fields: { source: 'aws.s3', 'detail-type': 'Object Deleted' } },
      },
    ]);
  });

  it('says a bucket keeps versions, by its versioning resource or its older block', () => {
    const deployment = readHcl(`${BUCKET}
resource "aws_s3_bucket_versioning" "covers" {
  bucket = aws_s3_bucket.covers.id
  versioning_configuration {
    status = "Enabled"
  }
}
resource "aws_s3_bucket" "old" {
  bucket = "library-old"
  versioning {
    enabled = true
  }
}
resource "aws_s3_bucket" "plain" { bucket = "library-plain" }
resource "aws_s3_bucket_notification" "covers" {
  bucket = aws_s3_bucket.covers.id
  topic {
    topic_arn = aws_sns_topic.removed.arn
    events    = ["s3:ObjectRemoved:DeleteMarkerCreated"]
  }
}
resource "aws_s3_bucket_notification" "old" {
  bucket = aws_s3_bucket.old.id
  topic {
    topic_arn = aws_sns_topic.removed.arn
    events    = ["s3:ObjectRemoved:*"]
  }
}
resource "aws_s3_bucket_notification" "plain" {
  bucket = aws_s3_bucket.plain.id
  topic {
    topic_arn = aws_sns_topic.removed.arn
    events    = ["s3:ObjectRemoved:*"]
  }
}`);
    expect(deployment.deliveries.map(({ from }) => [from.kind === 'bucket' ? from.name : '', from.kind === 'bucket' ? from.versioned : undefined])).toEqual([
      ['library-covers', true],
      ['library-old', true],
      ['library-plain', undefined],
    ]);
  });
});
