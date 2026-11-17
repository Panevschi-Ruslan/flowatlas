import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/**
 * Stock moves under roles another account keeps. The mover is imported as
 * it is - its account not the stack's, so the CDK takes it as one it cannot
 * change: the ledger's and the moves stream's grants go onto their own
 * policies, the bus's is dropped. The auditor asks for its grants on the
 * resources, so the bus's goes onto the bus's policy under its statement id.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ledger = new dynamodb.Table(this, 'Ledger', {
      tableName: 'stock-ledger',
      partitionKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });
    const moves = new kinesis.Stream(this, 'Moves', { streamName: 'stock-moves' });
    const bus = new events.EventBus(this, 'Bus', { eventBusName: 'stock-events' });

    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover');
    ledger.grantWriteData(mover);
    moves.grantWrite(mover);
    bus.grantPutEventsTo(mover, 'StockMover');

    const auditor = iam.Role.fromRoleArn(this, 'AuditorRole', 'arn:aws:iam::111122223333:role/stock-auditor', {
      mutable: false,
      addGrantsToResources: true,
    });
    bus.grantPutEventsTo(auditor, 'StockAuditor');

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
    });

    new NodejsFunction(this, 'Audit', {
      functionName: 'stock-audit',
      entry: path.join(__dirname, '..', 'src', 'audit.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: auditor,
    });
  }
}
