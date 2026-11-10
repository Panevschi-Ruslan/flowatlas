import { join } from 'node:path';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { PricingServiceClient, type PriceQuote } from './gen/pricing';

const { INVENTORY_ADDR = '', PRICING_ADDR = '' } = process.env;

// The contract loaded at run time: what is sent is the object written at the call.
const store = loadPackageDefinition(loadSync(join(__dirname, '../../proto/store.proto'))) as any;
const inventory = new store.store.InventoryService(INVENTORY_ADDR, credentials.createInsecure());

// Generated code committed beside this file: the request and the answer are typed.
const pricing = new PricingServiceClient(PRICING_ADDR, credentials.createInsecure());

export function reserve(sku: string, quantity: number): Promise<unknown> {
  // `warehouseIds` left out is its default; `quantity` written as text is not an int32.
  return new Promise((resolve) => inventory.reserve({ sku, quantity: String(quantity) }, (_error: unknown, reply: unknown) => resolve(reply)));
}

export function release(reservationId: string): Promise<unknown> {
  // The contract's field is `reservation_id`, which the client writes as `reservationId`; `reason` is not declared.
  return new Promise((resolve) => inventory.release({ reservationId, reason: 'cancelled' }, (_error: unknown, reply: unknown) => resolve(reply)));
}

export function count(sku: string): Promise<unknown> {
  // Declared by the contract and implemented by nobody: the server answers UNIMPLEMENTED.
  return new Promise((resolve) => inventory.countStock({ sku }, (_error: unknown, reply: unknown) => resolve(reply)));
}

export function quote(skus: string[], couponCode: string): Promise<PriceQuote> {
  return new Promise((resolve, reject) =>
    pricing.quote({ lines: skus.map((sku) => ({ sku, quantity: 1 })), currencyCode: 'EUR', couponCode }, (error, reply) => (error ? reject(error) : resolve(reply))),
  );
}
