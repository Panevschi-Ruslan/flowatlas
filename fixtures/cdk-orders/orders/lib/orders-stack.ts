import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import type { Construct } from 'constructs';
import { ORDERS_SOURCE } from '../src/lib/orders';
import { OrdersApi } from './orders-api';

export interface OrdersStackProps extends StackProps {
  readonly stage: string;
}

/** Orders, shipping and notices: the same deployment `terraform-orders` writes in Terraform. */
export class OrdersStack extends Stack {
  constructor(scope: Construct, id: string, props: OrdersStackProps) {
    super(scope, id, props);
    const prefix = `orders-${props.stage}`;

    // One function per handler file, named after it.
    const handler = (id: string, file: string, environment: Record<string, string> = {}): NodejsFunction =>
      new NodejsFunction(this, id, {
        functionName: `${prefix}-${file.split('/')[1]}`,
        entry: path.join(__dirname, '..', 'src', `${file}.ts`),
        runtime: lambda.Runtime.NODEJS_20_X,
        environment,
      });

    const table = new dynamodb.Table(this, 'Orders', {
      tableName: `${prefix}-orders`,
      partitionKey: { name: 'orderId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });
    const deadLetters = new sqs.Queue(this, 'PlacedDeadLetters', { queueName: `${prefix}-placed-dlq` });
    const placed = new sqs.Queue(this, 'Placed', {
      queueName: `${prefix}-placed`,
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: 3 },
    });
    const shipped = new sns.Topic(this, 'Shipped', { topicName: `${prefix}-shipped` });
    const bus = new events.EventBus(this, 'Bus', { eventBusName: prefix });
    const invoices = new s3.Bucket(this, 'Invoices', { bucketName: `${prefix}-invoices` });

    const placeOrder = handler('PlaceOrderFunction', 'orders/place-order', {
      ORDERS_TABLE: table.tableName,
      ORDERS_QUEUE_URL: placed.queueUrl,
      ORDERS_BUS_NAME: bus.eventBusName,
    });
    const getOrder = handler('GetOrderFunction', 'orders/get-order', { ORDERS_TABLE: table.tableName });
    const cancelOrder = handler('CancelOrderFunction', 'orders/cancel-order', { ORDERS_BUS_NAME: bus.eventBusName });
    const listOrders = handler('ListOrdersFunction', 'orders/list-orders', { ORDERS_TABLE: table.tableName });
    const receipt = handler('ReceiptFunction', 'orders/receipt');
    const orderChanged = handler('OrderChangedFunction', 'orders/order-changed');
    const shipOrder = handler('ShipOrderFunction', 'shipping/ship-order', {
      INVOICES_BUCKET: invoices.bucketName,
      SHIPPED_TOPIC_ARN: shipped.topicArn,
    });
    const reserveStock = handler('ReserveStockFunction', 'shipping/reserve-stock');
    const chargePayment = handler('ChargePaymentFunction', 'shipping/charge-payment');
    const notifyCustomer = handler('NotifyCustomerFunction', 'notices/notify-customer');
    const refundOrder = handler('RefundOrderFunction', 'refunds/refund-order');
    const nightlyReport = handler('NightlyReportFunction', 'reports/nightly-report', { ORDERS_TABLE: table.tableName });
    const indexInvoice = handler('IndexInvoiceFunction', 'invoices/index-invoice');
    const liveSocket = handler('LiveSocketFunction', 'live/live-socket');

    new OrdersApi(this, 'Api', { stage: props.stage, placeOrder, getOrder, cancelOrder, listOrders, liveSocket });
    receipt.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    orderChanged.addEventSource(new DynamoEventSource(table, { startingPosition: lambda.StartingPosition.LATEST }));
    shipOrder.addEventSource(new SqsEventSource(placed, { batchSize: 10 }));
    shipped.addSubscription(new subscriptions.LambdaSubscription(notifyCustomer));
    invoices.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(indexInvoice), {
      prefix: 'invoices/',
      suffix: '.pdf',
    });

    new events.Rule(this, 'OrderCancelled', {
      ruleName: `${prefix}-order-cancelled`,
      eventBus: bus,
      eventPattern: { source: [ORDERS_SOURCE], detailType: ['OrderCancelled'] },
      targets: [new targets.LambdaFunction(refundOrder)],
    });
    new events.Rule(this, 'NightlyReport', {
      ruleName: `${prefix}-nightly-report`,
      schedule: events.Schedule.cron({ minute: '0', hour: '2' }),
      targets: [new targets.LambdaFunction(nightlyReport)],
    });

    // Shipping: reserve the stock, then charge for it.
    const reserve = new tasks.LambdaInvoke(this, 'ReserveStock', { lambdaFunction: reserveStock, outputPath: '$.Payload' });
    const charge = new tasks.LambdaInvoke(this, 'ChargePayment', { lambdaFunction: chargePayment, outputPath: '$.Payload' });
    const shipping = new sfn.StateMachine(this, 'Shipping', {
      stateMachineName: `${prefix}-shipping`,
      definitionBody: sfn.DefinitionBody.fromChainable(reserve.next(charge).next(new sfn.Succeed(this, 'Done'))),
    });
    new events.Rule(this, 'OrderPlaced', {
      ruleName: `${prefix}-order-placed`,
      eventBus: bus,
      eventPattern: { source: [ORDERS_SOURCE], detailType: ['OrderPlaced'] },
      targets: [new targets.SfnStateMachine(shipping)],
    });
  }
}
