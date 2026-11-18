import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/**
 * Stock moves under a role another account keeps, so the CDK takes it as one
 * it cannot change: the ledger's and the moves stream's grants go onto their
 * own policies, as the version the workspace's lockfile pins writes them.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ledger = new dynamodb.Table(this, 'Ledger', {
      tableName: 'stock-ledger',
      partitionKey: { name: 'sku', type: dynamodb.AttributeType.STRING },
    });
    const moves = new kinesis.Stream(this, 'Moves', { streamName: 'stock-moves' });

    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover');
    ledger.grantWriteData(mover);
    moves.grantWrite(mover);

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
    });
  }
}
