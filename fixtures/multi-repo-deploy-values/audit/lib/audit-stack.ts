import * as path from 'path';
import { Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

/**
 * The audit of a shop: it reads the platform's audit queue and hands jobs to
 * the platform's jobs queue, both named by the prefix and the stage the
 * platform writes to parameters of the account.
 */
export class AuditStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const prefix = ssm.StringParameter.valueForStringParameter(this, '/shop/prefix');
    const stage = ssm.StringParameter.valueForStringParameter(this, '/shop/stage');

    // The queue's ARN: the region and the account known once deployed, its name built of both parameters.
    const audit = sqs.Queue.fromQueueArn(this, 'Audit', `arn:aws:sqs:${this.region}:${this.account}:${prefix}-${stage}-audit`);

    const index = new NodejsFunction(this, 'Index', {
      functionName: 'shop-audit-index',
      entry: path.join(__dirname, '..', 'src', 'index-audit.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: {
        JOBS_QUEUE_URL: Fn.sub('https://sqs.${AWS::Region}.amazonaws.com/${AWS::AccountId}/${Prefix}-${Stage}-jobs', { Prefix: prefix, Stage: stage }),
        ALERTS_TOPIC_ARN: Fn.join(':', ['arn:aws:sns', this.region, this.account, prefix + '-' + stage + '-alerts']),
      },
    });
    index.addEventSource(new SqsEventSource(audit));
  }
}
