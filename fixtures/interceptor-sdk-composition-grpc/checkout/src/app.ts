import { join } from 'node:path';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import express from 'express';

const { STOCK_ADDR = '' } = process.env;

// This loader keeps the contract's names too, so a call writes `product_id`.
const stockPackage = loadPackageDefinition(loadSync(join(__dirname, '../../proto/stock.proto'), { keepCase: true })) as any;
const stock = new stockPackage.stock.StockService(STOCK_ADDR, credentials.createInsecure());

export const app = express();

app.post('/checkout', (req, res) => {
  // `productId` is not a name this loader gives the field: it is not sent.
  stock.reserve({ product_id: req.body.productId, quantity: 1, productId: req.body.productId }, (_error: unknown, reply: unknown) => res.json(reply));
});

app.listen(3001);
