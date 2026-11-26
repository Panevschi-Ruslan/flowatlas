import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * A restock queue whose name is a context value no file sets: given with
 * `cdk synth -c restockQueue=...`, or left out and generated. The function
 * that sends to it is granted to.
 */
export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const restock = new sqs.Queue(this, 'Restock', { queueName: this.node.tryGetContext('restockQueue') });

    const move = new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    restock.grantSendMessages(move);
  }
}
