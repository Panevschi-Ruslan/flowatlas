import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import {
  aws_cognito as cognito,
  aws_events as events,
  aws_events_targets as targets,
  aws_lambda as lambda,
  aws_sqs as sqs,
  aws_ssm as ssm,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from 'aws-cdk-lib';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';
import { Mailbox } from './mailbox';
import { worker } from './workers';

export interface ClubStackProps extends cdk.StackProps {
  readonly stage: string;
}

/** A members' club: mail, workers per kind of notice, renewals and lapses. */
export class ClubStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ClubStackProps) {
    super(scope, id, props);
    const mail = lambda.Code.fromAsset(path.join(__dirname, '..', 'dist', 'mail'));

    // No name of its own: CloudFormation names the queue and both functions.
    const inbox = new sqs.Queue(this, 'Inbox');
    const sender = new lambda.Function(this, 'Sender', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: mail,
      handler: 'send.handler',
      environment: { INBOX_URL: inbox.queueUrl },
    });
    const reader = new lambda.Function(this, 'Reader', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: mail,
      handler: 'read.handler',
      environment: { ACCOUNT: cdk.Aws.ACCOUNT_ID, SHARED_QUEUE_URL: cdk.Fn.importValue('club-shared-queue-url') },
    });
    reader.addEventSource(new SqsEventSource(inbox));

    // The same construct twice, handed different names.
    new Mailbox(this, 'Members', { topicName: `club-${props.stage}-members` });
    new Mailbox(this, 'Staff', { topicName: `club-${props.stage}-staff` });

    // A queue and a worker per kind, over a list the files settle...
    for (const kind of ['welcome', 'renewal']) worker(this, kind, props.stage);

    // ...and a queue per name a parameter in the account holds, which they do not.
    for (const name of ssm.StringParameter.valueFromLookup(this, '/club/extra-queues').split(',')) {
      new sqs.Queue(this, `Extra-${name}`, { queueName: `club-${name}` });
    }

    // Settled by the stage: there is no nightly run in dev.
    if (props.stage === 'prod') {
      new events.Rule(this, 'Nightly', {
        schedule: events.Schedule.rate(cdk.Duration.hours(24)),
        targets: [new targets.LambdaFunction(sender)],
      });
    }

    // Not settled by the files: the audit rule is there only where the variable is set when the app runs.
    if (process.env.WITH_AUDIT === 'yes') {
      new events.Rule(this, 'Audit', {
        eventPattern: { source: ['club.mail'], detailType: events.Match.prefix('Mail') },
        targets: [new targets.LambdaFunction(reader)],
      });
    }

    // A function another repository deploys, by its name.
    const billing = lambda.Function.fromFunctionName(this, 'Billing', 'club-billing-charge');
    new events.Rule(this, 'MemberJoined', {
      eventPattern: { source: ['club.accounts'], detailType: ['MemberJoined'] },
      targets: [new targets.LambdaFunction(billing)],
    });

    // Renewals: charge, then remind whoever has not paid. The machine has no name of its own.
    const charge = new tasks.LambdaInvoke(this, 'Charge', { lambdaFunction: sender, outputPath: '$.Payload' });
    const paid = new sfn.Choice(this, 'Paid?')
      .when(sfn.Condition.booleanEquals('$.paid', true), new sfn.Succeed(this, 'Renewed'))
      .otherwise(new tasks.SqsSendMessage(this, 'Remind', { queue: inbox, messageBody: sfn.TaskInput.fromJsonPathAt('$') }));
    new sfn.StateMachine(this, 'Renewals', { definitionBody: sfn.DefinitionBody.fromChainable(charge.next(paid)) });

    // Lapses: a definition file, its function handed in as a substitution.
    new sfn.StateMachine(this, 'Lapses', {
      stateMachineName: `club-${props.stage}-lapses`,
      definitionBody: sfn.DefinitionBody.fromFile(path.join(__dirname, '..', 'statemachine', 'lapses.asl.json')),
      definitionSubstitutions: { ReaderArn: reader.functionArn },
    });

    // Run once a member confirms their address; its code is where the construct looks by default.
    const welcome = new NodejsFunction(this, 'Welcome', { functionName: `club-${props.stage}-welcome` });
    new cognito.UserPool(this, 'MemberPool', { userPoolName: 'club-members', lambdaTriggers: { postConfirmation: welcome } });
  }
}
