import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * Stock moves under a role another account keeps, imported as one the app
 * cannot change: a statement added to it is dropped, and the queue's grant
 * goes onto the queue's own policy, naming the role.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });

    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover', { mutable: false });
    mover.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn] }));
    restock.grantSendMessages(mover);

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
    });

    const count = new NodejsFunction(this, 'Count', {
      functionName: 'stock-count',
      entry: path.join(__dirname, '..', 'src', 'count.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    count.addEventSource(new SqsEventSource(restock));
    count.addEventSource(new SqsEventSource(writeOff));
  }
}
