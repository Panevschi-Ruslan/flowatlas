import type { SQSEvent } from 'aws-lambda';
import { relayBatch } from 'notice-relay';

/** Hands the batch to a package that sends each notice and builds the answer: what it answers is not in this repository. */
export const handler = async (event: SQSEvent) => relayBatch(event.Records);
