import * as path from 'path';
import { Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/**
 * Stock moves under roles another account keeps, each asking for its grants
 * on the resources. The bus takes a grant into its own policy only with a
 * statement id: the mover's is whatever the deployment's environment holds,
 * which may be none; the counter's is a value another stack exports.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'stock-events' });
    const asks = { mutable: false, addGrantsToResources: true };

    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover', asks);
    bus.grantPutEventsTo(mover, process.env.MOVER_SID);

    const counter = iam.Role.fromRoleArn(this, 'CounterRole', 'arn:aws:iam::111122223333:role/stock-counter', asks);
    bus.grantPutEventsTo(counter, Fn.importValue('stock-counter-sid'));

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
    });

    new NodejsFunction(this, 'Count', {
      functionName: 'stock-count',
      entry: path.join(__dirname, '..', 'src', 'count.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: counter,
    });
  }
}
