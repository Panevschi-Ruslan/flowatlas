import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';

export interface MailboxProps {
  readonly topicName: string;
}

/** A topic and the function subscribed to it; its code is `mailbox.Handler.ts`, the construct's own default. */
export class Mailbox extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: MailboxProps) {
    super(scope, id);
    this.topic = new sns.Topic(this, 'Topic', { topicName: props.topicName });
    const handler = new NodejsFunction(this, 'Handler', { functionName: `${props.topicName}-handler`, timeout: Duration.seconds(10) });
    this.topic.addSubscription(new subscriptions.LambdaSubscription(handler));
  }
}
