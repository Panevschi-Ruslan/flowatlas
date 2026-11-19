import { join } from 'node:path';
import { credentials, loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import express from 'express';

const { STOCK_ADDR = '' } = process.env;

/** The answer as this caller's loader hands it: the contract's own names. */
interface Level {
  units_left: number;
  back_order: boolean;
}

// This loader keeps the contract's names, so the answer is read as `units_left`.
const stockPackage = loadPackageDefinition(loadSync(join(__dirname, '../../proto/stock.proto'), { keepCase: true })) as any;
const stock = new stockPackage.stock.StockService(STOCK_ADDR, credentials.createInsecure());

export const app = express();

app.get('/level/:id', (req, res) => {
  stock.getLevel({ product_id: req.params.id, warehouse_id: 1 }, (_error: unknown, level: Level) => res.json({ left: level.units_left }));
});

app.listen(3001);
