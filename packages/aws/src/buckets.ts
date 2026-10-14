import type { ChannelKind } from '@flowatlas/core';

/**
 * What writing to a bucket fires, and which notifications of it take it (P52).
 *
 * A bucket is a channel with no message of its own: what a writer hands it is
 * an object, and what a notification hands its target is the service's notice
 * that an object was created or removed, under a key. Both ends are spelled
 * here, so that the SDK's writers and a deployment's notifications meet: the
 * event an operation fires, as the service names it, which a notification's
 * `events` take or not, and the key it writes, which its filters take or not.
 */

/** The adapter and the kind of channel a bucket is read as, whoever reads it. */
export const BUCKET_CHANNEL: { readonly adapter: string; readonly channelKind: ChannelKind } = {
  adapter: 'aws-s3',
  channelKind: 'topic',
};

/** The fields of a write's input that name the bucket and the object. */
export const BUCKET_FIELDS = { bucket: 'Bucket', key: 'Key' } as const;

/** One operation that writes to a bucket, and the event it fires there. */
export interface BucketWrite {
  /** The method a client calls it as. */
  readonly method: string;
  /** The command class version 3 sends it as; absent for version 2's own. */
  readonly command?: string;
  readonly event: string;
  /** Where the input names the object, when not at `Key`. */
  readonly key?: readonly string[];
}

/**
 * The operations that write to a bucket, and the event each fires.
 *
 * Version 2's `upload` ends in a single put or in a multipart upload, by the
 * size of what it writes, which is not written: it fires one of the two, and
 * `*` says so. `@aws-sdk/lib-storage`'s `Upload` is the same.
 */
export const S3_WRITES: readonly BucketWrite[] = [
  { method: 'putObject', command: 'PutObjectCommand', event: 's3:ObjectCreated:Put' },
  { method: 'copyObject', command: 'CopyObjectCommand', event: 's3:ObjectCreated:Copy' },
  { method: 'completeMultipartUpload', command: 'CompleteMultipartUploadCommand', event: 's3:ObjectCreated:CompleteMultipartUpload' },
  { method: 'deleteObject', command: 'DeleteObjectCommand', event: 's3:ObjectRemoved:Delete' },
  { method: 'deleteObjects', command: 'DeleteObjectsCommand', event: 's3:ObjectRemoved:Delete', key: ['Delete', 'Objects', '*', 'Key'] },
  { method: 'upload', event: 's3:ObjectCreated:*' },
];

/** `@aws-sdk/lib-storage`'s upload: made with where it writes, and run by `done()`. */
export const S3_UPLOAD = { package: '@aws-sdk/lib-storage', class: 'Upload', method: 'done', input: ['params'], event: 's3:ObjectCreated:*' } as const;

/**
 * The function that signs a URL for a browser to write with, and the command it
 * signs a write by. The browser writes, not the code that signs.
 */
export const PRESIGNER = {
  package: '@aws-sdk/s3-request-presigner',
  function: 'getSignedUrl',
  command: 'PutObjectCommand',
  event: 's3:ObjectCreated:Put',
  guessed: 'presigned',
} as const;

/** The source a bucket that sends its events to EventBridge puts them on the default bus under. */
export const S3_EVENT_SOURCE = 'aws.s3';

/** The detail type each family of events that a write fires is put on the bus under. */
export const S3_DETAIL_TYPES: Readonly<Record<string, string>> = {
  's3:ObjectCreated:*': 'Object Created',
  's3:ObjectRemoved:*': 'Object Deleted',
};
