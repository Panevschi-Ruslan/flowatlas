import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as kinesis from 'aws-cdk-lib/aws-kinesis';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { KinesisEventSource, SnsDlq, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * The audit of a shop: two readers of the platform's clicks stream, each
 * handing what it gives up on to a destination of the platform's.
 */
export class AuditStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const clicksArn = ssm.StringParameter.valueForStringParameter(this, '/shop/clicks');
    const failedArn = ssm.StringParameter.valueForStringParameter(this, '/shop/failed');

    // Looked up as a stream and a queue: the class says what each is.
    const clicks = kinesis.Stream.fromStreamArn(this, 'Clicks', clicksArn);
    const failed = sqs.Queue.fromQueueArn(this, 'Failed', failedArn);
    const alerts = sns.Topic.fromTopicArn(this, 'Alerts', 'arn:aws:sns:eu-west-1:111122223333:shop-prod-alerts');

    const index = new NodejsFunction(this, 'Index', {
      functionName: 'shop-audit-index',
      entry: path.join(__dirname, '..', 'src', 'index-audit.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    index.addEventSource(new KinesisEventSource(clicks, { startingPosition: lambda.StartingPosition.LATEST, onFailure: new SqsDlq(failed) }));

    // A mapping of the parameter itself, which says nothing of what it is: a stream or a table's changes.
    const sample = new NodejsFunction(this, 'Sample', {
      functionName: 'shop-audit-sample',
      entry: path.join(__dirname, '..', 'src', 'sample-audit.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    new lambda.EventSourceMapping(this, 'Sampled', { target: sample, eventSourceArn: clicksArn, startingPosition: lambda.StartingPosition.TRIM_HORIZON, onFailure: new SnsDlq(alerts) });
  }
}
