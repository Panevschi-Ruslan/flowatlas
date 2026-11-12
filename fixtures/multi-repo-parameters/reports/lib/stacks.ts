import * as path from 'path';
import { Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

/** What the reports keep: a queue of jobs and a bus, shared with the worker stack. */
export class StorageStack extends Stack {
  readonly jobs: sqs.Queue;
  readonly bus: events.EventBus;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.jobs = new sqs.Queue(this, 'Jobs', { queueName: 'reports-jobs' });
    this.bus = new events.EventBus(this, 'Bus', { eventBusName: 'reports' });
    // Exported by name, and written to a parameter of the account.
    this.exportValue(this.jobs.queueArn, { name: 'reports-jobs-arn' });
    new ssm.StringParameter(this, 'BusName', { parameterName: '/shop/reports/bus-name', stringValue: this.bus.eventBusName });
  }
}

export interface WorkerProps extends StackProps {
  readonly jobs: sqs.Queue;
}

/** The worker: reads its own stack's queue, the platform's queue and the orders service's table. */
export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id, props);
    const handler = (id: string, file: string, environment: Record<string, string> = {}): NodejsFunction =>
      new NodejsFunction(this, id, {
        functionName: `reports-${file}`,
        entry: path.join(__dirname, '..', 'src', `${file}.ts`),
        runtime: lambda.Runtime.NODEJS_20_X,
        environment,
      });

    // The storage stack's queue, handed over as a construct and looked up by its export.
    const again = sqs.Queue.fromQueueArn(this, 'JobsAgain', Fn.importValue('reports-jobs-arn'));
    const build = handler('Build', 'build', {
      JOBS_QUEUE_URL: again.queueUrl,
      BUS_NAME: ssm.StringParameter.valueForStringParameter(this, '/shop/reports/bus-name'),
    });
    build.addEventSource(new SqsEventSource(props.jobs));

    // The platform's queue, by the parameter holding its ARN.
    const placed = sqs.Queue.fromQueueArn(this, 'Placed', ssm.StringParameter.valueForStringParameter(this, '/shop/orders/placed-arn'));
    const tally = handler('Tally', 'tally');
    tally.addEventSource(new SqsEventSource(placed));

    // The orders table's changes, by the parameter holding its stream.
    new lambda.EventSourceMapping(this, 'OrderChanges', {
      target: tally,
      eventSourceArn: ssm.StringParameter.valueForStringParameter(this, '/shop/orders/stream-arn'),
      startingPosition: lambda.StartingPosition.LATEST,
    });
  }
}
