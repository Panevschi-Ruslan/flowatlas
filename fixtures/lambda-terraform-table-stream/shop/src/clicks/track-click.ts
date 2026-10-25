import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { KinesisClient, PutRecordCommand } from '@aws-sdk/client-kinesis';

const kinesis = new KinesisClient({ region: 'eu-west-1' });

/** POST /clicks: puts each click on the clicks stream, which `count-clicks` reads. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const click = JSON.parse(event.body ?? '{}') as { page: string; customerId: string };
  await kinesis.send(
    new PutRecordCommand({
      StreamName: 'shop-clicks',
      PartitionKey: click.customerId,
      Data: new TextEncoder().encode(JSON.stringify(click)),
    }),
  );
  return { statusCode: 202, body: '' };
};
