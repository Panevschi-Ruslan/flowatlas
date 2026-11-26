import express, { type Request, type Response } from 'express';

import { settings } from './settings';

export const app = express();

app.get('/entries', (req: Request, res: Response) => res.json({ region: settings.ledgerRegion, provider: settings.paymentProvider, cache: settings.cacheHost }));

app.listen(settings.port);
