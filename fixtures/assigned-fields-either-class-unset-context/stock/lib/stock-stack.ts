import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/**
 * Stock moves under a role another account keeps, asking for its grants on
 * the resources. The bus takes the grant into its own policy only with a
 * statement id, and the one handed is a context value no file sets: given
 * with `cdk synth -c moverSid=...`, or not at all. The stage the function
 * runs in is chosen the same way.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'stock-events' });
    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover', { mutable: false, addGrantsToResources: true });
    bus.grantPutEventsTo(mover, this.node.tryGetContext('moverSid'));

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
      environment: { STAGE: this.node.tryGetContext('stage') },
    });
  }
}
