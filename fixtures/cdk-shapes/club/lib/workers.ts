import * as path from 'node:path';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/** A queue for one kind of notice, and the worker that reads it. */
export const worker = (scope: Construct, kind: string, stage: string): NodejsFunction => {
  const queue = new sqs.Queue(scope, `${kind}-queue`, { queueName: `club-${stage}-${kind}` });
  const fn = new NodejsFunction(scope, `${kind}-worker`, {
    functionName: `club-${stage}-${kind}-worker`,
    entry: path.join(__dirname, '..', 'src', 'workers', `${kind}.ts`),
  });
  fn.addEventSource(new SqsEventSource(queue, { batchSize: 5 }));
  return fn;
};
