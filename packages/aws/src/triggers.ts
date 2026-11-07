/**
 * The way in a user pool runs a function at, as every reader of a deployment
 * spells it (P57): `cognito/<pool>/<trigger>`, the trigger in the spelling
 * Terraform's `lambda_config` gives it (`pre_sign_up`, `custom_sms_sender`).
 *
 * The Serverless Framework writes the same trigger `PreSignUp`, the CDK
 * `preSignUp` or `PRE_SIGN_UP`; all three are one step of signing up, and a
 * function run at it is one entry whichever file declared it.
 */
const snakeCase = (written: string): string =>
  written
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();

export const cognitoTriggerKey = (pool: string, trigger: string): string => `cognito/${pool}/${snakeCase(trigger)}`;

/**
 * What an invocation result put on a bus is named by: the platform's own source
 * and detail type, so a rule taking them by name joins it (P54). Every reader
 * of a deployment hands a destination on a bus over this way.
 */
export const RESULT_DETAIL_TYPES: Readonly<Record<'success' | 'failure', string>> = {
  success: 'Lambda Function Invocation Result - Success',
  failure: 'Lambda Function Invocation Result - Failure',
};

/** A destination as a target; a result put on a bus is the event the platform names. */
export const destinationOf = <T extends { readonly kind: string }>(to: T | undefined, when: 'success' | 'failure'): T | undefined =>
  to?.kind === 'bus' ? { ...to, fields: { source: 'lambda', 'detail-type': RESULT_DETAIL_TYPES[when] } } : to;

/**
 * The services whose invocations of a function every reader of a deployment
 * reads from the resources that make them - routes, rules, subscriptions,
 * queues, workflows, pipes, schedules, bucket notifications, user pools, IoT
 * rules, load balancers - so a permission for one of them adds nothing. A
 * permission for any other principal is a way the function is run that no
 * reader follows, and is said (P53, P248).
 */
export const READ_PRINCIPALS: ReadonlySet<string> = new Set([
  'apigateway.amazonaws.com',
  'events.amazonaws.com',
  'scheduler.amazonaws.com',
  'sns.amazonaws.com',
  'sqs.amazonaws.com',
  'states.amazonaws.com',
  'pipes.amazonaws.com',
  's3.amazonaws.com',
  'cognito-idp.amazonaws.com',
  'iot.amazonaws.com',
  'elasticloadbalancing.amazonaws.com',
]);
