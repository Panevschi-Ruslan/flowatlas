import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/** Stock moves, each sent to a queue its function finds when it runs and is allowed only where it is granted. */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const handler = (id: string, file: string): NodejsFunction =>
      new NodejsFunction(this, id, {
        functionName: `stock-${file}`,
        entry: path.join(__dirname, '..', 'src', `${file}.ts`),
        runtime: lambda.Runtime.NODEJS_20_X,
      });

    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });

    const move = handler('Move', 'move');
    restock.grantSendMessages(move);
    move.addToRolePolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn] }));

    const count = handler('Count', 'count');
    count.addEventSource(new SqsEventSource(restock));
    count.addEventSource(new SqsEventSource(writeOff));
  }
}
