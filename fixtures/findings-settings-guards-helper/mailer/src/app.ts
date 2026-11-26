import express, { type Request, type Response } from 'express';

/** Handed in by the secrets tool the image starts the service through. */
const relay = process.env.SMTP_RELAY as string;

export const app = express();

app.get('/relay', (req: Request, res: Response) => res.json({ relay }));

app.listen(3000);
