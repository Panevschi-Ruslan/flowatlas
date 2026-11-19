import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

/** Every table of the shop is written through one of these, told its table by the class that extends it. */
export class Repository<T extends { id: string }> {
  constructor(private readonly table: string) {}

  async save(item: T): Promise<void> {
    await client.send(new PutItemCommand({ TableName: this.table, Item: { id: { S: item.id }, body: { S: JSON.stringify(item) } } }));
  }
}

/** A store that only declares its table: each store extending it says which. */
export abstract class Store<T extends { id: string }> {
  protected abstract readonly table: string;

  async put(item: T): Promise<void> {
    await client.send(new PutItemCommand({ TableName: this.table, Item: { id: { S: item.id } } }));
  }
}
