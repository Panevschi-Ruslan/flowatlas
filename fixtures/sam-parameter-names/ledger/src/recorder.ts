import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const db = new DynamoDBClient({});

export const handler = async (event: { body: string }) => {
  const entry = JSON.parse(event.body) as { id: string; team: string; amount: number };
  await db.send(
    new PutItemCommand({
      TableName: process.env.LEDGER_TABLE,
      Item: { id: { S: entry.id }, team: { S: entry.team }, amount: { N: String(entry.amount) } },
    }),
  );
  return { statusCode: 201, body: JSON.stringify({ id: entry.id }) };
};
