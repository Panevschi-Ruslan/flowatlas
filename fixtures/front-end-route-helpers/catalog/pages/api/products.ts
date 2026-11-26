import ProductsGateway from '../../gateways/products.gateway';

type Reply = { status(code: number): { json(body: unknown): void } };

/** The products way in: what it does is behind the gateway's object. */
export default async function handler(_request: unknown, response: Reply) {
  response.status(200).json({ ids: await ProductsGateway.list() });
}
