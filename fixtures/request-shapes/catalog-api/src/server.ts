import fastify, { type FastifyRequest } from 'fastify';

export interface CreateItem {
  sku: string;
  price: number;
}

export interface Item {
  id: string;
  sku: string;
  price: number;
}

const app = fastify();

// Body and answer stated on the route; answered through the reply, with a
// status in front of it.
app.post<{ Body: CreateItem; Reply: Item }>('/items', async (request, reply) => {
  const item: Item = { id: 'i1', sku: request.body.sku, price: request.body.price };
  reply.code(201).send(item);
});

// The path params stated on the request; answered by returning the value.
app.get('/items/:id', async (request: FastifyRequest<{ Params: { id: string } }>) => {
  const item: Item = { id: request.params.id, sku: 'sku-1', price: 10 };
  return item;
});

// Nothing stated: the body is `unknown` and nothing is answered with a shape.
app.delete('/items/:id', async (request, reply) => {
  reply.code(204).send();
});

app.listen({ port: 3001 });
