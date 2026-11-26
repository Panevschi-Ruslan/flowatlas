import * as path from 'path';
import { SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * Stock moves under a role the account keeps, and shipments under a user
 * whose access key a secret holds: each sent to a queue its function finds
 * when it runs, allowed where the app - or the account - grants it.
 */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const restock = new sqs.Queue(this, 'Restock', { queueName: 'stock-restock' });
    const writeOff = new sqs.Queue(this, 'WriteOff', { queueName: 'stock-write-off' });
    const shipments = new sqs.Queue(this, 'Shipments', { queueName: 'stock-shipments' });

    // A role the account keeps: what it attaches is not here; what the app attaches is.
    const mover = iam.Role.fromRoleArn(this, 'MoverRole', 'arn:aws:iam::111122223333:role/stock-mover');
    mover.addToPrincipalPolicy(new iam.PolicyStatement({ actions: ['sqs:SendMessage'], resources: [writeOff.queueArn] }));
    restock.grantSendMessages(mover);

    new NodejsFunction(this, 'Move', {
      functionName: 'stock-move',
      entry: path.join(__dirname, '..', 'src', 'move.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      role: mover,
    });

    // A user whose access key's id a secret holds, wrapped as a secret value.
    const shipper = new iam.User(this, 'Shipper');
    const key = new iam.AccessKey(this, 'ShipperKey', { user: shipper });
    const credentials = new secretsmanager.Secret(this, 'ShipperCredentials', {
      secretObjectValue: { id: SecretValue.unsafePlainText(key.accessKeyId), secret: key.secretAccessKey },
    });
    shipments.grantSendMessages(shipper);

    new NodejsFunction(this, 'Ship', {
      functionName: 'stock-ship',
      entry: path.join(__dirname, '..', 'src', 'ship.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: { CREDENTIALS: credentials.secretArn },
    });

    const count = new NodejsFunction(this, 'Count', {
      functionName: 'stock-count',
      entry: path.join(__dirname, '..', 'src', 'count.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    count.addEventSource(new SqsEventSource(restock));
    count.addEventSource(new SqsEventSource(writeOff));
    count.addEventSource(new SqsEventSource(shipments));
  }
}
