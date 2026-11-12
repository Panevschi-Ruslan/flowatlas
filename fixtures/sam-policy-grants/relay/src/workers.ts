interface QueueEvent {
  Records: { body: string }[];
}

interface StreamEvent {
  Records: { kinesis: { data: string } }[];
}

export const orders = async (event: QueueEvent) => event.Records.map((record) => JSON.parse(record.body) as unknown);

export const refunds = async (event: QueueEvent) => event.Records.map((record) => JSON.parse(record.body) as unknown);

export const archive = async (event: StreamEvent) =>
  event.Records.map((record) => JSON.parse(Buffer.from(record.kinesis.data, 'base64').toString('utf8')) as unknown);
