import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { documents, queues, workflows, type Order } from '../lib/clients';

/**
 * POST /checkout: writes the order to the orders table, whose stream runs
 * `index-orders`, tells `ship-order` through the queue, and starts the
 * fulfilment workflow.
 */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const request = JSON.parse(event.body ?? '{}') as Pick<Order, 'customerId' | 'items'>;
  const order: Order = { ...request, orderId: `${request.customerId}-${Date.now()}` };
  await documents.send(new PutCommand({ TableName: process.env.ORDERS_TABLE as string, Item: { ...order } }));
  await queues.send(new SendMessageCommand({ QueueUrl: process.env.ORDER_PLACED_URL, MessageBody: JSON.stringify(order) }));
  await workflows.send(
    new StartExecutionCommand({ stateMachineArn: process.env.FULFIL_ORDER_ARN, name: order.orderId, input: JSON.stringify(order) }),
  );
  return { statusCode: 201, body: JSON.stringify(order) };
};
