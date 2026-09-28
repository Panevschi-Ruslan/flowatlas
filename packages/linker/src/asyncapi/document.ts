/**
 * The part of an AsyncAPI document this tool has any use for, as a schema.
 *
 * A description rather than a parser, and much smaller than the specification:
 * the tool models channels, which end of a channel the service is, and the
 * shape of what travels on it. Servers, bindings, security schemes, traits,
 * correlation ids, examples and reply channels are passed over rather than
 * half-understood, because a fact this graph cannot hold is a fact nothing
 * downstream could have asked about anyway.
 *
 * Unknown keys are kept rather than refused, for the same reason the OpenAPI
 * description keeps them: a document is somebody else's file, often generated,
 * and failing on a keyword this release has not heard of would make the reader
 * brittle in exactly the way a third party's artefact is guaranteed to break it.
 */
import { z } from 'zod';
import { jsonSchemaNodeSchema } from '../document/schema.js';

/**
 * A message, which is where a channel's payload shape is written.
 *
 * `payload` is JSON Schema, which is why nothing here describes shapes: the
 * registry already knows how to be told one, in the one vocabulary the wire has.
 * `oneOf` is the version-2 spelling of several messages on one operation and is
 * read as the choice it is.
 */
export const messageSchema = z.looseObject({
  $ref: z.string().optional(),
  name: z.string().optional(),
  title: z.string().optional(),
  payload: jsonSchemaNodeSchema.optional(),
  oneOf: z
    .array(z.looseObject({ $ref: z.string().optional(), payload: jsonSchemaNodeSchema.optional() }))
    .optional(),
});

export type AsyncapiMessage = z.infer<typeof messageSchema>;

/** A reference to a message, which version 3 uses wherever version 2 inlines one. */
const messageRefSchema = z.looseObject({ $ref: z.string().optional() });

/** An operation as version 3 writes one: beside the channels, pointing in. */
export const operationSchema = z.looseObject({
  action: z.string().optional(),
  channel: z.looseObject({ $ref: z.string().optional() }).optional(),
  messages: z.array(messageRefSchema).optional(),
  summary: z.string().optional(),
});

/** An operation as version 2 writes one: inside the channel, under its verb. */
export const channelOperationSchema = z.looseObject({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  message: messageSchema.optional(),
});

/**
 * A channel, whose name may be its key or may be a field.
 *
 * Version 3 gives a channel a key of its own and writes the address a broker
 * would recognise in `address`; version 2 has only the key. That single
 * difference is the whole of why this reader is not the OpenAPI one with another
 * table in it.
 */
export const channelSchema = z.looseObject({
  address: z.string().optional(),
  title: z.string().optional(),
  messages: z.record(z.string(), messageSchema).optional(),
});

export const asyncapiDocumentSchema = z.looseObject({
  asyncapi: z.string().optional(),
  info: z.looseObject({ title: z.string().optional(), version: z.string().optional() }).optional(),
  channels: z.record(z.string(), z.looseObject({})).default({}),
  /**
   * Present exactly when the document is version 3, which is what makes it the
   * honest way to ask which shape is being read.
   *
   * The alternative is to believe the `asyncapi` version string, and a document
   * that says `3.0.0` and carries version-2 channels is a document this tool
   * would then read as having no operations at all — an end that silently
   * vanishes, which is the one failure mode a declared service must not have.
   */
  operations: z.record(z.string(), z.looseObject({})).optional(),
  components: z
    .looseObject({
      schemas: z.record(z.string(), jsonSchemaNodeSchema).optional(),
      messages: z.record(z.string(), messageSchema).optional(),
    })
    .optional(),
});

export type AsyncapiDocument = z.infer<typeof asyncapiDocumentSchema>;
export type ChannelOperation = z.infer<typeof channelOperationSchema>;
export type Operation = z.infer<typeof operationSchema>;

/** Which end of a channel the declared service is, as an edge type. */
export type ChannelEnd = 'emits' | 'consumes';

/**
 * Every word a document may say an operation's direction with, and what it means.
 *
 * One lookup for both versions, and it is also the list of which keys of a
 * version-2 channel are operations at all: a channel item carries `parameters`,
 * `bindings` and `description` too, and treating one of those as a direction
 * would invent an end nobody declared.
 *
 * The two version-2 words are not synonyms of the version-3 ones — they are the
 * *opposite* way round, and that is not a typo. Version 2 named an operation
 * after what somebody else may do to the channel, so `publish` meant "others
 * publish here, this application receives", and `subscribe` meant "others
 * subscribe, this application sends". Version 3 renamed them to `receive` and
 * `send` for exactly this reason: the confusion was the specification's own, and
 * the official migration maps `publish` to `receive` and `subscribe` to `send`.
 * A reader that took the words at face value would draw every declared channel
 * backwards, and a backwards channel still joins, still compares, and reports
 * the producer's shape as the consumer's.
 */
export const CHANNEL_ENDS: Record<string, ChannelEnd> = {
  send: 'emits',
  receive: 'consumes',
  subscribe: 'emits',
  publish: 'consumes',
};
